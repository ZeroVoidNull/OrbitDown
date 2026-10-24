import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 纯浏览器开发时的 qBittorrent 反代目标；Tauri 内不经此代理（走 plugin-http 直连）。
const qbitTarget = process.env.QBIT_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [vue()],
  server: {
    fs: { allow: [".."] },
    proxy: {
      "/api": { target: qbitTarget, changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
