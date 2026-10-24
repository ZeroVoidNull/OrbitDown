// qBittorrent 直连客户端：连接配置存取、登录认证（SID）、403 自动重登。
// 凭据存储：Tauri 内 url/username 走 plugin-store、密码走系统钥匙串
// （Rust keyring 命令）；纯浏览器开发态退化为 localStorage/sessionStorage。

import { APIError, inTauri, isDemo, rawFetch } from "./transport";
import type { ConnectionFields, ConnectionInfo } from "./connection";

const fiveVersion = /^v?5\.[0-9]+(?:\.[0-9]+)?[a-zA-Z0-9.+~-]*$/;
const BROWSER_CONNECTION_KEY = "orbitdown.connection";
const BROWSER_PASSWORD_KEY = "orbitdown.password";

let demoConnection: ConnectionInfo = {
  configured: true,
  url: "http://nas.local:8080",
  username: "admin",
  password_saved: true,
};

interface StoredConnection {
  url: string;
  username: string;
}

// —— 存取原语 ——

async function storeGet(key: string): Promise<unknown> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("connection.json", { autoSave: false });
  return store.get(key);
}

async function storeSet(values: Record<string, unknown>): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("connection.json", { autoSave: false });
  for (const [key, value] of Object.entries(values)) await store.set(key, value);
  await store.save();
}

async function savePassword(user: string, password: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_password", { user, password });
}

async function loadPassword(user: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  const password = await invoke<string | null>("load_password", { user });
  return password ?? "";
}

async function deletePassword(user: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("delete_password", { user });
}

function browserConnection(): StoredConnection {
  try {
    const raw = localStorage.getItem(BROWSER_CONNECTION_KEY);
    if (!raw) return { url: "", username: "" };
    const parsed = JSON.parse(raw) as Partial<StoredConnection>;
    return { url: parsed.url || "", username: parsed.username || "" };
  } catch {
    return { url: "", username: "" };
  }
}

// —— 连接配置（不含密码明文；password_saved 只表达「是否已保存」） ——

export async function readConnection(): Promise<ConnectionInfo> {
  if (isDemo) return { ...demoConnection };
  if (inTauri) {
    const [url, username, password] = await Promise.all([
      storeGet("url").then((v) => (typeof v === "string" ? v : "")),
      storeGet("username").then((v) => (typeof v === "string" ? v : "")),
      storeGet("username").then((v) =>
        typeof v === "string" && v ? loadPassword(v) : Promise.resolve(""),
      ),
    ]);
    return { configured: !!url && !!username, url, username, password_saved: !!password };
  }
  const conn = browserConnection();
  const password = conn.username ? sessionStorage.getItem(BROWSER_PASSWORD_KEY) || "" : "";
  return { configured: !!conn.url && !!conn.username, url: conn.url, username: conn.username, password_saved: !!password };
}

export async function readSavedPassword(username: string): Promise<string> {
  if (isDemo) return "demo";
  if (!username) return "";
  if (inTauri) return loadPassword(username);
  return sessionStorage.getItem(BROWSER_PASSWORD_KEY) || "";
}

// password 留空表示沿用已保存密码（地址与用户名未变时）。
export async function writeConnection(
  fields: Pick<ConnectionFields, "url" | "username"> & { password?: string },
): Promise<void> {
  const url = fields.url.trim().replace(/\/+$/, "");
  const username = fields.username.trim();
  if (isDemo) {
    demoConnection = {
      configured: true,
      url,
      username,
      password_saved: true,
    };
    return;
  }
  if (inTauri) {
    await storeSet({ url, username });
    if (fields.password) await savePassword(username, fields.password);
  } else {
    localStorage.setItem(BROWSER_CONNECTION_KEY, JSON.stringify({ url, username }));
    if (fields.password) sessionStorage.setItem(BROWSER_PASSWORD_KEY, fields.password);
  }
}

export async function eraseConnection(username: string): Promise<void> {
  if (isDemo) {
    demoConnection = { configured: false, url: "", username: "", password_saved: false };
    return;
  }
  if (inTauri) {
    await storeSet({ url: "", username: "" });
    if (username) await deletePassword(username);
  } else {
    localStorage.removeItem(BROWSER_CONNECTION_KEY);
    sessionStorage.removeItem(BROWSER_PASSWORD_KEY);
  }
}

// —— 登录会话 ——

let activeUrl = "";
let activeUsername = "";
let sid = "";
let rememberedPassword = "";
let reloginFlight: Promise<boolean> | null = null;

export interface AuthResult {
  version: string;
  sid: string;
}

function extractSid(response: Response): string {
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") || ""];
  for (const cookie of cookies) {
    const match = /(?:^|;\s*)SID=([^;]+)/.exec(cookie || "");
    if (match) return match[1];
  }
  return "";
}

function absolute(base: string, path: string): string {
  if (!inTauri) return path; // 浏览器开发态走 Vite 代理（相对路径）
  return base + path;
}

// 登录并校验 qBittorrent 版本。纯函数：不改动全局会话状态。
export async function authenticate(
  url: string,
  username: string,
  password: string,
): Promise<AuthResult> {
  if (isDemo) {
    if (password === "wrong")
      throw new APIError("qBittorrent 用户名或密码不正确", 401);
    return { version: "v5.1.2", sid: "demo-sid" };
  }
  const base = url.trim().replace(/\/+$/, "");
  let login: Response;
  try {
    login = await rawFetch(absolute(base, "/api/v2/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }).toString(),
    });
  } catch (e) {
    throw new APIError(
      `无法连接 qBittorrent（${e instanceof Error ? e.message : String(e)}）。` +
        "请检查地址与网络；macOS 需在「系统设置 → 隐私与安全性 → 本地网络」中允许本应用访问",
      0,
    );
  }
  if (login.status === 403)
    throw new APIError(
      "访问被 qBittorrent 拒绝（403）：多次登录失败会被临时封禁，请稍后重试；也请检查 WebUI 的 Host 验证设置",
      403,
    );
  if (login.status !== 200)
    throw new APIError(
      `无法连接 qBittorrent（HTTP ${login.status}），请检查地址与网络`,
      502,
    );
  if ((await login.text()).trim() !== "Ok.")
    throw new APIError("qBittorrent 用户名或密码不正确", 401);
  const sessionSid = extractSid(login);
  let version: Response;
  try {
    version = await rawFetch(absolute(base, "/api/v2/app/version"), {
      headers: sessionSid ? { Cookie: "SID=" + sessionSid } : {},
    });
  } catch (e) {
    throw new APIError(
      `无法读取 qBittorrent 版本，请重试（${e instanceof Error ? e.message : String(e)}）`,
      0,
    );
  }
  if (version.status === 403)
    throw new APIError(
      "登录成功但会话未被 qBittorrent 接受（403）：请检查 WebUI 的跨站请求保护与 Host 验证设置",
      403,
    );
  if (version.status !== 200)
    throw new APIError(
      `无法读取 qBittorrent 版本（HTTP ${version.status}），请重试`,
      version.status,
    );
  const text = (await version.text()).trim();
  if (!fiveVersion.test(text))
    throw new APIError(`需要 qBittorrent 5.x，当前为 ${text || "未知版本"}`, 400);
  return { version: text, sid: sessionSid };
}

// 采纳一次成功认证：设为当前会话。
export function adoptSession(url: string, username: string, sessionSid: string, password: string): void {
  activeUrl = url.trim().replace(/\/+$/, "");
  activeUsername = username.trim();
  sid = sessionSid;
  rememberedPassword = password;
}

export function currentUsername(): string {
  return activeUsername;
}

export function invalidateSession(): void {
  activeUrl = "";
  activeUsername = "";
  sid = "";
}

export function sessionActive(): boolean {
  return !!activeUrl;
}

// 带认证的请求：自动附加 SID；403 时用已存凭据重登一次后重试；
// 仍失败则派发 unauthorized（App 回到登录页）。
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const attempt = () => {
    const headers = new Headers(init.headers);
    if (sid && !headers.has("Cookie")) headers.set("Cookie", "SID=" + sid);
    return rawFetch(absolute(activeUrl, path), { ...init, headers });
  };
  let response = await attempt();
  if (response.status === 403 && !path.startsWith("/api/v2/auth/")) {
    const ok = await relogin();
    if (ok) response = await attempt();
  }
  if (response.status === 403)
    window.dispatchEvent(new Event("orbitdown:unauthorized"));
  return response;
}

async function relogin(): Promise<boolean> {
  if (reloginFlight) return reloginFlight;
  reloginFlight = (async () => {
    let url = activeUrl;
    let username = activeUsername;
    let password = rememberedPassword;
    if (!url || !username) {
      const saved = await readConnection();
      if (!saved.configured) return false;
      url = saved.url;
      username = saved.username;
      password = password || (await readSavedPassword(username));
    }
    try {
      const result = await authenticate(url, username, password);
      adoptSession(url, username, result.sid, password);
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await reloginFlight;
  } finally {
    reloginFlight = null;
  }
}
