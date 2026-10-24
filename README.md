# OrbitDown

直连 qBittorrent 的下载管理客户端。Tauri v2 壳 + Vue 3 前端，覆盖 macOS、Windows 与 Linux。

## 功能

- 连接即登录：填写 qBittorrent WebUI 地址与账号密码，验证通过后进入管理界面；凭据保存在本机，下次启动自动登录
- 任务管理：下载/做种/暂停/删除、批量选择、进度与速度实时同步
- 种子添加：磁力链接、.torrent 文件、分类与标签
- 种子搜索、RSS 订阅、管理工具、完整偏好设置（敏感字段本地掩码）
- 动效体系：视图切换、列表 FLIP 重排、滑动导航指示器、数字滚动等，全部支持 `prefers-reduced-motion` 回退

## 架构

```
frontend/      Vue 3 + Vite 前端（UI 与全部业务逻辑）
src-tauri/     Tauri v2 壳（Rust）：窗口、plugin-http 直连、凭据存储
```

- 前端经 `@tauri-apps/plugin-http`（Rust 网络层）直连 qBittorrent WebUI API，无自建服务端，要求 qBittorrent 5.x
- 连接地址与用户名保存于 plugin-store；密码经 Rust keyring 存入系统钥匙串（macOS Keychain / Windows 凭据管理器 / Linux Secret Service），不写入源码、日志或前端存储
- qBittorrent 会话（SID）失效时自动重登一次，失败回到登录页

## 开发

环境要求：Node 24+、Rust（rustup）、各平台原生依赖（macOS: Xcode CLT；Linux: webkit2gtk）。

```sh
make install        # npm install（根 + frontend）

# 桌面开发（Tauri 窗口 + 热更新）
make dev            # = npx tauri dev

# 纯浏览器开发（不需要 Rust），QBIT_URL 指向 qBittorrent
make web-dev        # = npm --prefix frontend run dev
# 演示模式：http://127.0.0.1:5173/?demo=1

# 验证
make check          # 前端 vitest + vue-tsc 类型检查 + 构建

# 构建产物
make build          # 当前平台桌面 app（macOS .app / .dmg）
```

Windows/Linux 桌面包可在对应平台执行 `npx tauri build`，或参考 CI 配置。

## 测试

```sh
npm test --prefix frontend        # Vitest 单元测试（lib 层）
npm run build --prefix frontend   # vue-tsc 类型检查 + 生产构建
```
