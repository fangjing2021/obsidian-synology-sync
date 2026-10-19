import { Plugin, Notice, requestUrl, RequestUrlParam, TFile, normalizePath } from 'obsidian';
import { SynoSyncSettings, DEFAULT_SETTINGS, LocalFileItem } from './types';
import { SynologySyncSettingTab } from './settings/settings-tab';
import { QuickConnectResolver } from './syno/qc-resolver';
import { SynologyApiClient, HttpRequester } from './syno/api-client';
import { computeDiff } from './sync/diff-engine';
import { SyncManager, VaultAdapter } from './sync/sync-manager';

export default class SynologySyncPlugin extends Plugin {
  settings: SynoSyncSettings = DEFAULT_SETTINGS;
  private statusBarEl!: HTMLElement;
  private isSyncing: boolean = false;
  private syncIntervalId: number | null = null;

  async onload() {
    await this.loadSettings();

    // 1. Register Setting Tab
    this.addSettingTab(new SynologySyncSettingTab(this.app, this));

    // 2. Register Status Bar Item
    this.statusBarEl = this.addStatusBarItem();
    this.setStatusBar('idle');

    // 3. Register Ribbon Icon
    this.addRibbonIcon('refresh-cw', 'Synology Sync', async () => {
      await this.runSync();
    });

    // 4. Register Sync Command
    this.addCommand({
      id: 'synology-sync-now',
      name: 'Sync Now',
      callback: async () => {
        await this.runSync();
      },
    });

    // 5. Register Test Connection Command
    this.addCommand({
      id: 'synology-sync-test-connection',
      name: 'Test Connection',
      callback: async () => {
        try {
          new Notice('Testing connection to Synology NAS...');
          await this.testConnection();
          new Notice('✓ Successfully connected to Synology NAS!');
        } catch (e: any) {
          new Notice(`✗ Connection failed: ${e.message || e}`);
        }
      },
    });

    // 6. Auto sync on startup
    if (this.settings.autoSyncOnStartup) {
      setTimeout(() => {
        this.runSync().catch(console.error);
      }, 2000);
    }

    // 7. Setup periodic interval sync
    this.setupSyncInterval();
  }

  onunload() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    this.setStatusBar('offline');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  setupSyncInterval() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    if (this.settings.syncIntervalMinutes > 0) {
      this.syncIntervalId = window.setInterval(() => {
        this.runSync().catch(console.error);
      }, this.settings.syncIntervalMinutes * 60 * 1000);
      this.registerInterval(this.syncIntervalId);
    }
  }

  private setStatusBar(state: 'idle' | 'syncing' | 'error' | 'offline' | 'partial-error', text?: string) {
    if (!this.statusBarEl) return;
    if (state === 'idle') {
      this.statusBarEl.setText(text ? `✓ Syno: ${text}` : '✓ Syno: Idle');
    } else if (state === 'syncing') {
      this.statusBarEl.setText('⏳ Syno: Syncing...');
    } else if (state === 'error') {
      this.statusBarEl.setText('✗ Syno: Error');
    } else if (state === 'partial-error') {
      this.statusBarEl.setText('! Syno: Partial Error');
    } else {
      this.statusBarEl.setText('');
    }
  }

  private parseJsonResponse(res: { text?: string; json?: any }): any {
    if (typeof res.text === 'string' && res.text.trim()) {
      try {
        return JSON.parse(res.text);
      } catch {
        // fall through
      }
    }
    try {
      return res.json ?? null;
    } catch {
      return null;
    }
  }

  private createResolver(): QuickConnectResolver {
    const pingFn = async (url: string, timeoutMs: number) => {
      const timeoutPromise = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs || 1500));
      const pingPromise = (async () => {
        try {
          const res = await requestUrl({
            url: `${url}/webman/pingpong.cgi?action=cors&quickconnect=true`,
            method: 'GET',
            throw: false,
          });
          if (res.status === 200) {
            const data = this.parseJsonResponse(res);
            if (data && (data.success === true || Boolean(data.ezid))) {
              return true;
            }
          }
          const fallback = await requestUrl({
            url: `${url}/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth`,
            method: 'GET',
            throw: false,
          });
          if (fallback.status === 200) {
            const fbData = this.parseJsonResponse(fallback);
            return Boolean(fbData && fbData.success === true);
          }
          return false;
        } catch {
          return false;
        }
      })();
      return Promise.race([pingPromise, timeoutPromise]);
    };

    const qcFetcher = async (url: string, body: any) => {
      try {
        const res = await requestUrl({
          url,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          throw: false,
        });
        return this.parseJsonResponse(res);
      } catch {
        return null;
      }
    };

    return new QuickConnectResolver(pingFn, qcFetcher);
  }

  private getHttpRequester(): HttpRequester {
    return async (options) => {
      const param: RequestUrlParam = {
        url: options.url,
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body as any,
        throw: false,
      };
      const res = await requestUrl(param);
      const parsedJson = this.parseJsonResponse(res);
      return {
        status: res.status,
        json: parsedJson,
        text: res.text,
        arrayBuffer: res.arrayBuffer,
      };
    };
  }

  private getVaultAdapter(): VaultAdapter {
    return {
      readBinary: async (path: string) => {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (file instanceof TFile) {
          return await this.app.vault.readBinary(file);
        }
        throw new Error(`File not found: ${path}`);
      },
      writeBinaryAtomic: async (path: string, content: ArrayBuffer) => {
        const norm = normalizePath(path);
        const slashIdx = norm.lastIndexOf('/');
        if (slashIdx !== -1) {
          const parentDir = norm.substring(0, slashIdx);
          const parts = parentDir.split('/');
          let current = '';
          for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!this.app.vault.getAbstractFileByPath(current)) {
              try {
                await this.app.vault.createFolder(current);
              } catch {
                // Ignore if already created
              }
            }
          }
        }
        const file = this.app.vault.getAbstractFileByPath(norm);
        if (file instanceof TFile) {
          await this.app.vault.modifyBinary(file, content);
        } else {
          await this.app.vault.createBinary(norm, content);
        }
      },
      deleteFile: async (path: string) => {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (file instanceof TFile) {
          await this.app.vault.delete(file);
        }
      },
    };
  }

  private async getLocalFiles(): Promise<LocalFileItem[]> {
    const files = this.app.vault.getFiles();
    return files.map(f => ({
      path: f.path,
      mtime: f.stat.mtime,
      size: f.stat.size,
    }));
  }

  async testConnection(): Promise<void> {
    if (!this.settings.quickConnectId && !this.settings.lanAddress) {
      throw new Error('请先在插件设置中填写 QuickConnect ID 或局域网地址。');
    }
    if (!this.settings.account || !this.settings.password) {
      throw new Error('请先在插件设置中填写群晖 DSM 账号和密码。');
    }

    const http = this.getHttpRequester();
    const resolver = this.createResolver();

    const baseUrl = await resolver.resolveBaseUrl(this.settings.quickConnectId, this.settings.lanAddress);
    const client = new SynologyApiClient(baseUrl, http);
    await client.login(this.settings.account, this.settings.password);
    try {
      // login successful
    } finally {
      await client.logout().catch(console.error);
    }
  }

  async runSync(): Promise<void> {
    if (this.isSyncing) {
      new Notice('Sync already in progress');
      return;
    }

    if (!this.settings.quickConnectId && !this.settings.lanAddress) {
      new Notice('请先在设置中填写 QuickConnect ID 或局域网地址。');
      return;
    }
    if (!this.settings.account || !this.settings.password) {
      new Notice('请先在设置中填写群晖 DSM 账号和密码。');
      return;
    }
    if (!this.settings.remotePath) {
      new Notice('请先在设置中配置群晖远端目录路径。');
      return;
    }

    this.isSyncing = true;
    this.setStatusBar('syncing');

    let client: SynologyApiClient | null = null;
    try {
      const http = this.getHttpRequester();
      const resolver = this.createResolver();

      const baseUrl = await resolver.resolveBaseUrl(this.settings.quickConnectId, this.settings.lanAddress);
      client = new SynologyApiClient(baseUrl, http);
      await client.login(this.settings.account, this.settings.password);

      try {
        // 1. Fetch remote files
        const remoteFiles = await client.listFiles(this.settings.remotePath);

        // 2. Fetch local files
        const localFiles = await this.getLocalFiles();

        // 3. Compute diff
        const diff = computeDiff(localFiles, remoteFiles, this.settings.ignorePatterns);

        // 4. Execute sync
        const manager = new SyncManager(client, this.getVaultAdapter(), this.settings.remotePath);
        const report = await manager.executeSync(diff);

        if (report.errors.length > 0) {
          this.setStatusBar('partial-error');
          new Notice(`Sync finished with errors: ↑${report.uploadedCount} ↓${report.downloadedCount} ⚡${report.conflictCount} ❌${report.errors.length} failed. Check console for details.`);
          console.warn('[SynologySync] Sync completed with errors:', report.errors);
        } else {
          this.setStatusBar('idle', 'Synced');
          new Notice(`Sync Done: ↑${report.uploadedCount} ↓${report.downloadedCount} ⚡${report.conflictCount}`);
        }
      } finally {
        await client.logout().catch(console.error);
      }
    } catch (e: any) {
      this.setStatusBar('error');
      new Notice(`Sync Failed: ${e.message || e}`);
      console.error('[SynologySync]', e);
    } finally {
      this.isSyncing = false;
    }
  }
}
