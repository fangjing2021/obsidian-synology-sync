# Synology Sync for Obsidian (`obsidian-synology-sync`)

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](package.json)
[![Author](https://img.shields.io/badge/author-fang-orange.svg)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-71%2F71%20passing-brightgreen.svg)](tests/)

一套专为 Obsidian 用户量身打造的**私有化、全平台兼容、服务端 0 部署**的群晖 NAS 双向同步插件。通过 DSM 原生 File Station Web API 和 QuickConnect 官方中继穿透技术，实现内网极速直连、外网无公网 IP 自动穿透的无缝同步体验。

---

## 🌟 核心特性

1. **群晖服务端零改动（Zero-Deployment）**：
   - 100% 依赖 DSM 原生内置的 **File Station Web API**（`SYNO.API.Auth`, `SYNO.FileStation.List`, `Upload`, `Download`, `Delete`）。
   - NAS 无需安装 Docker、WebDAV、Node 或第三方常驻后台，系统额外开销为 0。
2. **全平台原生支持（Mac / Windows / iOS / Android）**：
   - 网络传输层统一采用 Obsidian 原生 `requestUrl` 接口，原生规避浏览器 CORS 跨域限制及移动端环境兼容性问题。
3. **局域网与外网 QuickConnect 双模自适应穿透**：
   - **回家局域网直连**：自动探测内网 IP（如 `192.168.1.100:5000`），享受千兆内网高速秒级同步；
   - **外网 QuickConnect 官方中继**：离开局域网自动静默跳过内网，通过 `Serv.php` 跟随区域重定向（`sites`），自动识别或通过 `request_tunnel` 唤醒群晖官方 HTTPS 中继隧道（如 `https://my-nas.cn4.quickconnect.cn`）。
4. **安全 3-Way 双向增量同步、删除同步与冲突保护**：
   - 引入持久化状态快照基准（`lastSyncIndex`），实现真正的三方增量对比，杜绝无状态竞态覆盖；
   - 支持文件双向删除同步（本地删除移入系统回收站），彻底杜绝已删文件“复活”；
   - 多端同时修改同一笔记时自动生成带时间戳的安全冲突副本（`*.conflict-syno-<timestamp>.md`），绝不静默覆盖丢失用户数据。
5. **健壮性与安全防护**：
   - **登录鉴权升级**：账号密码采用 `POST` 请求体传输，杜绝 URL Query 凭证泄漏；
   - **上传 `mtime` 保持**：文件上传携带原始修改时间戳，杜绝群晖覆盖时间引发的“乒乓”反向同步；
   - **会话复用与连接池**：智能缓存 `sid` 与 `baseUrl`，会话失效（105/106/107/119）自动重连；
   - **受控并发传输**：并发池控制（`CONCURRENCY = 3`），大幅加速外网大批量文件同步；
   - **大目录官方分页**：支持群晖 `SYNO.FileStation.List` 官方 `offset` / `limit` / `total` 循环分页拉取（杜绝 >1000 大目录截断）；
   - **防环与路径保护**：递归深度上限 30 层与 Set 路径防环；文件名防注入与特殊字符转义；
   - **默认配置隔离**：默认屏蔽 `.obsidian/**` 与 `.git/**`，规避系统文件冲突。

---

## 📂 项目结构

```text
obsindiantodsm/
├── src/
│   ├── main.ts                     # 插件入口、生命周期管理、会话缓存、状态栏与命令注册
│   ├── types.ts                    # 核心数据模型、配置定义、差异比对与状态快照类型
│   ├── syno/
│   │   ├── api-client.ts           # 群晖 DSM File Station Web API 客户端封装 (POST 鉴权, mtime 保持)
│   │   └── qc-resolver.ts          # QuickConnect 智能解析器与 Serv.php 中继隧道建立
│   ├── sync/
│   │   ├── diff-engine.ts          # 3-Way 差异比对引擎、状态快照与忽略规则匹配
│   │   └── sync-manager.ts         # 同步执行事务管理器、受控并发传输、原子写入与安全冲突副本
│   └── settings/
│       └── settings-tab.ts         # Obsidian 设置面板 UI
├── CHANGELOG.md                    # 版本更新与开发日志
├── package.json                    # npm 依赖与构建脚本
├── manifest.json                   # Obsidian 插件元数据 (v1.2.0, author: fang)
└── esbuild.config.mjs              # 单文件打包配置
```

---

## 🛠️ 快速上手

### 1. 安装与构建

```bash
# 安装依赖
npm install

# 生产环境编译单文件
npm run build
```

编译生成产物为根目录下的 `main.js`。

### 2. 插件安装

将编译好的 `main.js`、`manifest.json` 复制到你的 Obsidian Vault 插件目录：
`<VaultPath>/.obsidian/plugins/obsidian-synology-sync/`

### 3. 配置说明

在 Obsidian 设置中填写：
- **QuickConnect ID**：你的群晖 QuickConnect ID（如 `my-nas`）
- **LAN Address**（可选）：家庭局域网地址（如 `http://192.168.1.100:5000`）
- **DSM Account**：具有 FileStation 读写权限的群晖账号
- **DSM Password**：群晖密码（仅保存在本地设备 `data.json`）
- **Remote Vault Path**：群晖端的目标路径（如 `/homes/username/ObsidianVault`）

---

## 📜 维护规范

根据项目维护准则：
- 每次更新发布必须递增 `manifest.json` 与 `package.json` 中的版本号。
- 作者元数据固定保持为 `"fang"`。
- 更新说明同步记录在 `CHANGELOG.md`。
