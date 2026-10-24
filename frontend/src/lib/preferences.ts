import inventory from "./preferences.json";
export interface FieldSpec {
  key: string;
  label: string;
  section: string;
  type:
    | "boolean"
    | "number"
    | "string"
    | "textarea"
    | "enum"
    | "secret"
    | "folders"
    | "object"
    | "array";
  options?: { value: string | number | boolean; label: string }[];
  scale?: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  secret?: boolean;
  readonly?: boolean;
  danger?: boolean;
  hint?: string;
}
export interface PreferenceMeta {
  masked_fields?: string[];
  configured_fields?: string[];
}
export type Preferences = Record<string, unknown> & {
  _orbitdown?: PreferenceMeta;
};
export const preferenceInventory = inventory as FieldSpec[];
export const preferenceSections = [
  { key: "behavior", label: "行为" },
  { key: "downloads", label: "下载" },
  { key: "connection", label: "连接" },
  { key: "speed", label: "速度" },
  { key: "bittorrent", label: "BitTorrent" },
  { key: "rss", label: "RSS" },
  { key: "webui", label: "WebUI" },
  { key: "advanced", label: "高级" },
  { key: "other", label: "其他设置" },
];
export function fieldsFor(values: Preferences): FieldSpec[] {
  const list = Object.entries(values)
    .filter(
      ([key]) =>
        !key.startsWith("_") && key !== "constructor" && key !== "prototype",
    )
    .map(([key, value]) => {
      const known = preferenceInventory.find((field) => field.key === key);
      const field = known
        ? { ...known }
        : ({
            key,
            label: key,
            section: "other",
            type:
              typeof value === "boolean"
                ? "boolean"
                : typeof value === "number"
                  ? "number"
                  : typeof value === "object"
                    ? "object"
                    : "string",
          } as FieldSpec);
      if (values._orbitdown?.masked_fields?.includes(key))
        ((field.secret = true), (field.type = "secret"));
      if (typeof value === "boolean") field.type = "boolean";
      else if (typeof value === "number" && field.type !== "enum")
        field.type = "number";
      else if (value && typeof value === "object" && field.type !== "folders")
        field.type = Array.isArray(value) ? "array" : "object";
      return field;
    });
  // 服务端 JSON 键序不可控，按规格定义顺序渲染（未知键排在最后）
  const order = new Map(preferenceInventory.map((f, i) => [f.key, i]));
  list.sort((a, b) => {
    const ia = order.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const ib = order.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    return ia !== ib ? ia - ib : a.key.localeCompare(b.key);
  });
  return list;
}
export function displayValue(
  value: unknown,
  field: Pick<FieldSpec, "scale">,
): unknown {
  return typeof value === "number" && value >= 0
    ? value / (field.scale || 1)
    : value;
}
export function apiValue(
  value: string,
  field: Pick<FieldSpec, "scale">,
  baseline: unknown,
): unknown {
  if (typeof baseline === "number") {
    const number = Number(value);
    return number < 0 ? number : number * (field.scale || 1);
  }
  if (typeof baseline === "boolean") return value === "true";
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => JSON.stringify(key) + ":" + canonical(val))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export function preferencePatch(
  original: Preferences,
  draft: Preferences,
  clear = new Set<string>(),
): Record<string, unknown> {
  const patch: Record<string, unknown> = Object.create(null);
  for (const field of fieldsFor(original)) {
    if (field.readonly) continue;
    const value = draft[field.key];
    if (field.secret && value === "" && !clear.has(field.key)) continue;
    if (
      clear.has(field.key) ||
      canonical(value) !== canonical(original[field.key])
    )
      patch[field.key] = clear.has(field.key) ? "" : value;
  }
  return patch;
}
export function defaultDemoPreferences(): Preferences {
  const values: Preferences = {};
  for (const field of preferenceInventory) {
    if (field.readonly) continue;
    values[field.key] =
      field.type === "boolean"
        ? false
        : field.type === "number"
          ? Math.max(field.min || 0, 0)
          : field.type === "enum"
            ? (field.options?.[0]?.value ?? "")
            : field.type === "folders"
              ? {}
              : "";
  }
  return {
    ...values,
    save_path: "/downloads",
    dl_limit: 0,
    up_limit: 0,
    alt_dl_limit: 1048576,
    alt_up_limit: 262144,
    dht: true,
    pex: true,
    lsd: true,
    listen_port: 6881,
    web_ui_port: 8080,
    web_ui_username: "admin",
    web_ui_address: "*",
    web_ui_domain_list: "*",
    max_active_downloads: 5,
    max_active_uploads: 10,
    max_active_torrents: 15,
    queueing_enabled: true,
    scan_dirs: { "/watch": 1 },
    max_ratio: -1,
    max_seeding_time: -1,
    max_inactive_seeding_time: -1,
    max_connec: 500,
    max_connec_per_torrent: 100,
    max_uploads: 8,
    max_uploads_per_torrent: 4,
    torrent_content_layout: "Original",
    torrent_stop_condition: "None",
    web_ui_csrf_protection_enabled: true,
    web_ui_clickjacking_protection_enabled: true,
    web_ui_secure_cookie_enabled: true,
    proxy_password: "",
    _orbitdown: {
      masked_fields: preferenceInventory
        .filter((f) => f.secret)
        .map((f) => f.key),
      configured_fields: ["web_ui_password"],
    },
  };
}

export function setPreferenceValue(
  draft: Preferences,
  key: string,
  value: unknown,
): void {
  if (
    key === "current_network_interface" &&
    draft[key] !== value &&
    Object.hasOwn(draft, "current_interface_address")
  )
    draft.current_interface_address = "";
  draft[key] = value;
}

// 直连 qBittorrent 后响应未经服务端处理，敏感字段须在进入界面前掩码。
// 掩码后的副本仅在内存中流转，原始值不落任何存储。
function secretPreference(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("password") ||
    k.includes("secret") ||
    k.includes("api_key") ||
    k.endsWith("_token") ||
    k === "ssl_key"
  );
}

export function maskPreferences(values: Record<string, unknown>): Preferences {
  const masked: Preferences = { ...values };
  const maskedFields: string[] = [];
  const configuredFields: string[] = [];
  // qBittorrent 不回传只写的 WebUI 密码，补一个空占位以驱动表单呈现。
  if (!("web_ui_password" in masked)) {
    masked.web_ui_password = "";
    configuredFields.push("web_ui_password");
  }
  for (const key of Object.keys(masked)) {
    if (key.startsWith("_")) continue;
    if (!secretPreference(key)) continue;
    maskedFields.push(key);
    if (typeof masked[key] === "string" && masked[key] !== "")
      configuredFields.push(key);
    masked[key] = "";
  }
  masked._orbitdown = {
    masked_fields: maskedFields,
    configured_fields: configuredFields,
  };
  return masked;
}
