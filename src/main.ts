import { Plugin, Notice, requestUrl, RequestUrlParam, TFile, normalizePath } from 'obsidian';
import { SynoSyncSettings, DEFAULT_SETTINGS, LocalFileItem, SyncIndex } from './types';
import { SynologySyncSettingTab } from './settings/settings-tab';
import { QuickConnectResolver } from './syno/qc-resolver';
import { SynologyApiClient, HttpRequester } from './syno/api-client';
import { computeDiff } from './sync/diff-engine';
import { SyncManager, VaultAdapter } from './sync/sync-manager';

export default class SynologySyncPlugin extends Plugin {
  settings: SynoSyncSettings = DEFAULT_SETTINGS;
  syncIndex: SyncIndex = {};
  private statusBarEl!: HTMLElement;
  private isSyncing: boolean = false;
  private syncIntervalId: number | null = null;
  private activeClient: SynologyApiClient | null = null;

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

    // 6. Auto sync on startup using official onLayoutReady hook
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoSyncOnStartup) {
        this.runSync().catch(console.error);
      }
    });

    // 7. Setup periodic interval sync
    this.setupSyncInterval();
  }

  onunload() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    if (this.activeClient) {
      this.activeClient.logout().catch(console.error);
      this.activeClient = null;
    }
    this.setStatusBar('offline');
  }

  async loadSettings() {
    const data = await this.loadData();
    if (data) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || data);
      this.syncIndex = data.syncIndex || {};
    } else {
      this.settings = Object.assign({}, DEFAULT_SETTINGS);
      this.syncIndex = {};
    }
  }

  async saveSettings() {
    await this.saveData({
      settings: this.settings,
      syncIndex: this.syncIndex,
    });
  }

  resetActiveSession() {
    if (this.activeClient) {
      this.activeClient.logout().catch(console.error);
      this.activeClient = null;
    }
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
        return JSON.parse(res.text.trim());
      } catch {
        // Fallback to res.json if text parse fails
      }
    }
    return res.json;
  }

  private createResolver(): QuickConnectResolver {
    const pingFn = async (url: string) => {
      let timeoutHandle: any = null;
      const timeoutPromise = new Promise<boolean>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(false), 2000);
      });

      const pingPromise = (async () => {
        try {
          const res = await requestUrl({
            url: `${url}/webapi/entry.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth`,
            method: 'GET',
            throw: false,
          });
          const data = this.parseJsonResponse(res);
          if (data && data.success === true) return true;

          if (res.status === 200 || res.status === 404 || res.status === 302) {
            const fallback = await requestUrl({
              url: `${url}/webapi/auth.cgi?api=SYNO.API.Auth&version=1&method=query`,
              method: 'GET',
              throw: false,
            });
            const fbData = this.parseJsonResponse(fallback);
            return Boolean(fbData && fbData.success === true);
          }
          return false;
        } catch {
          return false;
        } finally {
          if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
          }
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
          // 移动到系统或 Obsidian 回收站，防止误删
          await this.app.vault.trash(file, true);
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

  private async getAuthenticatedClient(): Promise<SynologyApiClient> {
    if (this.activeClient && this.activeClient.getSid()) {
      return this.activeClient;
    }

    const http = this.getHttpRequester();
    const resolver = this.createResolver();

    const baseUrl = await resolver.resolveBaseUrl(this.settings.quickConnectId, this.settings.lanAddress);
    const client = new SynologyApiClient(baseUrl, http);
    await client.login(this.settings.account, this.settings.password);

    this.activeClient = client;
    return client;
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

    try {
      let client = await this.getAuthenticatedClient();

      let remoteFiles;
      try {
        remoteFiles = await client.listFiles(this.settings.remotePath);
      } catch (err: any) {
        // 若会话超时失效 (DSM error 105, 106, 107, 119)，清除缓存并重新登录一次
        const errMsg = String(err?.message || err);
        const isSessionExpired =
          errMsg.includes('105') || errMsg.includes('106') || errMsg.includes('107') || errMsg.includes('119');
        if (isSessionExpired) {
          this.activeClient = null;
          client = await this.getAuthenticatedClient();
          remoteFiles = await client.listFiles(this.settings.remotePath);
        } else {
          throw err;
        }
      }

      // 1. Fetch local files
      const localFiles = await this.getLocalFiles();

      // 2. Compute 3-way diff
      const diff = computeDiff(localFiles, remoteFiles, this.settings.ignorePatterns, this.syncIndex);

      // 3. Execute sync
      const manager = new SyncManager(client, this.getVaultAdapter(), this.settings.remotePath, this.syncIndex);
      const report = await manager.executeSync(diff);

      // 4. Update and persist syncIndex
      if (report.updatedIndex) {
        this.syncIndex = report.updatedIndex;
        await this.saveSettings();
      }

      if (report.errors.length > 0) {
        this.setStatusBar('partial-error');
        new Notice(
          `Sync finished with errors: ↑${report.uploadedCount} ↓${report.downloadedCount} ⚡${report.conflictCount} 🗑️${report.deletedRemoteCount + report.deletedLocalCount} ❌${report.errors.length} failed.`
        );
        console.warn('[SynologySync] Sync completed with errors:', report.errors);
      } else {
        this.setStatusBar('idle', 'Synced');
        new Notice(
          `Sync Done: ↑${report.uploadedCount} ↓${report.downloadedCount} ⚡${report.conflictCount} 🗑️${report.deletedRemoteCount + report.deletedLocalCount}`
        );
      }
    } catch (e: any) {
      this.setStatusBar('error');
      new Notice(`Sync Failed: ${e.message || e}`);
      console.error('[SynologySync]', e);
      // 若是网络不可达或关键错误，重置缓存以便下次重新探活
      this.activeClient = null;
    } finally {
      this.isSyncing = false;
    }
  }
}
