# Synology Sync for Obsidian (`obsidian-synology-sync`)

[![Version](https://img.shields.io/badge/version-1.1.1-blue.svg)](package.json)
[![Author](https://img.shields.io/badge/author-fang-orange.svg)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

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
4. **安全增量同步与冲突副本保护**：
   - 基于文件修改时间 (`mtime`) 与大小进行增量比对；
   - 多端同时修改同一笔记时自动生成带时间戳的安全冲突副本（`*.conflict-syno-<timestamp>.md`），绝不静默覆盖丢失用户数据。
5. **健壮性与安全防护**：
   - 支持群晖 `SYNO.FileStation.List` 官方 `offset` / `limit` / `total` 分页循环拉取（杜绝 >1000 大目录截断）；
   - 递归防死循环保护（深度上限 30 层与 Set 路径防环）；
   - 文件名防注入与双引号转义；
   - 同步删除接口采用原生同步阻塞删除方法（`method=delete`）。

---

## 📂 项目结构

```text
obsindiantodsm/
├── src/
│   ├── main.ts                     # 插件入口、生命周期管理、状态栏与命令注册
│   ├── types.ts                    # 核心数据模型、配置定义、差异比对类型
│   ├── syno/
│   │   ├── api-client.ts           # 群晖 DSM File Station Web API 客户端封装
│   │   └── qc-resolver.ts          # QuickConnect 智能解析器与 Serv.php 中继隧道建立
│   ├── sync/
│   │   ├── diff-engine.ts          # 差异比对引擎、时间戳标准化与忽略规则匹配
│   │   └── sync-manager.ts         # 同步执行事务管理器、原子写入与安全冲突副本
│   └── settings/
│       └── settings-tab.ts         # Obsidian 设置面板 UI
├── CHANGELOG.md                    # 版本更新与开发日志
├── package.json                    # npm 依赖与构建脚本
├── manifest.json                   # Obsidian 插件元数据 (v1.1.1, author: fang)
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
- 更新说明同步记录在 `CHANGELOG.md` 并同步至 Obsidian 笔记库。
