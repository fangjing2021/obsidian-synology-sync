import { LocalFileItem, RemoteFileItem, DiffResult, SyncIndex } from '../types';

export function isIgnored(path: string, ignorePatterns: string[]): boolean {
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const basename = normalizedPath.split('/').pop() || '';

  for (const pattern of ignorePatterns) {
    if (!pattern || pattern.trim() === '') continue;
    const cleanPattern = pattern.trim().replace(/\\/g, '/');

    // AppleDouble file pattern: ._*
    if (cleanPattern === '._*' || cleanPattern.endsWith('/._*')) {
      if (basename.startsWith('._')) return true;
      continue;
    }

    // Wildcard match for extensions: *.tmp
    if (cleanPattern.startsWith('*.')) {
      const ext = cleanPattern.slice(1);
      if (normalizedPath.endsWith(ext)) return true;
      continue;
    }

    // Directory wildcard pattern: /**
    if (cleanPattern.endsWith('/**')) {
      const dirPrefix = cleanPattern.slice(0, -3).replace(/^\/+/, '').replace(/\/+$/, '');
      if (
        normalizedPath === dirPrefix ||
        normalizedPath.startsWith(dirPrefix + '/') ||
        normalizedPath.includes('/' + dirPrefix + '/')
      ) {
        return true;
      }
      continue;
    }

    // Directory pattern with trailing slash: e.g. .obsidian/cache/ or /archive/
    if (cleanPattern.endsWith('/')) {
      const dirName = cleanPattern.replace(/^\/+/, '').replace(/\/+$/, '');
      if (
        normalizedPath === dirName ||
        normalizedPath.startsWith(dirName + '/') ||
        normalizedPath.includes('/' + dirName + '/')
      ) {
        return true;
      }
      continue;
    }

    // Direct basename or path match (e.g. .DS_Store, .obsidian/workspace.json)
    const cleanExact = cleanPattern.replace(/^\/+/, '');
    if (
      normalizedPath === cleanExact ||
      normalizedPath.endsWith('/' + cleanExact) ||
      normalizedPath.startsWith(cleanExact + '/') ||
      normalizedPath.includes('/' + cleanExact + '/')
    ) {
      return true;
    }
  }
  return false;
}

function normalizeMtime(mtime: number): number {
  return Math.floor(mtime > 10000000000 ? mtime / 1000 : mtime);
}

export function computeDiff(
  localFiles: LocalFileItem[],
  remoteFiles: RemoteFileItem[],
  ignorePatterns: string[],
  lastSyncIndex?: SyncIndex
): DiffResult {
  const result: DiffResult = {
    uploads: [],
    downloads: [],
    conflicts: [],
    deletesRemote: [],
    deletesLocal: [],
    skips: [],
  };

  const localMap = new Map<string, LocalFileItem>();
  for (const f of localFiles) {
    if (!isIgnored(f.path, ignorePatterns)) {
      localMap.set(f.path, f);
    }
  }

  const remoteMap = new Map<string, RemoteFileItem>();
  for (const f of remoteFiles) {
    if (!f.isdir && !isIgnored(f.path, ignorePatterns)) {
      remoteMap.set(f.path, f);
    }
  }

  // 1. Process Local Files
  for (const [path, local] of localMap.entries()) {
    const remote = remoteMap.get(path);
    const last = lastSyncIndex?.[path];

    if (!remote) {
      // Local exists, Remote does not exist
      if (last) {
        // Was previously synced, missing on remote
        const localMtimeSec = normalizeMtime(local.mtime);
        const lastLocalMtimeSec = normalizeMtime(last.localMtime);
        const localModified = Math.abs(localMtimeSec - lastLocalMtimeSec) > 2 || local.size !== last.size;

        if (!localModified) {
          // Deleted on remote, local unchanged -> delete locally
          result.deletesLocal.push({ path, action: 'delete_local', local, reason: 'Deleted on remote' });
        } else {
          // Re-created or modified locally after remote deletion -> re-upload
          result.uploads.push({ path, action: 'upload', local, reason: 'Modified locally after remote deletion' });
        }
      } else {
        // New file created locally
        result.uploads.push({ path, action: 'upload', local, reason: 'New local file' });
      }
    } else {
      // Both Local and Remote exist
      if (local.md5 && remote.md5 && local.md5 === remote.md5) {
        result.skips.push({ path, action: 'skip', local, remote, reason: 'Identical MD5' });
        continue;
      }

      const localMtimeSec = normalizeMtime(local.mtime);
      const remoteMtimeSec = normalizeMtime(remote.mtime);

      if (last) {
        // 3-way comparison against last sync baseline
        const lastLocalMtimeSec = normalizeMtime(last.localMtime);
        const lastRemoteMtimeSec = normalizeMtime(last.remoteMtime);

        const localChanged =
          (Math.abs(localMtimeSec - lastLocalMtimeSec) > 2 || local.size !== last.size) &&
          !(local.md5 && last.md5 && local.md5 === last.md5);

        const remoteChanged =
          (Math.abs(remoteMtimeSec - lastRemoteMtimeSec) > 2 || remote.size !== last.size) &&
          !(remote.md5 && last.md5 && remote.md5 === last.md5);

        if (!localChanged && !remoteChanged) {
          result.skips.push({ path, action: 'skip', local, remote, reason: 'Neither modified since last sync' });
        } else if (localChanged && !remoteChanged) {
          result.uploads.push({ path, action: 'upload', local, remote, reason: 'Local modified since last sync' });
        } else if (!localChanged && remoteChanged) {
          result.downloads.push({ path, action: 'download', local, remote, reason: 'Remote modified since last sync' });
        } else {
          // Both modified!
          if (Math.abs(localMtimeSec - remoteMtimeSec) <= 2 && local.size === remote.size) {
            result.skips.push({ path, action: 'skip', local, remote, reason: 'Both modified to identical size and timestamp' });
          } else {
            result.conflicts.push({ path, action: 'conflict', local, remote, reason: 'Concurrent modification on both sides' });
          }
        }
      } else {
        // Fallback: 2-way comparison (first sync without index)
        if (localMtimeSec > remoteMtimeSec + 2) {
          result.uploads.push({ path, action: 'upload', local, remote, reason: 'Local newer' });
        } else if (remoteMtimeSec > localMtimeSec + 2) {
          result.downloads.push({ path, action: 'download', local, remote, reason: 'Remote newer' });
        } else {
          // |localMtime - remoteMtime| <= 2
          if (local.md5 && remote.md5) {
            result.conflicts.push({ path, action: 'conflict', local, remote, reason: 'Concurrent modification' });
          } else {
            if (local.size !== remote.size) {
              result.conflicts.push({ path, action: 'conflict', local, remote, reason: 'Concurrent modification' });
            } else {
              result.skips.push({ path, action: 'skip', local, remote, reason: 'Same mtime and size (assumed unchanged)' });
            }
          }
        }
      }
    }
  }

  // 2. Process Remote-only Files
  for (const [path, remote] of remoteMap.entries()) {
    if (localMap.has(path)) continue;
    const last = lastSyncIndex?.[path];

    if (last) {
      // Was previously synced, now missing locally
      const remoteMtimeSec = normalizeMtime(remote.mtime);
      const lastRemoteMtimeSec = normalizeMtime(last.remoteMtime);
      const remoteModified = Math.abs(remoteMtimeSec - lastRemoteMtimeSec) > 2 || remote.size !== last.size;

      if (!remoteModified) {
        // Deleted locally, remote unchanged -> delete on remote
        result.deletesRemote.push({ path, action: 'delete_remote', remote, reason: 'Deleted on local' });
      } else {
        // Remote modified after local deletion -> re-download
        result.downloads.push({ path, action: 'download', remote, reason: 'Modified on remote after local deletion' });
      }
    } else {
      // New file created on remote
      result.downloads.push({ path, action: 'download', remote, reason: 'New remote file' });
    }
  }

  return result;
}
