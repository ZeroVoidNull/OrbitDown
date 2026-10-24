import type { Torrent } from "./types";

export interface NativeTorrent extends Torrent {
  force_start?: boolean;
  seq_dl?: boolean;
  f_l_piece_prio?: boolean;
  super_seeding?: boolean;
  auto_tmm?: boolean;
  dl_limit?: number;
  up_limit?: number;
  ratio_limit?: number;
  seeding_time_limit?: number;
  inactive_seeding_time_limit?: number;
  priority?: number;
}
export interface Peer {
  ip?: string;
  port?: number;
  client?: string;
  connection?: string;
  country?: string;
  flags?: string;
  flags_desc?: string;
  progress?: number;
  dl_speed?: number;
  up_speed?: number;
  downloaded?: number;
  uploaded?: number;
  relevance?: number;
}
export interface PeerUpdate {
  rid: number;
  full_update?: boolean;
  peers?: Record<string, Partial<Peer>>;
  peers_removed?: string[];
  show_flags?: boolean;
}

export function rateLimit(input: string | number): string {
  const value = Number(input);
  if (
    !String(input).trim() ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(Math.round(value * 1024))
  )
    throw new Error("限速须为大于或等于 0 的数值");
  return String(Math.round(value * 1024));
}
export function shareLimits(
  ratio: string | number,
  time: string | number,
  inactive: string | number,
): Record<string, string> {
  const values = [ratio, time, inactive].map((raw, index) => {
    const n = Number(raw);
    if (
      !String(raw).trim() ||
      !Number.isFinite(n) ||
      (n < 0 && n !== -1 && n !== -2) ||
      (index > 0 && !Number.isSafeInteger(n))
    )
      throw new Error(
        "分享限制须为非负数、-1（无限制）或 -2（全局）；时间须为整数分钟",
      );
    return String(n);
  });
  return {
    ratioLimit: values[0]!,
    seedingTimeLimit: values[1]!,
    inactiveSeedingTimeLimit: values[2]!,
  };
}
export function renamePath(oldPath: string, basename: string): string {
  const segments = oldPath.split("/");
  if (
    segments.some((part) => !part || part === "." || part === "..") ||
    oldPath.includes("\\") ||
    oldPath.includes("\0")
  )
    throw new Error("原路径须为任务中的相对路径");
  if (
    !basename.trim() ||
    basename === "." ||
    basename === ".." ||
    /[/\\\u0000-\u001f]/.test(basename)
  )
    throw new Error("新名称不能包含路径分隔符或使用 .、..");
  segments[segments.length - 1] = basename;
  return segments.join("/");
}
export function mergePeers(
  current: Record<string, Peer>,
  update: PeerUpdate,
): Record<string, Peer> {
  const next: Record<string, Peer> = Object.assign(
    Object.create(null),
    update.full_update ? {} : current,
  );
  for (const [id, patch] of Object.entries(update.peers || {}))
    next[id] = { ...(next[id] || {}), ...patch };
  for (const id of update.peers_removed || []) delete next[id];
  return next;
}
export function peerAddress(peer: Peer): string {
  if (!peer.ip || !peer.port) return "";
  const host =
    peer.ip.includes(":") && !peer.ip.startsWith("[")
      ? `[${peer.ip}]`
      : peer.ip;
  return `${host}:${peer.port}`;
}
export function pieceSummary(states: number[]) {
  const counts = { missing: 0, downloading: 0, complete: 0, unknown: 0 };
  for (const state of states) {
    if (state === 0) counts.missing++;
    else if (state === 1) counts.downloading++;
    else if (state === 2) counts.complete++;
    else counts.unknown++;
  }
  return counts;
}
