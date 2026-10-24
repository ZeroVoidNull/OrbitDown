import { APIError, isDemo } from "./transport";
import { authFetch } from "./qbit";

export { APIError, isDemo };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (isDemo) {
    const { demoRequest } = await import("./demo");
    return demoRequest<T>(path, init);
  }
  let response: Response;
  try {
    response = await authFetch(path, init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new APIError("网络连接中断，请检查连接后重试", 0);
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new APIError(
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : "操作未完成，请稍后重试",
      response.status,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T = string>(
    path: string,
    data: Record<string, string> | FormData = {},
  ) => {
    const init: RequestInit = { method: "POST" };
    if (data instanceof FormData) init.body = data;
    else {
      init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
      init.body = new URLSearchParams(data).toString();
    }
    return request<T>(path, init);
  },
  download: async (path: string, filename: string) => {
    let blob: Blob;
    if (isDemo)
      blob = new Blob(["d4:infod4:name4:demoee"], {
        type: "application/x-bittorrent",
      });
    else {
      const response = await authFetch(path);
      if (!response.ok)
        throw new APIError("无法导出种子文件", response.status);
      blob = await response.blob();
    }
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename.replace(/[\\/:*?"<>|]/g, "_");
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

// 面板内编辑期间引用一份稳定的工作副本；凭据轮换由 qbit 层统一处理。
export function scopedAPI() {
  return api;
}
