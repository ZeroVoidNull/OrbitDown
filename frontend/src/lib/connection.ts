export interface ConnectionInfo {
  configured: boolean;
  url: string;
  username: string;
  password_saved: boolean;
}

export interface ConnectionFields {
  url: string;
  username: string;
  password: string;
}

export function canRetainConnectionPassword(
  saved: ConnectionInfo | null,
  url: string,
  username: string,
): boolean {
  return Boolean(
    saved?.configured &&
    saved.password_saved &&
    saved.url.replace(/\/+$/, "") === url.trim().replace(/\/+$/, "") &&
    saved.username === username.trim(),
  );
}

export function connectionValidationError(
  saved: ConnectionInfo | null,
  fields: ConnectionFields,
): string {
  if (!/^https?:\/\//i.test(fields.url.trim()))
    return "请输入有效的 HTTP(S) WebUI 地址";
  try {
    const url = new URL(fields.url.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      return "请输入有效的 HTTP(S) WebUI 地址，地址中不能包含账号、密码、查询参数或片段";
  } catch {
    return "请输入有效的 HTTP(S) WebUI 地址";
  }
  if (!fields.username.trim()) return "请输入 qBittorrent 用户名";
  if (
    !fields.password &&
    !canRetainConnectionPassword(saved, fields.url, fields.username)
  )
    return "请输入密码；更改 WebUI 地址或用户名后需要重新输入密码";
  return "";
}

export interface ConnectionEndpoint {
  address: string;
  port: string;
}

// 登录表单将主机与端口分开输入；内部仍以完整 URL 存储与请求。
export function splitConnectionUrl(url: string): ConnectionEndpoint {
  try {
    const parsed = new URL(url);
    return { address: parsed.hostname, port: parsed.port || "" };
  } catch {
    return { address: url, port: "" };
  }
}

export function joinConnectionAddress(address: string, port: string): string {
  return `http://${address.trim()}:${port.trim()}`;
}

export function connectionEndpointError(
  address: string,
  port: string,
): string {
  const host = address.trim();
  if (!host) return "请输入 qBittorrent 服务器地址";
  if (/^[a-z]+:\/\//i.test(host) || host.includes("/") || host.includes(":"))
    return "地址仅填主机名或 IP，不需要 http:// 前缀与端口";
  const text = port.trim();
  if (!/^\d{1,5}$/.test(text) || Number(text) < 1 || Number(text) > 65535)
    return "请输入有效端口（1-65535）";
  return "";
}
