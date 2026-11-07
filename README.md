# Synology QuickSync for Obsidian (`synology-quicksync`)

[![Version](https://img.shields.io/badge/version-1.3.4-blue.svg)](package.json)
[![Author](https://img.shields.io/badge/author-fang-orange.svg)](https://github.com/fangjing2021)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-73%2F73%20passing-brightgreen.svg)](tests/)

A secure, private, zero-deployment 3-way synchronization plugin connecting your Obsidian vault directly to your Synology NAS. Powered by DSM's native File Station Web API and Synology QuickConnect smart relay routing.

[English](#-overview) | [中文说明](#-中文说明)

---

## 🌟 Overview

**Synology QuickSync** enables seamless, encrypted note synchronization between your local Obsidian vault and your Synology NAS without requiring any server-side dependencies or third-party background services.

### Key Highlights

1. **Zero Server Modification (Zero-Deployment)**:
   - 100% utilizes native Synology DSM **File Station Web API** (`SYNO.API.Auth`, `SYNO.FileStation.List`, `Upload`, `Download`, `Delete`).
   - No Docker containers, WebDAV server packages, Node.js services, or custom daemons required on your NAS.
2. **Cross-Platform Compatibility (Desktop & Mobile)**:
   - Built on top of Obsidian's native `requestUrl` networking API, completely bypassing browser CORS restrictions and running flawlessly across macOS, Windows, Linux, iOS, and Android.
3. **Dual-Mode Network Routing (LAN & QuickConnect WAN)**:
   - **Local Area Network (LAN)**: Automatically detects local network IP (`192.168.x.x:5000`) for high-speed, direct gigabit sync.
   - **QuickConnect Relay (WAN)**: When away from home, intelligently queries `Serv.php`, parses region redirects, and routes through Synology's official secure HTTPS relay tunnel (e.g. `https://my-nas.quickconnect.to`).
4. **Safe 3-Way Differential Sync & Conflict Protection**:
   - Maintains a persistent local baseline index (`syncIndex`) to accurately compute 3-way diffs (uploads, downloads, deletions).
   - Bidirectional file deletions are safely routed through Obsidian's native trash management (`FileManager.trashFile`), preventing deleted files from unexpectedly re-appearing.
   - True conflict resolution: when notes are modified concurrently across devices, safe timestamped conflict copies (`*.conflict-syno-<timestamp>.md`) are generated, guaranteeing zero data loss.
5. **Security & Data Integrity**:
   - All credentials and sessions are strictly stored in local `data.json` inside your private vault.
   - Authentication uses encrypted HTTP POST request bodies—never passing passwords via URL query strings.
   - File uploads preserve native file modification timestamps (`mtime`), preventing endless ping-pong sync cycles.
   - Automatically respects and protects dynamic vault configuration folders (`Vault#configDir`).

---

## 🚀 Getting Started

### Installation

#### From Obsidian Community Plugins
1. Open **Obsidian Settings** > **Community plugins**.
2. Search for **Synology QuickSync**.
3. Click **Install**, then **Enable**.

#### Manual Installation
1. Download the latest `main.js` and `manifest.json` from the [Releases](https://github.com/fangjing2021/obsidian-synology-sync/releases) page.
2. Place them into your vault's plugin directory: `<Vault>/.obsidian/plugins/synology-quicksync/`.
3. Reload Obsidian and enable **Synology QuickSync** in Settings.

### Configuration

Open **Settings > Synology QuickSync Settings**:

- **QuickConnect ID**: Your Synology QuickConnect ID (e.g. `my-nas`) for WAN remote access.
- **LAN Address** *(Optional)*: Your local NAS URL (e.g. `http://192.168.1.100:5000`) for fast local transfers.
- **DSM Account**: DSM user account with read/write permissions to the target folder.
- **DSM Password**: DSM password (stored securely only on your local device).
- **Remote Vault Path**: Target directory on Synology NAS (e.g. `/homes/username/ObsidianVault` or `/Drive/Notes`).
- **Auto-sync on Startup**: Automatically synchronizes your vault when Obsidian starts.
- **Sync Interval**: Periodic background sync timer (e.g. every 5, 15, or 30 minutes).

---

## 🛠️ Development & Building

```bash
# Clone the repository
git clone https://github.com/fangjing2021/obsidian-synology-sync.git
cd obsidian-synology-sync

# Install dependencies
npm install

# Run unit tests
npm test

# Build production bundle
npm run build
```

---

## 🇨🇳 中文说明

一套专为 Obsidian 用户量身打造的**私有化、全平台兼容、服务端 0 部署**的群晖 NAS 双向同步插件。通过 DSM 原生 File Station Web API 和 QuickConnect 官方中继穿透技术，实现内网极速直连、外网无公网 IP 自动穿透的无缝同步体验。

### 🌟 核心特性

1. **群晖服务端零改动（Zero-Deployment）**：
   - 100% 依赖 DSM 原生内置的 **File Station Web API**（`SYNO.API.Auth`, `SYNO.FileStation.List`, `Upload`, `Download`, `Delete`）。
   - NAS 无需安装 Docker、WebDAV、Node 或第三方常驻后台，系统额外开销为 0。
2. **全平台原生支持（Mac / Windows / iOS / Android）**：
   - 网络传输层统一采用 Obsidian 原生 `requestUrl` 接口，原生规避浏览器 CORS 跨域限制及移动端环境兼容性问题。
3. **局域网与外网 QuickConnect 双模自适应穿透**：
   - **回家局域网直连**：自动探测内网 IP（如 `192.168.1.100:5000`），享受千兆内网高速秒级同步；
   - **外网 QuickConnect 官方中继**：离开局域网自动静默跳过内网，通过 `Serv.php` 跟随区域重定向，自动唤醒群晖官方 HTTPS 中继隧道。
4. **安全 3-Way 双向增量同步、删除同步与冲突保护**：
   - 引入持久化状态快照基准（`lastSyncIndex`），实现真正的三方增量对比；
   - 支持文件双向删除同步（本地删除移入回收站），彻底杜绝已删文件“复活”；
   - 多端同时修改同一笔记时自动生成带时间戳的安全冲突副本（`*.conflict-syno-<timestamp>.md`），绝不静默覆盖丢失用户数据。
5. **健壮性与安全防护**：
   - **登录鉴权升级**：账号密码采用 `POST` 请求体传输，杜绝凭证泄漏；
   - **上传 `mtime` 保持**：文件上传携带原始修改时间戳，杜绝群晖覆盖时间引发的“乒乓”反向同步；
   - **受控并发传输**：并发池控制（`CONCURRENCY = 3`），大幅加速外网大批量文件同步；
   - **配置路径隔离**：动态识别并安全跳过用户配置目录（`Vault#configDir`）及 `.git/**`。

---

## 📄 License

[MIT License](LICENSE) © 2026 fang
