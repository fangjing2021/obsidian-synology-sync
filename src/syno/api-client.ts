import { RemoteFileItem } from '../types';

export interface HttpRequestOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | FormData;
}

export interface HttpResponse {
  status: number;
  json?: any;
  arrayBuffer?: ArrayBuffer;
  text?: string;
}

export type HttpRequester = (options: HttpRequestOptions) => Promise<HttpResponse>;

export class SynologyApiClient {
  private baseUrl: string;
  private sid: string = '';
  private http: HttpRequester;

  constructor(baseUrl: string, http: HttpRequester) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.http = http;
  }

  setSid(sid: string) {
    this.sid = sid;
  }

  getSid(): string {
    return this.sid;
  }

  async login(account: string, passwd: string, otpCode?: string): Promise<string> {
    const buildAuthUrl = (version: number) => {
      let u = `${this.baseUrl}/webapi/auth.cgi?api=SYNO.API.Auth&version=${version}&method=login&account=${encodeURIComponent(account)}&passwd=${encodeURIComponent(passwd)}&session=FileStation&format=sid`;
      if (otpCode) {
        u += `&otp_code=${encodeURIComponent(otpCode)}`;
      }
      return u;
    };

    let res = await this.http({ url: buildAuthUrl(6), method: 'GET' });
    let json = res.json;

    // 若旧版 DSM 不支持 version=6 (错误码 104)，自动降级为 version=3 重试
    if (json && !json.success && json.error?.code === 104) {
      res = await this.http({ url: buildAuthUrl(3), method: 'GET' });
      json = res.json;
    }

    if (!json) {
      if (res.text && (res.text.includes('<!doctype') || res.text.includes('<html') || res.text.includes('<script'))) {
        throw new Error(
          `无法直连群晖 DSM API（当前节点 ${this.baseUrl} 返回了网页 HTML 而非 JSON 接口）。请确认 QuickConnect ID 是否正确，以及群晖「控制面板 -> 外部访问 -> QuickConnect」及中继服务是否已开启。`
        );
      }
      throw new Error(`Invalid response from server (Status: ${res.status})`);
    }

    if (!json.success || !json.data?.sid) {
      const code = json?.error?.code || 'unknown';
      throw new Error(`Authentication failed (Error code: ${code})`);
    }

    this.sid = json.data.sid;
    return this.sid;
  }

  async logout(): Promise<void> {
    if (!this.sid) return;
    const url = `${this.baseUrl}/webapi/auth.cgi?api=SYNO.API.Auth&version=6&method=logout&session=FileStation&_sid=${this.sid}`;
    try {
      await this.http({ url, method: 'GET' });
    } finally {
      this.sid = '';
    }
  }

  async listFiles(
    remoteVaultRoot: string,
    currentFolder?: string,
    depth = 0,
    visitedPaths: Set<string> = new Set<string>()
  ): Promise<RemoteFileItem[]> {
    const cleanRoot = remoteVaultRoot.replace(/\/+$/, '');
    const folderToQuery = currentFolder ? currentFolder.replace(/\/+$/, '') : cleanRoot;

    // 防止符号链接成环或异常深层目录引发调用栈溢出
    if (depth > 30 || visitedPaths.has(folderToQuery)) {
      return [];
    }
    visitedPaths.add(folderToQuery);

    let offset = 0;
    const limit = 1000;
    const allRawFiles: any[] = [];

    // 分页获取目录下所有条目（处理群晖默认单页限制）
    while (true) {
      const url = `${this.baseUrl}/webapi/entry.cgi?api=SYNO.FileStation.List&version=2&method=list&folder_path=${encodeURIComponent(folderToQuery)}&offset=${offset}&limit=${limit}&additional=time,size,md5&_sid=${this.sid}`;
      const res = await this.http({ url, method: 'GET' });
      const json = res.json;

      if (!json || !json.success) {
        const code = json?.error?.code || 'unknown';
        throw new Error(`Failed to list files under ${folderToQuery} (Error code: ${code})`);
      }

      const files: any[] = json.data?.files || [];
      allRawFiles.push(...files);
      const total = typeof json.data?.total === 'number' ? json.data.total : 0;

      if (files.length === 0) {
        break;
      }
      if (total > 0) {
        if (allRawFiles.length >= total) {
          break;
        }
      } else if (files.length < limit) {
        break;
      }
      offset += files.length;
    }

    let results: RemoteFileItem[] = [];

    for (const f of allRawFiles) {
      const fullPath: string = f.path;
      // Calculate relative path
      let relPath = fullPath.startsWith(cleanRoot) ? fullPath.slice(cleanRoot.length) : fullPath;
      relPath = relPath.replace(/^\/+/, '');

      results.push({
        path: relPath,
        fullRemotePath: fullPath,
        isdir: Boolean(f.isdir),
        mtime: f.additional?.time?.mtime ? f.additional.time.mtime * 1000 : 0,
        size: f.additional?.size || 0,
        md5: f.additional?.md5 || undefined,
      });

      if (f.isdir) {
        const subFiles = await this.listFiles(remoteVaultRoot, fullPath, depth + 1, visitedPaths);
        results = results.concat(subFiles);
      }
    }

    return results;
  }

  async uploadFile(targetFolder: string, fileName: string, content: ArrayBuffer): Promise<void> {
    const url = `${this.baseUrl}/webapi/entry.cgi?api=SYNO.FileStation.Upload&version=2&method=upload&_sid=${encodeURIComponent(this.sid)}`;
    const boundary = '----SynoSyncFormBoundary' + Math.random().toString(36).substring(2);

    // 对文件名进行安全性转义，防止破坏 multipart 边界
    const safeFileName = fileName.replace(/[\r\n]/g, '').replace(/"/g, '\\"');

    // Build multipart body
    const encoder = new TextEncoder();
    const prefix = 
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="api"\r\n\r\nSYNO.FileStation.Upload\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="version"\r\n\r\n2\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="method"\r\n\r\nupload\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="_sid"\r\n\r\n${this.sid}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="path"\r\n\r\n${targetFolder}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="create_parents"\r\n\r\ntrue\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeFileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`;

    const suffix = `\r\n--${boundary}--\r\n`;

    const prefixBytes = encoder.encode(prefix);
    const suffixBytes = encoder.encode(suffix);
    const contentBytes = new Uint8Array(content);

    const merged = new Uint8Array(prefixBytes.length + contentBytes.length + suffixBytes.length);
    merged.set(prefixBytes, 0);
    merged.set(contentBytes, prefixBytes.length);
    merged.set(suffixBytes, prefixBytes.length + contentBytes.length);

    const res = await this.http({
      url,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: merged.buffer,
    });

    const json = res.json;
    if (!json || !json.success) {
      const code = json?.error?.code || 'unknown';
      throw new Error(`Upload failed for ${fileName} (Error code: ${code})`);
    }
  }

  async downloadFile(fullRemotePath: string): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&path=${encodeURIComponent(fullRemotePath)}&mode=open&_sid=${this.sid}`;
    const res = await this.http({ url, method: 'GET' });
    if (res.json && res.json.success === false) {
      const code = res.json?.error?.code || 'unknown';
      throw new Error(`Failed to download ${fullRemotePath} (Error code: ${code})`);
    }
    if (res.status !== 200 || !res.arrayBuffer) {
      throw new Error(`Failed to download ${fullRemotePath} (Status: ${res.status})`);
    }
    return res.arrayBuffer;
  }

  async deleteFile(fullRemotePath: string): Promise<void> {
    const url = `${this.baseUrl}/webapi/entry.cgi?api=SYNO.FileStation.Delete&version=2&method=delete&path=${encodeURIComponent(fullRemotePath)}&_sid=${this.sid}`;
    const res = await this.http({ url, method: 'GET' });
    const json = res.json;
    if (!json || !json.success) {
      const code = json?.error?.code || 'unknown';
      throw new Error(`Failed to delete ${fullRemotePath} (Error code: ${code})`);
    }
  }
}
