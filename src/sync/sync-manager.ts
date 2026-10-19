import { DiffResult, SyncIndex } from '../types';
import { SynologyApiClient } from '../syno/api-client';

export interface VaultAdapter {
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinaryAtomic(path: string, content: ArrayBuffer): Promise<void>;
  deleteFile(path: string): Promise<void>;
}

export interface SyncReport {
  uploadedCount: number;
  downloadedCount: number;
  conflictCount: number;
  deletedRemoteCount: number;
  deletedLocalCount: number;
  errors: Array<{ path: string; error: string }>;
  updatedIndex?: SyncIndex;
}

const CONCURRENCY_LIMIT = 3;

async function runConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) {
        await fn(item);
      }
    }
  });
  await Promise.all(workers);
}

export class SyncManager {
  private client: SynologyApiClient;
  private vault: VaultAdapter;
  private remoteRoot: string;
  private currentIndex: SyncIndex;
  private isRunning: boolean = false;

  constructor(client: SynologyApiClient, vault: VaultAdapter, remoteRoot: string, currentIndex?: SyncIndex) {
    this.client = client;
    this.vault = vault;
    this.remoteRoot = remoteRoot.replace(/\/+$/, '');
    this.currentIndex = currentIndex ? { ...currentIndex } : {};
  }

  async executeSync(diff: DiffResult): Promise<SyncReport> {
    if (this.isRunning) {
      throw new Error('Sync is already in progress.');
    }
    this.isRunning = true;

    const updatedIndex: SyncIndex = { ...this.currentIndex };

    const report: SyncReport = {
      uploadedCount: 0,
      downloadedCount: 0,
      conflictCount: 0,
      deletedRemoteCount: 0,
      deletedLocalCount: 0,
      errors: [],
      updatedIndex,
    };

    try {
      // 1. Process Uploads (受控并发池 CONCURRENCY = 3)
      const uploads = diff.uploads || [];
      await runConcurrent(uploads, CONCURRENCY_LIMIT, async (item) => {
        try {
          const content = await this.vault.readBinary(item.path);
          const slashIdx = item.path.lastIndexOf('/');
          const folder = slashIdx !== -1 ? `${this.remoteRoot}/${item.path.substring(0, slashIdx)}` : this.remoteRoot;
          const fileName = slashIdx !== -1 ? item.path.substring(slashIdx + 1) : item.path;

          if (item.local?.mtime !== undefined) {
            await this.client.uploadFile(folder, fileName, content, item.local.mtime);
          } else {
            await this.client.uploadFile(folder, fileName, content);
          }
          report.uploadedCount++;

          const mtime = item.local?.mtime || Date.now();
          updatedIndex[item.path] = {
            localMtime: mtime,
            remoteMtime: mtime,
            size: content.byteLength,
            md5: item.local?.md5,
          };
        } catch (e: any) {
          report.errors.push({ path: item.path, error: e.message || String(e) });
        }
      });

      // 2. Process Downloads (受控并发池 CONCURRENCY = 3)
      const downloads = diff.downloads || [];
      await runConcurrent(downloads, CONCURRENCY_LIMIT, async (item) => {
        if (!item.remote) return;
        try {
          const content = await this.client.downloadFile(item.remote.fullRemotePath);
          await this.vault.writeBinaryAtomic(item.path, content);
          report.downloadedCount++;

          updatedIndex[item.path] = {
            localMtime: item.remote.mtime,
            remoteMtime: item.remote.mtime,
            size: content.byteLength,
            md5: item.remote.md5,
          };
        } catch (e: any) {
          report.errors.push({ path: item.path, error: e.message || String(e) });
        }
      });

      // 3. Process Conflicts (安全副本，不覆盖)
      const conflicts = diff.conflicts || [];
      for (const item of conflicts) {
        if (!item.remote) continue;
        try {
          const content = await this.client.downloadFile(item.remote.fullRemotePath);
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const slashIdx = item.path.lastIndexOf('/');
          const dir = slashIdx !== -1 ? item.path.substring(0, slashIdx + 1) : '';
          const fileName = slashIdx !== -1 ? item.path.substring(slashIdx + 1) : item.path;

          const extIdx = fileName.lastIndexOf('.');
          const baseName = extIdx > 0 ? fileName.substring(0, extIdx) : fileName;
          const ext = extIdx > 0 ? fileName.substring(extIdx) : '';
          const conflictPath = `${dir}${baseName} (conflict-syno-${timestamp})${ext}`;

          await this.vault.writeBinaryAtomic(conflictPath, content);
          report.conflictCount++;
        } catch (e: any) {
          report.errors.push({ path: item.path, error: e.message || String(e) });
        }
      }

      // 4. Process Remote Deletions (本地已删 -> 同步删除远端)
      const deletesRemote = diff.deletesRemote || [];
      for (const item of deletesRemote) {
        try {
          const fullPath = item.remote?.fullRemotePath || `${this.remoteRoot}/${item.path}`;
          await this.client.deleteFile(fullPath);
          delete updatedIndex[item.path];
          report.deletedRemoteCount++;
        } catch (e: any) {
          report.errors.push({ path: item.path, error: e.message || String(e) });
        }
      }

      // 5. Process Local Deletions (远端已删 -> 同步删除本地/移入回收站)
      const deletesLocal = diff.deletesLocal || [];
      for (const item of deletesLocal) {
        try {
          await this.vault.deleteFile(item.path);
          delete updatedIndex[item.path];
          report.deletedLocalCount++;
        } catch (e: any) {
          report.errors.push({ path: item.path, error: e.message || String(e) });
        }
      }

      // 6. Record Skips into index if not yet tracked
      const skips = diff.skips || [];
      for (const item of skips) {
        if (!updatedIndex[item.path] && item.local && item.remote) {
          updatedIndex[item.path] = {
            localMtime: item.local.mtime,
            remoteMtime: item.remote.mtime,
            size: item.local.size,
            md5: item.local.md5 || item.remote.md5,
          };
        }
      }
    } finally {
      this.isRunning = false;
    }

    return report;
  }
}

export async function executeSyncCycle(
  client: SynologyApiClient,
  vault: VaultAdapter,
  remoteRoot: string,
  diff: DiffResult,
  currentIndex?: SyncIndex
): Promise<SyncReport> {
  const manager = new SyncManager(client, vault, remoteRoot, currentIndex);
  return await manager.executeSync(diff);
}
