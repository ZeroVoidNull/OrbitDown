export function validTorrentLinks(raw: string): boolean {
  const lines = raw.trim().split(/\r?\n/);
  if (!raw.trim() || lines.length > 100) return false;
  return lines.every((line) => {
    try {
      const u = new URL(line.trim());
      return u.protocol === "magnet:"
        ? !!u.searchParams.get("xt")
        : ["https:", "http:"].includes(u.protocol) &&
            !!u.hostname &&
            !u.username &&
            !u.password;
    } catch {
      return false;
    }
  });
}
export function addOptions(
  values: Record<string, string | boolean>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === "") continue;
    if (["dlLimit", "upLimit"].includes(key)) {
      const n = Number(value);
      if (
        !Number.isFinite(n) ||
        n < 0 ||
        !Number.isSafeInteger(Math.round(n * 1024))
      )
        throw new Error("限速须为非负数");
      result[key] = String(Math.round(n * 1024));
    } else if (
      ["ratioLimit", "seedingTimeLimit", "inactiveSeedingTimeLimit"].includes(
        key,
      )
    ) {
      const n = Number(value);
      if (
        !Number.isFinite(n) ||
        (n < 0 && n !== -1 && n !== -2) ||
        (key !== "ratioLimit" && !Number.isSafeInteger(n))
      )
        throw new Error(
          "分享限制须为非负数、-1（无限制）或 -2（全局）；时间须为整数分钟",
        );
      result[key] = String(n);
    } else result[key] = String(value);
  }
  return result;
}
