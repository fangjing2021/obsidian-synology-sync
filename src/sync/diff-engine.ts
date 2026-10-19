import { LocalFileItem, RemoteFileItem, DiffResult } from '../types';

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
  ignorePatterns: string[]
): DiffResult {
  const result: DiffResult = {
    uploads: [],
    downloads: [],
    conflicts: [],
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

  // Check local files
  for (const [path, local] of localMap.entries()) {
    const remote = remoteMap.get(path);
    if (!remote) {
      result.uploads.push({ path, action: 'upload', local });
    } else {
      // Both exist
      if (local.md5 && remote.md5 && local.md5 === remote.md5) {
        result.skips.push({ path, action: 'skip', local, remote, reason: 'Identical MD5' });
      } else {
        // Difference in mtime or md5
        const localMtime = normalizeMtime(local.mtime);
        const remoteMtime = normalizeMtime(remote.mtime);

        if (localMtime > remoteMtime + 2) {
          result.uploads.push({ path, action: 'upload', local, remote, reason: 'Local newer' });
        } else if (remoteMtime > localMtime + 2) {
          result.downloads.push({ path, action: 'download', local, remote, reason: 'Remote newer' });
        } else {
          // |localMtime - remoteMtime| <= 2
          if (local.md5 && remote.md5) {
            // Both MD5 present and differ
            result.conflicts.push({ path, action: 'conflict', local, remote, reason: 'Concurrent modification' });
          } else {
            // One or both lack MD5
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

  // Check remote-only files
  for (const [path, remote] of remoteMap.entries()) {
    if (!localMap.has(path)) {
      result.downloads.push({ path, action: 'download', remote });
    }
  }

  return result;
}
