# OrbitDown

- 使用中文与用户沟通。
- 产品页面只保留功能名称、状态和必要说明。不添加无关标语、口号、英文装饰短句或营销文案。
- 前端组件规范见 `docs/UI-GUIDELINES.md`；视觉调整应保留响应式布局与无障碍回退。
- 仅桌面平台（macOS/Windows/Linux）：Tauri v2 桌面客户端（`src-tauri/`）+ Vue 3 前端（`frontend/`）。不做移动端（Tauri Android/iOS 方案已放弃，未来原生手机应用另开项目）。前端经 `@tauri-apps/plugin-http` 直连 qBittorrent WebUI API（要求 qBittorrent 5.x），无自建服务端。
- 登录即连接：登录页提交 qBittorrent 地址与账号密码，验证通过后会话建立。地址/用户名经 plugin-store 保存，密码经 Rust keyring 存入系统钥匙串（macOS Keychain / Windows 凭据管理器 / Linux Secret Service）。凭据不写入源码、日志或前端存储。
- 纯浏览器开发：`npm --prefix frontend run dev`（`QBIT_URL` 指定 qBittorrent 地址，默认 `http://127.0.0.1:8080`）；演示模式加 `?demo=1`。
- 验证：`npm test --prefix frontend`、`npm run build --prefix frontend`；桌面构建 `npx tauri build`。
- 默认只在当前项目目录工作，不修改 OrbitDock、OrbitGate 或真实 qBittorrent 数据。
