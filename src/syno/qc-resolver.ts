// src/syno/qc-resolver.ts

export type PingFunction = (url: string, timeoutMs: number) => Promise<boolean>;
export type QCHttpFetcher = (url: string, body: any) => Promise<any>;

export interface ServerInfoResult {
  lanIps: string[];
  httpPort: number;
  httpsPort: number;
  extHttpPort?: number;
  extHttpsPort?: number;
  smartDnsHost?: string;
  smartDnsLan?: string[];
  ddns?: string;
  fqdn?: string;
  externalIp?: string;
  controlHost?: string;
  relayRegion?: string;
  relayDn?: string;
  relayIp?: string;
  relayPort?: number;
  isTunnelExists?: boolean;
}

export class QuickConnectResolver {
  private pingFn: PingFunction;
  private qcFetcher?: QCHttpFetcher;

  constructor(pingFn: PingFunction, qcFetcher?: QCHttpFetcher) {
    this.pingFn = pingFn;
    this.qcFetcher = qcFetcher;
  }

  /**
   * 智能解析基础请求 URL。
   * 1. 若配置了局域网地址且当前探测可达，优先直连局域网；若不在该局域网则静默跳过；
   * 2. 若配置了 QuickConnect ID，向群晖全局/区域控制服务器 (Serv.php) 查询设备信息（支持 sites 区域重定向）；
   * 3. 并发探测群晖上报的直连地址（内网 IP、SmartDNS、DDNS、公网端口映射）；
   * 4. 若直连均不可达（处于外网且无公网端口映射），使用或唤醒 QuickConnect 官方中继隧道。
   */
  async resolveBaseUrl(quickConnectId: string, lanAddress?: string): Promise<string> {
    const rawLan = lanAddress?.trim().replace(/\/+$/, '') || '';
    const cleanLan = rawLan && !/^https?:\/\//i.test(rawLan) ? `http://${rawLan}` : rawLan;
    const cleanQcId = (quickConnectId || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/(\.[a-z0-9-]+)?\.quickconnect\.(to|cn)$/i, '');

    // 1. 若配置了局域网地址，先快速探测是否在同一局域网内；若不可达则静默进入 QuickConnect 外网解析
    if (cleanLan) {
      const candidates = [cleanLan];
      if (cleanLan.endsWith(':50')) {
        candidates.push(cleanLan + '00');
      } else if (!cleanLan.match(/:\d+$/)) {
        candidates.push(cleanLan + ':5000');
      }

      for (const candidate of candidates) {
        try {
          if (await this.pingFn(candidate, 1500)) {
            return candidate;
          }
        } catch {
          // 当前不在该局域网内，忽略并继续走 QuickConnect
        }
      }
    }

    // 2. 通过 QuickConnect 服务解析（支持内网自动发现、公网直连探测、外网 Relay 中继隧道）
    if (cleanQcId && this.qcFetcher) {
      try {
        const info = await this.fetchServerInfo(cleanQcId);
        if (info) {
          // 2a. 收集所有可能的直连候选地址（必须经过 pingFn 探活验证，绝不盲目返回未探活的直连地址）
          const directCandidates: string[] = [];

          for (const ip of info.lanIps) {
            directCandidates.push(`http://${ip}:${info.httpPort}`);
            directCandidates.push(`https://${ip}:${info.httpsPort}`);
          }

          if (info.smartDnsLan) {
            for (const lanHost of info.smartDnsLan) {
              directCandidates.push(`https://${lanHost}:${info.httpsPort}`);
            }
          }

          if (info.smartDnsHost) {
            if (info.extHttpsPort) {
              directCandidates.push(`https://${info.smartDnsHost}:${info.extHttpsPort}`);
            }
            directCandidates.push(`https://${info.smartDnsHost}:${info.httpsPort}`);
          }

          if (info.ddns) {
            if (info.extHttpsPort) {
              directCandidates.push(`https://${info.ddns}:${info.extHttpsPort}`);
            }
            directCandidates.push(`https://${info.ddns}:${info.httpsPort}`);
            if (info.extHttpPort) {
              directCandidates.push(`http://${info.ddns}:${info.extHttpPort}`);
            }
          }

          if (info.fqdn) {
            directCandidates.push(`https://${info.fqdn}:${info.httpsPort}`);
            directCandidates.push(`http://${info.fqdn}:${info.httpPort}`);
          }

          if (info.externalIp) {
            if (info.extHttpsPort) {
              directCandidates.push(`https://${info.externalIp}:${info.extHttpsPort}`);
            }
            if (info.extHttpPort) {
              directCandidates.push(`http://${info.externalIp}:${info.extHttpPort}`);
            }
          }

          const uniqueDirect = Array.from(new Set(directCandidates));
          if (uniqueDirect.length > 0) {
            const probeResults = await Promise.all(
              uniqueDirect.map(async (candidate) => {
                try {
                  return (await this.pingFn(candidate, 1500)) ? candidate : null;
                } catch {
                  return null;
                }
              })
            );
            const aliveDirect = probeResults.find((url) => url !== null);
            if (aliveDirect) {
              return aliveDirect;
            }
          }

          // 2b. 若所有直连地址均不可达（设备处于外网且无公网端口转发），解析并探测 QuickConnect 中继隧道
          const tunnelCandidates = await this.resolveRelayTunnelCandidates(cleanQcId, info);
          if (tunnelCandidates.length > 0) {
            for (const tunnelUrl of tunnelCandidates) {
              try {
                if (await this.pingFn(tunnelUrl, 4000)) {
                  return tunnelUrl;
                }
              } catch {
                // 继续探测下一个中继候选地址
              }
            }
            // 若隧道刚建立仍在握手中，返回首选官方 HTTPS 中继隧道地址
            return tunnelCandidates[0];
          }
        }
      } catch (e) {
        console.warn('[QuickConnectResolver] Serv.php resolution failed:', e);
      }
    }

    // 3. 兜底策略
    if (cleanQcId) {
      return `https://${cleanQcId}.quickconnect.to`;
    }

    if (cleanLan) {
      return cleanLan;
    }

    throw new Error('Please configure QuickConnect ID or LAN Address in settings.');
  }

  private async fetchServerInfo(quickConnectId: string): Promise<ServerInfoResult | null> {
    if (!this.qcFetcher) return null;

    // 注意：群晖 Serv.php 严格限制请求体大小（超过约 350 字节会返回 HTTP 413），因此严格按照群晖官方客户端仅发送 2 项
    const payload = [
      {
        version: 1,
        command: 'get_server_info',
        stop_when_error: false,
        stop_when_success: false,
        id: 'mainapp_https',
        serverID: quickConnectId,
        is_gofile: false,
        path: '',
      },
      {
        version: 1,
        command: 'get_server_info',
        stop_when_error: false,
        stop_when_success: false,
        id: 'mainapp_http',
        serverID: quickConnectId,
        is_gofile: false,
        path: '',
      },
    ];

    const queue = [
      'https://global.quickconnect.cn/Serv.php',
      'https://global.quickconnect.to/Serv.php',
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const ep = queue.shift()!;
      if (visited.has(ep)) continue;
      visited.add(ep);

      try {
        const res = await this.qcFetcher(ep, payload);
        const items = Array.isArray(res) ? res : res ? [res] : [];

        // 处理 errno === 4 时的区域控制服务器重定向 (如 sites: ["cnc.quickconnect.cn"])
        const redirectSites: string[] = [];
        for (const item of items) {
          if (item && Array.isArray(item.sites)) {
            for (const site of item.sites) {
              if (typeof site === 'string' && site.trim()) {
                const siteUrl = site.startsWith('http') ? site : `https://${site.trim()}/Serv.php`;
                if (!visited.has(siteUrl) && !queue.includes(siteUrl)) {
                  redirectSites.push(siteUrl);
                }
              }
            }
          }
        }
        if (redirectSites.length > 0) {
          queue.unshift(...redirectSites);
        }

        // 解析 errno === 0 的有效 server 信息
        const successItems = items.filter((item) => item && item.errno === 0 && item.server);
        if (successItems.length > 0) {
          const first = successItems[0];
          const lanIps: string[] = [];
          if (Array.isArray(first.server.interface)) {
            for (const iface of first.server.interface) {
              if (iface.ip && !iface.ip.startsWith('127.')) {
                lanIps.push(iface.ip);
              }
            }
          }

          let httpPort = 5000;
          let httpsPort = 5001;
          let extHttpPort: number | undefined;
          let extHttpsPort: number | undefined;
          let relayDn: string | undefined;
          let relayIp: string | undefined;
          let relayPort: number | undefined;
          let controlHost: string | undefined;
          let relayRegion: string | undefined;
          let smartDnsHost: string | undefined;
          let smartDnsLan: string[] | undefined;
          let isTunnelExists = false;

          for (let idx = 0; idx < successItems.length; idx++) {
            const item = successItems[idx];
            const serviceId: string = item.service?.id || item.id || '';
            const isHttps = serviceId ? serviceId.includes('https') : idx === 0;
            const port = Number(item.service?.port);
            const extPort = Number(item.service?.ext_port);

            if (isHttps) {
              if (port > 0) httpsPort = port;
              if (extPort > 0) extHttpsPort = extPort;
            } else {
              if (port > 0) httpPort = port;
              if (extPort > 0) extHttpPort = extPort;
            }

            const hasTunnel = Boolean(
              (item.service?.relay_ip || item.service?.relay_dn) && Number(item.service?.relay_port) > 0
            );
            if (hasTunnel) {
              isTunnelExists = true;
              if (item.service?.relay_dn) relayDn = item.service.relay_dn;
              if (item.service?.relay_ip) relayIp = item.service.relay_ip;
              relayPort = Number(item.service.relay_port);
              // 优先绑定已激活隧道项对应的精确 relay_region (例如 "cn4"，避免被无隧道项的通用 "cn" 覆盖)
              if (item.env?.relay_region) {
                relayRegion = item.env.relay_region;
              }
            } else if (!relayRegion && item.env?.relay_region) {
              relayRegion = item.env.relay_region;
            }

            if (item.env?.control_host) controlHost = item.env.control_host;
            if (item.smartdns?.host) smartDnsHost = item.smartdns.host;
            if (Array.isArray(item.smartdns?.lan)) smartDnsLan = item.smartdns.lan;
          }

          if (!controlHost) {
            const match = ep.match(/^https?:\/\/([^/]+)/i);
            if (match) controlHost = match[1];
          }

          const ddns = first.server.ddns && first.server.ddns !== 'NULL' ? first.server.ddns : undefined;
          const fqdn = first.server.fqdn && first.server.fqdn !== 'NULL' ? first.server.fqdn : undefined;
          const externalIp = first.server.external?.ip && first.server.external.ip !== 'NULL' ? first.server.external.ip : undefined;

          return {
            lanIps,
            httpPort,
            httpsPort,
            extHttpPort,
            extHttpsPort,
            smartDnsHost,
            smartDnsLan,
            ddns,
            fqdn,
            externalIp,
            controlHost,
            relayRegion,
            relayDn,
            relayIp,
            relayPort,
            isTunnelExists,
          };
        }
      } catch {
        // 继续尝试队列中的下一个控制服务器端点
      }
    }

    return null;
  }

  private async resolveRelayTunnelCandidates(quickConnectId: string, info: ServerInfoResult): Promise<string[]> {
    let relayRegion = info.relayRegion;
    let controlHost = info.controlHost || 'global.quickconnect.cn';
    let relayDn = info.relayDn;
    let relayIp = info.relayIp;
    let relayPort = info.relayPort;

    // 若 get_server_info 中尚未分配现成隧道，则发送单条 request_tunnel 唤醒中继隧道（避免多条触发 HTTP 413）
    if (!info.isTunnelExists && this.qcFetcher) {
      const controlEndpoint = controlHost.startsWith('http')
        ? controlHost
        : `https://${controlHost}/Serv.php`;

      const tunnelPayload = [
        {
          version: 1,
          command: 'request_tunnel',
          stop_when_error: false,
          stop_when_success: true,
          id: 'mainapp_https',
          serverID: quickConnectId,
          is_gofile: false,
          path: '',
        },
      ];

      try {
        const res = await this.qcFetcher(controlEndpoint, tunnelPayload);
        const items = Array.isArray(res) ? res : res ? [res] : [];
        for (const item of items) {
          if (item && item.errno === 0) {
            if (item.env?.relay_region) relayRegion = item.env.relay_region;
            if (item.env?.control_host) controlHost = item.env.control_host;
            if (item.service?.relay_dn) relayDn = item.service.relay_dn;
            if (item.service?.relay_ip) relayIp = item.service.relay_ip;
            if (Number(item.service?.relay_port) > 0) relayPort = Number(item.service.relay_port);
          }
        }
      } catch (e) {
        console.warn('[QuickConnectResolver] request_tunnel failed:', e);
      }
    }

    const candidates: string[] = [];

    // 1. 群晖官方标准 HTTPS 反向代理隧道域名: https://<qcId>.<relay_region>.quickconnect.<cn|to>
    if (relayRegion) {
      const isCn = controlHost.endsWith('.cn');
      const primaryTld = isCn ? 'cn' : 'to';
      const secondaryTld = isCn ? 'to' : 'cn';
      candidates.push(`https://${quickConnectId}.${relayRegion}.quickconnect.${primaryTld}`);
      candidates.push(`https://${quickConnectId}.${relayRegion}.quickconnect.${secondaryTld}`);
    }

    // 2. 备用直连 Relay 节点端口
    if (relayDn && relayPort) {
      candidates.push(`https://${relayDn}:${relayPort}`);
      candidates.push(`http://${relayDn}:${relayPort}`);
    }
    if (relayIp && relayPort) {
      candidates.push(`https://${relayIp}:${relayPort}`);
      candidates.push(`http://${relayIp}:${relayPort}`);
    }

    return Array.from(new Set(candidates));
  }
}

/**
 * 辅助函数：使用指定的探测函数解析基地址。
 */
export async function resolveBaseUrl(
  quickConnectId: string,
  lanAddress?: string,
  pingFn?: PingFunction,
  qcFetcher?: QCHttpFetcher
): Promise<string> {
  const resolver = new QuickConnectResolver(pingFn || (async () => false), qcFetcher);
  return resolver.resolveBaseUrl(quickConnectId, lanAddress);
}
