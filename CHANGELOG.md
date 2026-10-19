# Synology Sync (obsidian-synology-sync) 项目开发与更新日志

- **项目名称**：Synology Sync (`obsidian-synology-sync`)
- **作者**：`fang`
- **当前版本**：`v1.2.0`
- **项目源码路径**：`/Users/fj 1/Desktop/obsindiantodsm`
- **群晖同步目标路径**：`/homes/username/ObsidianVault`

---

## 一、项目架构与核心特性

1. **群晖服务端零改动**：
   - 100% 基于群晖 DSM 原生内置的 **File Station Web API**（`SYNO.API.Auth`、`SYNO.FileStation.List`、`Upload`、`Download`、`Delete`），无需在 NAS 上部署 Docker、WebDAV 或第三方服务。
2. **全平台原生支持（Mac / Windows / iOS / Android）**：
   - 网络层统一采用 Obsidian 原生 `requestUrl` 接口，完全规避 CORS 跨域限制与移动端兼容性问题。
3. **局域网与外网 QuickConnect 双模自适应穿透**：
   - **回家局域网直连**：自动探测局域网 IP（如 `192.168.1.100:5000`），享受千兆内网同步速度；
   - **外网 QuickConnect 官方中继穿透**：不在局域网时自动静默跳过内网地址，通过 `global.quickconnect.cn/Serv.php` 跟随 `sites` 区域重定向至 `cnc.quickconnect.cn`，自动识别或通过 `request_tunnel` 唤醒群晖官方 HTTPS 中继隧道（如 `https://my-nas.cn4.quickconnect.cn`）。
4. **安全 3-Way 双向增量同步、删除同步与冲突保护**：
   - 引入持久化状态快照基准（`lastSyncIndex`），实现真正的三方增量对比；
   - 支持文件双端删除同步（本地删除移入系统回收站），彻底杜绝已删文件复活；
   - 多端同时修改同一笔记时自动生成带时间戳的冲突副本（`*.conflict-syno-<timestamp>.md`），绝不静默覆盖丢失数据。

---

## 二、版本更新日志 (Changelog)

### [v1.2.0] - 2026-10-19
- **核心架构升级：3-Way 差异比对引擎与状态快照 (`lastSyncIndex`)**：
  - **引入持久化同步状态快照基准 (`lastSyncIndex`)**：精准追踪双端文件的基准修改时间与大小，告别粗暴的无状态比对；
  - **彻底杜绝双端离线并发修改静默覆盖**：当多设备离线修改同一文件时，精准识别并自动推入 `conflicts` 生成安全副本（`* (conflict-syno-<timestamp>).md`）；
  - **实现完整的文件双向删除同步**：本地删除时生成 `delete_remote` 并在群晖端同步删除；群晖端删除时生成 `delete_local` 并调用 `app.vault.trash(file, true)` 移入本地回收站，彻底根除了已删文件“无限复活”的顽疾。
- **关键防线与数据一致性加固**：
  - **上传文件补充 `mtime` 参数**：在 `uploadFile` multipart 表单中增加 `mtime` 时间戳字段，消除了群晖将上传文件标为服务器当前时间导致的“乒乓”反向重复同步；
  - **登录鉴权升级为 `POST`**：登录时账号密码移至 `POST` 请求体（`application/x-www-form-urlencoded`），彻底杜绝密码出现在 URL Query、网络日志或反代日志中的安全隐患；
  - **群晖路径前缀映射增强**：`listFiles` 采用相对目录层次化拼接，彻底杜绝 `/home` 与 `/homes` 或共享文件夹大小写不一致引发的本地目录嵌套重复；
  - **`.obsidian/**` 与 `.git/**` 默认安全隔离**：默认忽略全部内部配置目录，规避 Obsidian 原生 API 对隐藏目录的索引盲区，彻底解决 `.obsidian/app.json` 触发的 `File already exists` 报错。
- **性能与生命周期优化**：
  - **群晖会话缓存与复用**：在插件实例中缓存已验证的 `baseUrl` 与 `sid`，避免每 5 分钟定时同步时重复执行耗时的全量探活与高频登录/登出；会话失效自动重连；
  - **受控并发传输池 (`CONCURRENCY = 3`)**：在 `SyncManager` 中引入受控并发队列，支持多文件并发上传与下载，大幅降低外网中继高延迟下的批量同步耗时；
  - **启动同步适配 `onLayoutReady`**：启动同步改用官方推荐生命周期钩子，确保 Vault 文件索引构建完毕后再触发；
  - **设置面板扩充**：新增 `Ignore Patterns` 多行配置项；连接信息变更时自动清除旧会话。
- **全套单测扩充**：新增 11 个 3-Way diff、删除同步、受控并发与 POST 鉴权单测用例，测试用例扩充至 71 项且全部 PASS。

### [v1.1.1] - 2026-10-15
- **稳定性与安全性修复（深度代码审查评估落地）**：
  - **大目录官方分页支持 (`SYNO.FileStation.List`)**：支持 `offset`、`limit` 与 `total` 自动循环拉取，彻底解决单目录条目超过 1000 时远端文件被截断导致的同步遗漏隐患。
  - **目录递归保护**：为远端目录遍历增加最大深度保护（30 层）与访问路径防环检测（Set），规避极端情况下因符号链接成环造成的死循环与调用栈溢出。
  - **文件名注入防护**：在 `uploadFile` 中对文件名进行换行符过滤及双引号转义，避免特殊字符破坏 `multipart/form-data` 请求边界。
  - **同步删除机制优化**：`deleteFile` 切换为群晖官方推荐的同步方法（`method=delete`），确保文件即时完成删除操作。
  - **前置配置校验**：在执行同步或连接测试前验证 QuickConnect/局域网地址及账号密码完整性，缺失时提供友好中文提示。
  - **设置项文案真实透明化**：修正密码存储说明，明确指出密码保存在本地设备的 `data.json` 中，消除“加密”误导。
  - **单元测试补充**：新增分页、深度防环、文件名转义等单测用例，测试用例增加至 60 项且全部通过。

### [v1.1.0] - 2026-10-13
- **作者信息更新**：将插件作者统一更新为 **`fang`**（`manifest.json` & `package.json`）。
- **新增：完整支持群晖 QuickConnect 外网中继隧道 (`request_tunnel` & `sites` 重定向)**：
  - 修复在外网环境下无法通过 QuickConnect 穿透访问群晖 DSM API 的问题；
  - 支持自动跟随 `errno: 4` 的区域控制节点重定向（`global.quickconnect.cn` -> `cnc.quickconnect.cn`）；
  - 严格控制 `Serv.php` 请求体大小（仅发送 `mainapp_https` 与 `mainapp_http` 2 项），规避群晖 Nginx 网关的 `HTTP 413 Payload Too Large` 限制；
  - 精确绑定活动隧道项对应的 `relay_region`（如 `cn4`），避免被无隧道项的泛区域标识（`cn`）覆盖。
- **修复：探活校验与 `text/plain` JSON 解析**：
  - 使用 `/webman/pingpong.cgi?action=cors&quickconnect=true` 并严格校验返回 JSON 中的 `success: true` / `ezid`，防止将静态 HTML 引导页误判为可用节点；
  - 优先使用 `JSON.parse(res.text)` 解析响应，兼容群晖返回 `content-type: text/plain` 的 JSON 数据。
- **修复：DSM 7 `SYNO.API.Auth` 与 `SYNO.FileStation.Upload` 接口规范适配**：
  - 修复 `auth.cgi` 在参数位于 URL Query 时使用 `POST` 空请求体导致群晖返回 `Error code: 101` 的问题，统一改为 `GET` 请求；
  - 为 `uploadFile` 补齐 URL 路由参数（`?api=SYNO.FileStation.Upload&version=2&method=upload&_sid=...`），确保 DSM 7 `entry.cgi` 正常路由上传请求。
- **修复：移除误导性的局域网报错提示**：
  - 当处于外网环境时，不再弹出要求检查 `192.168.1.100` 局域网地址的误导提示。

### [v1.0.0] - 2026-10-12
- **初始版本发布**：
  - 完成插件工程脚手架与 TypeScript + esbuild 单文件打包配置；
  - 实现核心数据类型定义 (`src/types.ts`)；
  - 实现双向增量差异比对引擎与 `.obsidian` 敏感配置忽略规则 (`src/sync/diff-engine.ts`)；
  - 实现群晖 File Station Web API 客户端 (`src/syno/api-client.ts`)；
  - 实现同步事务管理器与安全冲突副本保留策略 (`src/sync/sync-manager.ts`)；
  - 实现 Obsidian 设置面板、侧边栏同步按钮、状态栏实时状态展示与定时自动同步 (`src/settings/settings-tab.ts`, `src/main.ts`)。
