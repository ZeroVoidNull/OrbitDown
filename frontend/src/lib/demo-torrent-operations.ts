import type { Torrent, TorrentFile, Tracker } from "./types";
import {
  peerAddress,
  type NativeTorrent,
  type Peer,
} from "./torrent-operations";

interface DemoState {
  categories: Record<string, { name: string; savePath: string }>;
  tags: string[];
  trackers: Record<string, Tracker[]>;
  files: Record<string, TorrentFile[]>;
  peers: Record<string, Record<string, Peer>>;
  banned: Set<string>;
  rid: number;
}
const instances = new WeakMap<Record<string, Torrent>, DemoState>();
function stateFor(torrents: Record<string, Torrent>): DemoState {
  let state = instances.get(torrents);
  if (!state) {
    const names = [
      ...new Set(
        Object.values(torrents)
          .map((t) => t.category)
          .filter(Boolean),
      ),
    ];
    state = {
      categories: Object.fromEntries(
        names.map((name) => [name, { name, savePath: "/downloads/" + name }]),
      ),
      tags: [
        ...new Set(
          Object.values(torrents).flatMap((t) =>
            t.tags
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        ),
      ],
      trackers: Object.create(null),
      files: Object.create(null),
      peers: Object.create(null),
      banned: new Set(),
      rid: 0,
    };
    instances.set(torrents, state);
  }
  return state;
}
function splitTags(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}
function parseAddress(value: string): Peer | undefined {
  const match = value
    .trim()
    .match(/^(?:\[([\da-f:]+)\]|(\d{1,3}(?:\.\d{1,3}){3})):(\d+)$/i);
  const port = Number(match?.[3]);
  if (!match || port < 1 || port > 65535) return;
  return {
    ip: match[1] || match[2],
    port,
    client: "演示连接",
    connection: "TCP",
    progress: 0,
    dl_speed: 0,
    up_speed: 0,
    downloaded: 0,
    uploaded: 0,
  };
}

export async function demoTorrentOperation(
  path: string,
  init: RequestInit,
  torrents: Record<string, Torrent>,
): Promise<{ handled: boolean; value?: unknown }> {
  const url = new URL(path, "https://demo.invalid"),
    route = url.pathname.replace("/api/v2/", "");
  const supported = new Set([
    "torrents/info",
    "torrents/categories",
    "torrents/tags",
    "torrents/trackers",
    "torrents/files",
    "torrents/webseeds",
    "torrents/pieceStates",
    "sync/torrentPeers",
    "torrents/setForceStart",
    "torrents/setSuperSeeding",
    "torrents/setAutoManagement",
    "torrents/recheck",
    "torrents/reannounce",
    "torrents/topPrio",
    "torrents/increasePrio",
    "torrents/decreasePrio",
    "torrents/bottomPrio",
    "torrents/toggleSequentialDownload",
    "torrents/toggleFirstLastPiecePrio",
    "torrents/setDownloadLimit",
    "torrents/setUploadLimit",
    "torrents/downloadLimit",
    "torrents/uploadLimit",
    "torrents/setShareLimits",
    "torrents/setLocation",
    "torrents/rename",
    "torrents/setCategory",
    "torrents/addTags",
    "torrents/removeTags",
    "torrents/createCategory",
    "torrents/editCategory",
    "torrents/removeCategories",
    "torrents/createTags",
    "torrents/deleteTags",
    "torrents/addTrackers",
    "torrents/editTracker",
    "torrents/removeTrackers",
    "torrents/addPeers",
    "transfer/banPeers",
    "torrents/renameFile",
    "torrents/renameFolder",
    "torrents/filePrio",
  ]);
  if (!supported.has(route)) return { handled: false };
  const state = stateFor(torrents);
  const form =
    init.body instanceof URLSearchParams || init.body instanceof FormData
      ? init.body
      : new URLSearchParams();
  const get = (key: string) =>
    String(form.get(key) ?? url.searchParams.get(key) ?? "");
  const selected =
    get("hashes") === "all" ? Object.keys(torrents) : get("hashes").split("|");
  const tasks = selected
    .map((hash) => torrents[hash] as NativeTorrent)
    .filter(Boolean);
  const hash = get("hash"),
    task = torrents[hash] as NativeTorrent | undefined;
  const filesFor = (key: string) =>
    (state.files[key] ||= torrents[key]
      ? [
          {
            index: 0,
            name: torrents[key]!.name,
            size: torrents[key]!.size,
            progress: torrents[key]!.progress,
            priority: 1,
          },
        ]
      : []);
  const trackersFor = (key: string) =>
    (state.trackers[key] ||= [
      { url: "** [DHT] **", status: 2, tier: -1, num_peers: 2, msg: "" },
      {
        url: "https://tracker.example/announce",
        status: 2,
        tier: 0,
        num_peers: 24,
        msg: "",
      },
    ]);
  const peersFor = (key: string) =>
    (state.peers[key] ||= state.banned.has("192.0.2.20")
      ? {}
      : {
          "192.0.2.20:6881": {
            ip: "192.0.2.20",
            port: 6881,
            client: "qBittorrent 5.0",
            connection: "TCP",
            progress: 0.8,
            dl_speed: 524288,
            up_speed: 65536,
            downloaded: 104857600,
            uploaded: 10485760,
            flags: "D U",
            flags_desc: "正在下载和上传",
          },
        });
  let value: unknown = "Ok.";
  const method = route.split("/")[1];
  if (method === "info")
    value = structuredClone(
      (get("hashes") ? tasks : Object.values(torrents)).map((t) => ({
        force_start: false,
        seq_dl: false,
        f_l_piece_prio: false,
        super_seeding: false,
        auto_tmm: false,
        dl_limit: 0,
        up_limit: 0,
        ratio_limit: -2,
        seeding_time_limit: -2,
        inactive_seeding_time_limit: -2,
        ...t,
      })),
    );
  else if (method === "categories") value = structuredClone(state.categories);
  else if (method === "tags") value = [...state.tags];
  else if (method === "files") value = structuredClone(filesFor(hash));
  else if (method === "trackers") value = structuredClone(trackersFor(hash));
  else if (method === "pieceStates")
    value = task
      ? Array.from({ length: 256 }, (_, i) =>
          i < Math.floor(task.progress * 256)
            ? 2
            : i < Math.floor(task.progress * 256) + 3
              ? 1
              : 0,
        )
      : [];
  else if (method === "webseeds") value = [];
  else if (route === "sync/torrentPeers")
    value = {
      rid: ++state.rid,
      full_update: true,
      peers: structuredClone(peersFor(hash)),
    };
  else if (method === "downloadLimit" || method === "uploadLimit")
    value = Object.fromEntries(
      tasks.map((t) => [
        t.hash,
        (method === "downloadLimit" ? t.dl_limit : t.up_limit) || 0,
      ]),
    );
  else if (method === "createCategory" || method === "editCategory") {
    const category = get("category");
    if (
      !category.trim() ||
      (method === "editCategory" && !Object.hasOwn(state.categories, category))
    )
      throw new Error("分类名称无效");
    if (
      method === "createCategory" &&
      Object.hasOwn(state.categories, category)
    )
      throw new Error("分类已存在");
    Object.defineProperty(state.categories, category, {
      value: { name: category, savePath: get("savePath") },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else if (method === "removeCategories") {
    for (const name of get("categories").split("\n")) {
      delete state.categories[name];
      for (const t of Object.values(torrents))
        if (t.category === name) t.category = "";
    }
  } else if (method === "createTags" || method === "deleteTags") {
    const names = splitTags(get("tags"));
    if (method === "createTags")
      state.tags = [...new Set([...state.tags, ...names])];
    else {
      state.tags = state.tags.filter((name) => !names.includes(name));
      for (const t of Object.values(torrents))
        t.tags = splitTags(t.tags)
          .filter((name) => !names.includes(name))
          .join(", ");
    }
  } else if (method === "addTrackers") {
    if (!task) throw new Error("任务不存在");
    const trackers = trackersFor(hash);
    for (const url of get("urls")
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)) {
      if (!trackers.some((t) => t.url === url))
        trackers.push({ url, status: 1, tier: 0, num_peers: 0, msg: "" });
    }
  } else if (method === "editTracker") {
    const trackers = trackersFor(hash),
      tracker = trackers.find((t) => t.url === get("origUrl"));
    if (!tracker || tracker.tier < 0) throw new Error("Tracker 不存在");
    if (trackers.some((t) => t.url === get("newUrl") && t !== tracker))
      throw new Error("Tracker 已存在");
    tracker.url = get("newUrl");
  } else if (method === "removeTrackers") {
    const urls = get("urls")
      .split("|")
      .map((v) => {
        try {
          return decodeURIComponent(v);
        } catch {
          return v;
        }
      });
    state.trackers[hash] = trackersFor(hash).filter(
      (t) => t.tier < 0 || !urls.includes(t.url),
    );
  } else if (method === "addPeers") {
    const result: Record<string, { added: number; failed: number }> = {};
    const addresses = get("peers").split("|");
    for (const t of tasks) {
      const peers = peersFor(t.hash);
      let added = 0;
      for (const address of addresses) {
        const peer = parseAddress(address);
        if (peer && peer.ip && !state.banned.has(peer.ip)) {
          peers[peerAddress(peer)] = peer;
          added++;
        }
      }
      result[t.hash] = { added, failed: addresses.length - added };
    }
    value = result;
  } else if (route === "transfer/banPeers") {
    const ips = get("peers")
      .split("|")
      .map((value) => parseAddress(value)?.ip)
      .filter(Boolean);
    for (const ip of ips) if (ip) state.banned.add(ip);
    for (const entries of Object.values(state.peers))
      for (const [id, peer] of Object.entries(entries))
        if (ips.includes(peer.ip)) delete entries[id];
  } else if (method === "renameFile" || method === "renameFolder") {
    if (!task) throw new Error("任务不存在");
    const oldPath = get("oldPath"),
      newPath = get("newPath"),
      files = filesFor(hash);
    if (
      !newPath ||
      newPath.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw new Error("新路径无效");
    let renamed = false;
    for (const file of files) {
      const matches =
        method === "renameFile"
          ? file.name === oldPath
          : file.name.startsWith(oldPath + "/");
      if (matches) {
        file.name = newPath + file.name.slice(oldPath.length);
        renamed = true;
      }
    }
    if (!renamed) throw new Error("文件或目录不存在");
  } else if (method === "filePrio") {
    const indexes = get("id").split("|").map(Number);
    for (const file of filesFor(hash))
      if (indexes.includes(file.index)) file.priority = Number(get("priority"));
  } else if (method === "rename") {
    if (!task || !get("name").trim()) throw new Error("任务或名称无效");
    task.name = get("name");
  } else if (
    ["topPrio", "bottomPrio", "increasePrio", "decreasePrio"].includes(method!)
  ) {
    const ordered = Object.values(torrents).sort(
      (a, b) =>
        ((a as NativeTorrent).priority || 0) -
        ((b as NativeTorrent).priority || 0),
    );
    const picked = new Set(tasks.map((t) => t.hash));
    if (method === "topPrio" || method === "bottomPrio") {
      ordered.sort(
        (a, b) =>
          (Number(picked.has(b.hash)) - Number(picked.has(a.hash))) *
          (method === "topPrio" ? 1 : -1),
      );
    } else if (method === "increasePrio") {
      for (let i = 1; i < ordered.length; i++)
        if (picked.has(ordered[i]!.hash) && !picked.has(ordered[i - 1]!.hash))
          [ordered[i - 1], ordered[i]] = [ordered[i]!, ordered[i - 1]!];
    } else {
      for (let i = ordered.length - 2; i >= 0; i--)
        if (picked.has(ordered[i]!.hash) && !picked.has(ordered[i + 1]!.hash))
          [ordered[i + 1], ordered[i]] = [ordered[i]!, ordered[i + 1]!];
    }
    ordered.forEach((t, i) => {
      (t as NativeTorrent).priority = i + 1;
    });
  } else {
    for (const t of tasks) {
      switch (method) {
        case "setForceStart":
          t.force_start = get("value") === "true";
          t.state = t.force_start
            ? t.progress >= 1
              ? "forcedUP"
              : "forcedDL"
            : t.progress >= 1
              ? "uploading"
              : "downloading";
          break;
        case "setSuperSeeding":
          t.super_seeding = get("value") === "true";
          break;
        case "setAutoManagement":
          t.auto_tmm = get("enable") === "true";
          break;
        case "toggleSequentialDownload":
          t.seq_dl = !t.seq_dl;
          break;
        case "toggleFirstLastPiecePrio":
          t.f_l_piece_prio = !t.f_l_piece_prio;
          break;
        case "setDownloadLimit":
          t.dl_limit = Number(get("limit"));
          break;
        case "setUploadLimit":
          t.up_limit = Number(get("limit"));
          break;
        case "setShareLimits":
          t.ratio_limit = Number(get("ratioLimit"));
          t.seeding_time_limit = Number(get("seedingTimeLimit"));
          t.inactive_seeding_time_limit = Number(
            get("inactiveSeedingTimeLimit"),
          );
          break;
        case "setLocation":
          t.save_path = get("location");
          break;
        case "setCategory":
          if (
            get("category") &&
            !Object.hasOwn(state.categories, get("category"))
          )
            throw new Error("分类不存在");
          t.category = get("category");
          break;
        case "addTags":
          t.tags = [
            ...new Set([...splitTags(t.tags), ...splitTags(get("tags"))]),
          ].join(", ");
          state.tags = [...new Set([...state.tags, ...splitTags(get("tags"))])];
          break;
        case "removeTags":
          t.tags = get("tags")
            ? splitTags(t.tags)
                .filter((name) => !splitTags(get("tags")).includes(name))
                .join(", ")
            : "";
          break;
        case "recheck":
          t.state = t.progress >= 1 ? "checkingUP" : "checkingDL";
          t.dlspeed = 0;
          t.upspeed = 0;
          break;
        case "reannounce":
          break;
      }
    }
  }
  return { handled: true, value };
}
