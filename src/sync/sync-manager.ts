import { DiffResult } from '../types';
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
  errors: Array<{ path: string; error: string }>;
}

export class SyncManager {
  private client: SynologyApiClient;
  private vault: VaultAdapter;
  private remoteRoot: string;
  private isRunning: boolean = false;

  constructor(client: SynologyApiClient, vault: VaultAdapter, remoteRoot: string) {
    this.client = client;
    this.vault = vault;
    this.remoteRoot = remoteRoot.replace(/\/+$/, '');
  }

  async executeSync(diff: DiffResult): Promise<SyncReport> {
    if (this.isRunning) {
      throw new Error('Sync is already in progress.');
    }
    this.isRunning = true;

    const report: SyncReport = {
      uploadedCount: 0,
      downloadedCount: 0,
      conflictCount: 0,
      errors: [],
    };

    try {
      // 1. Process Uploads
      const uploads = diff.uploads || [];
      for (const item of uploads) {
        try {
          const content = await this.vault.readBinary(item.path);
          const slashIdx = item.path.lastIndexOf('/');
          const folder = slashIdx !== -1 ? `${this.remoteRoot}/${item.path.substring(0, slashIdx)}` : this.remoteRoot;
          const fileName = slashIdx !== -1 ? item.path.substring(slashIdx + 1) : item.path;

          await this.client.uploadFile(folder, fileName, content);
          report.uploadedCount++;
        } catch (e: any) {
          report.errors.push({ path: item.path, error: e.message || String(e) });
        }
      }

      // 2. Process Downloads
      const downloads = diff.downloads || [];
      for (const item of downloads) {
        if (!item.remote) continue;
        try {
          const content = await this.client.downloadFile(item.remote.fullRemotePath);
          await this.vault.writeBinaryAtomic(item.path, content);
          report.downloadedCount++;
        } catch (e: any) {
          report.errors.push({ path: item.path, error: e.message || String(e) });
        }
      }

      // 3. Process Conflicts (Non-destructive safe copy)
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
  diff: DiffResult
): Promise<SyncReport> {
  const manager = new SyncManager(client, vault, remoteRoot);
  return await manager.executeSync(diff);
}
