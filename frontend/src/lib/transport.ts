// 统一 HTTP 传输层：Tauri 内走 plugin-http（Rust 网络栈，无 CORS 限制、
// 可直连局域网 qBittorrent）；纯浏览器开发态走原生 fetch（配合 Vite 代理）。
// APIError 是全应用统一的请求错误类型，放本层避免 api/qbit 循环依赖。

export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// 自绘窗口圆点仅在桌面 Tauri（无系统装饰）显示；浏览器 UA 兜底排除。
export const isDesktopTauri =
  inTauri && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// 演示模式（开发环境 + ?demo=1）：所有请求被 demo.ts 拦截，qbit 层返回演示连接。
export const isDemo =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("demo") === "1";

// plugin-http 的 FetchOptions 额外支持 connectTimeout（毫秒）。
type TauriFetchInit = RequestInit & { connectTimeout?: number };

let tauriFetch: ((input: RequestInfo | URL, init?: TauriFetchInit) => Promise<Response>) | null =
  null;

export async function rawFetch(
  url: string,
  init: TauriFetchInit = {},
): Promise<Response> {
  if (inTauri) {
    if (!tauriFetch) {
      const { fetch } = await import("@tauri-apps/plugin-http");
      tauriFetch = fetch;
    }
    // 连接阶段 8 秒超时：地址不可达时立即失败，不长时间挂起。
    return tauriFetch(url, { connectTimeout: 8000, ...init });
  }
  return fetch(url, init);
}
