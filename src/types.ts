export interface SynoSyncSettings {
  quickConnectId: string;
  lanAddress: string;
  account: string;
  password: string;
  remotePath: string;
  autoSyncOnStartup: boolean;
  syncIntervalMinutes: number; // 0 = disabled, 5, 15, 30
  ignorePatterns: string[];
}

export const DEFAULT_SETTINGS: SynoSyncSettings = {
  quickConnectId: '',
  lanAddress: '',
  account: '',
  password: '',
  remotePath: '/homes',
  autoSyncOnStartup: true,
  syncIntervalMinutes: 0,
  ignorePatterns: [
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    '.obsidian/workspace.json',
    '.obsidian/cache/**',
    '*.tmp',
    '*.syno_download.tmp'
  ],
};

export interface RemoteFileItem {
  path: string;           // 相对库根目录路径，例如 "Notes/idea.md"
  fullRemotePath: string; // 完整群晖路径，例如 "/homes/user/Vault/Notes/idea.md"
  isdir: boolean;
  mtime: number;          // 秒级或毫秒级时间戳
  size: number;
  md5?: string;
}

export interface LocalFileItem {
  path: string;           // 相对库根目录路径
  mtime: number;          // 毫秒级时间戳
  size: number;
  md5?: string;
}

export type SyncActionType = 'upload' | 'download' | 'conflict' | 'delete_remote' | 'delete_local' | 'skip';

export interface SyncActionItem {
  path: string;
  action: SyncActionType;
  local?: LocalFileItem;
  remote?: RemoteFileItem;
  reason?: string;
}

export interface DiffResult {
  uploads: SyncActionItem[];
  downloads: SyncActionItem[];
  conflicts: SyncActionItem[];
  skips: SyncActionItem[];
}
