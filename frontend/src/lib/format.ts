export function bytes(value: number, digits = 1): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "0 B";
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 5);
  return `${(value / 1024 ** unit).toLocaleString("en-US", { maximumFractionDigits: digits })} ${["B", "KiB", "MiB", "GiB", "TiB", "PiB"][unit]}`;
}
export const speed = (value: number) => `${bytes(value)}/s`;
export function duration(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value >= 8640000) return "∞";
  if (value < 60) return `${Math.floor(value)} 秒`;
  if (value < 3600) return `${Math.floor(value / 60)} 分`;
  if (value < 86400)
    return `${Math.floor(value / 3600)} 小时 ${Math.floor((value % 3600) / 60)} 分`;
  return `${Math.floor(value / 86400)} 天 ${Math.floor((value % 86400) / 3600)} 小时`;
}
export const percent = (value: number) =>
  `${Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100)}%`;
export const date = (value: number) =>
  value > 0
    ? new Date(value * 1000).toLocaleString("zh-CN", {
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
