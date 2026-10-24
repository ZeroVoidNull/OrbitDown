import type { Filters, MainData, StatusKey, Torrent } from "./types";

export function statusOf(state: string): {
  key: StatusKey;
  label: string;
  tone: string;
} {
  if (["error", "missingFiles", "unknown"].includes(state))
    return {
      key: "error",
      label: state === "missingFiles" ? "文件丢失" : "发生错误",
      tone: "red",
    };
  if (state.startsWith("paused") || state.startsWith("stopped"))
    return { key: "paused", label: "已暂停", tone: "gray" };
  if (["uploading", "stalledUP", "queuedUP", "forcedUP"].includes(state))
    return {
      key: "seeding",
      label: state === "queuedUP" ? "等待做种" : "做种中",
      tone: "green",
    };
  if (state.startsWith("checking"))
    return { key: "downloading", label: "校验中", tone: "amber" };
  if (state === "moving")
    return { key: "downloading", label: "移动中", tone: "amber" };
  return {
    key: "downloading",
    label:
      state === "stalledDL"
        ? "等待连接"
        : state === "queuedDL"
          ? "排队中"
          : state === "metaDL" || state === "forcedMetaDL"
            ? "获取元数据"
            : "下载中",
    tone: "blue",
  };
}
export const tagsOf = (torrent: Torrent) =>
  (torrent.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
export function mergeMainData(
  current: Record<string, Torrent>,
  update: MainData,
): Record<string, Torrent> {
  const next: Record<string, Torrent> = Object.assign(
    Object.create(null),
    update.full_update ? {} : current,
  );
  for (const [hash, patch] of Object.entries(update.torrents || {})) {
    if (hash === "__proto__" || hash === "constructor" || hash === "prototype")
      continue;
    next[hash] = { ...next[hash], ...patch, hash };
  }
  for (const hash of update.torrents_removed || []) delete next[hash];
  return next;
}
export function filterTorrents(tasks: Torrent[], filter: Filters): Torrent[] {
  const search = filter.search.trim().toLocaleLowerCase();
  return tasks
    .filter(
      (t) =>
        (!search || t.name.toLocaleLowerCase().includes(search)) &&
        (filter.status === "all" ||
          (filter.status === "completed"
            ? t.progress >= 1
            : statusOf(t.state).key === filter.status)) &&
        (!filter.category ||
          (filter.category === "__none"
            ? !t.category
            : t.category === filter.category)) &&
        (!filter.tag || tagsOf(t).includes(filter.tag)),
    )
    .sort((a, b) => {
      switch (filter.sort) {
        case "name":
          return a.name.localeCompare(b.name, "zh-CN");
        case "size":
          return b.size - a.size;
        case "progress":
          return b.progress - a.progress;
        case "speed":
          return b.dlspeed - a.dlspeed;
        default:
          return b.added_on - a.added_on;
      }
    });
}
