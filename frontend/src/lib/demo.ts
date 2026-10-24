import { APIError } from "./api";
import { demoToolsRequest } from "./demo-tools";
import { demoTorrentOperation } from "./demo-torrent-operations";
import { type Preferences, defaultDemoPreferences } from "./preferences";
import type {
  MainData,
  Torrent,
  TorrentFile,
  Tracker,
  TorrentProperties,
  Transfer,
} from "./types";

const GiB = 1024 ** 3,
  MiB = 1024 ** 2;
const now = Math.floor(Date.now() / 1000);
const definitions: [
  string,
  string,
  number,
  number,
  string,
  string,
  string,
  number,
][] = [
  [
    "Ubuntu 26.04 Desktop amd64.iso",
    "downloading",
    6.2,
    0.684,
    "软件",
    "Linux, 开源",
    "ubuntu",
    18.4,
  ],
  [
    "Blender 4.5 LTS · Open Movies Collection",
    "downloading",
    12.8,
    0.327,
    "影视",
    "开源, 收藏",
    "video",
    8.6,
  ],
  [
    "Debian 13.0.0 amd64 DVD-1.iso",
    "uploading",
    3.7,
    1,
    "软件",
    "Linux",
    "linux",
    0,
  ],
  ["Sintel · 4K Open Movie", "uploading", 4.3, 1, "影视", "开源", "video", 0],
  [
    "Wikimedia · Selected Public Domain Images",
    "stoppedDL",
    8.6,
    0.452,
    "资料",
    "收藏",
    "archive",
    0,
  ],
  [
    "Fedora Workstation Live x86_64.iso",
    "downloading",
    2.6,
    0.912,
    "软件",
    "Linux, 开源",
    "linux",
    5.2,
  ],
  [
    "Internet Archive · Live Music Collection",
    "stoppedUP",
    1.9,
    1,
    "音乐",
    "无损",
    "music",
    0,
  ],
  ["Big Buck Bunny · 1080p", "uploading", 0.9, 1, "影视", "开源", "video", 0],
  [
    "NASA · Earth at Night 2025",
    "stoppedDL",
    2.4,
    0.18,
    "资料",
    "收藏",
    "archive",
    0,
  ],
];
let torrents: Record<string, Torrent> = Object.fromEntries(
  definitions.map(
    ([name, state, size, progress, category, tags, , download], index) => {
      const hash = (index + 1).toString(16).padStart(40, "0");
      return [
        hash,
        {
          hash,
          name,
          state,
          size: size * GiB,
          total_size: size * GiB,
          progress,
          category,
          tags,
          dlspeed: download * MiB,
          upspeed:
            state === "uploading"
              ? ((index % 3) + 1) * 1.2 * MiB
              : download
                ? 0.12 * MiB
                : 0,
          downloaded: size * progress * GiB,
          uploaded: state === "uploading" ? size * 2.36 * GiB : 0.2 * GiB,
          ratio: state === "uploading" ? 2.36 : 0.04,
          eta: download ? (size * (1 - progress) * 1024) / download : 8640000,
          num_seeds: state === "stoppedDL" ? 0 : 28 + index * 11,
          num_leechs: 4 + index * 2,
          save_path: "/downloads/" + category,
          added_on: now - index * 5200,
          completion_on: progress === 1 ? now - index * 2300 : -1,
        },
      ];
    },
  ),
);
let rid = 0,
  downLimit = 0,
  upLimit = 0,
  alt = false;
let settings = defaultDemoPreferences();

export async function demoRequest<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 110));
  if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const torrentResult = await demoTorrentOperation(path, init, torrents);
  if (torrentResult.handled) {
    if (
      new URL(path, window.location.origin).pathname ===
      "/api/v2/transfer/banPeers"
    )
      await demoToolsRequest(path, init);
    return torrentResult.value as T;
  }
  const toolsResult = await demoToolsRequest(path, init);
  if (toolsResult.handled) return toolsResult.value as T;
  const url = new URL(path, window.location.origin),
    route = url.pathname;
  const form =
    init.body instanceof FormData || init.body instanceof URLSearchParams
      ? init.body
      : new URLSearchParams();
  const get = (key: string) => String(form.get(key) || "");
  let result: unknown = "Ok.";
  if (route.endsWith("/app/networkInterfaceList"))
    result = [
      { name: "eth0", value: "eth0" },
      { name: "lo", value: "lo" },
    ];
  else if (route.endsWith("/app/networkInterfaceAddressList"))
    result = ["192.168.1.10", "127.0.0.1"];
  else if (route.endsWith("/app/sendTestEmail"))
    throw new Error("演示模式不会发送邮件");
  else if (route.endsWith("/app/version")) result = "v5.1.2";
  else if (route.endsWith("/sync/maindata")) {
    rid++;
    const state: Transfer = {
      dl_info_speed: Object.values(torrents).reduce((s, t) => s + t.dlspeed, 0),
      up_info_speed: Object.values(torrents).reduce((s, t) => s + t.upspeed, 0),
      dl_info_data: 286.4 * GiB,
      up_info_data: 628.9 * GiB,
      free_space_on_disk: 2.48 * 1024 * GiB,
      dht_nodes: 368,
      connection_status: "connected",
      dl_rate_limit: downLimit,
      up_rate_limit: upLimit,
      use_alt_speed_limits: alt,
    };
    result = {
      rid,
      full_update: true,
      torrents: structuredClone(torrents),
      server_state: state,
      categories: (
        await demoTorrentOperation("/api/v2/torrents/categories", {}, torrents)
      ).value as MainData["categories"],
      tags: (await demoTorrentOperation("/api/v2/torrents/tags", {}, torrents))
        .value as string[],
    } satisfies MainData;
  } else if (
    route.endsWith("/torrents/start") ||
    route.endsWith("/torrents/stop") ||
    route.endsWith("/torrents/delete")
  ) {
    for (const hash of get("hashes").split("|")) {
      const t = torrents[hash];
      if (!t) continue;
      if (route.endsWith("/delete")) {
        delete torrents[hash];
        continue;
      }
      const stopped = route.endsWith("/stop");
      t.state = stopped
        ? t.progress >= 1
          ? "stoppedUP"
          : "stoppedDL"
        : t.progress >= 1
          ? "uploading"
          : "downloading";
      t.dlspeed = !stopped && t.progress < 1 ? 4.8 * MiB : 0;
      t.upspeed = !stopped && t.progress >= 1 ? 1.2 * MiB : 0;
    }
  } else if (route.endsWith("/torrents/add")) {
    const files =
      form instanceof FormData
        ? (form.getAll("torrents").filter((f) => f instanceof File) as File[])
        : [];
    const names = files.length
      ? files.map((f) => f.name.replace(/\.torrent$/i, ""))
      : get("urls")
          .split("\n")
          .filter(Boolean)
          .map(
            (link) => new URL(link).searchParams.get("dn") || "正在获取元数据…",
          );
    for (const name of names) {
      const hash = crypto.randomUUID().replaceAll("-", "").padEnd(40, "0");
      torrents[hash] = {
        hash,
        name,
        state: get("stopped") === "true" ? "stoppedDL" : "metaDL",
        progress: 0,
        size: 0,
        total_size: 0,
        dlspeed: 0,
        upspeed: 0,
        downloaded: 0,
        uploaded: 0,
        ratio: 0,
        eta: 8640000,
        category: get("category"),
        tags: get("tags"),
        num_seeds: 0,
        num_leechs: 0,
        save_path: get("savepath") || "/downloads",
        added_on: Math.floor(Date.now() / 1000),
        completion_on: -1,
      };
    }
  } else if (route.endsWith("/torrents/files")) {
    const t = torrents[url.searchParams.get("hash") || ""];
    result = t
      ? ([
          {
            index: 0,
            name: t.name,
            size: t.size,
            progress: t.progress,
            priority: 1,
          },
        ] satisfies TorrentFile[])
      : [];
  } else if (route.endsWith("/torrents/trackers"))
    result = [
      { url: "** [DHT] **", status: 2, tier: -1, num_peers: 26, msg: "" },
      {
        url: "udp://tracker.opentrackr.org:1337/announce",
        status: 2,
        tier: 0,
        num_peers: 184,
        msg: "",
      },
    ] satisfies Tracker[];
  else if (route.endsWith("/torrents/properties")) {
    const t = torrents[url.searchParams.get("hash") || ""];
    result = t
      ? ({
          save_path: t.save_path,
          total_size: t.size,
          total_downloaded: t.downloaded,
          total_uploaded: t.uploaded,
          creation_date: now - 86400 * 7,
          addition_date: t.added_on,
          completion_date: t.completion_on,
          piece_size: 4 * MiB,
          pieces_have: Math.floor(t.progress * 1024),
          pieces_num: 1024,
          comment: "演示数据",
          time_elapsed: 2860,
          seeding_time: 1200,
        } satisfies TorrentProperties)
      : {};
  } else if (route.endsWith("/app/preferences")) {
    const copy: Preferences = {
      ...settings,
      dl_limit: downLimit,
      up_limit: upLimit,
    };
    const configured = new Set(copy._orbitdown?.configured_fields || []);
    for (const key of copy._orbitdown?.masked_fields || []) {
      if (copy[key]) configured.add(key);
      else if (key !== "web_ui_password") configured.delete(key);
      copy[key] = "";
    }
    copy._orbitdown = {
      ...copy._orbitdown,
      configured_fields: [...configured],
    };
    result = copy;
  } else if (route.endsWith("/app/setPreferences")) {
    const prefs = JSON.parse(get("json"));
    settings = { ...settings, ...prefs };
    if ("dl_limit" in prefs) downLimit = prefs.dl_limit;
    if ("up_limit" in prefs) upLimit = prefs.up_limit;
  } else if (route.endsWith("/transfer/info"))
    result = {
      dl_info_speed: 0,
      up_info_speed: 0,
      dl_info_data: 286.4 * GiB,
      up_info_data: 628.9 * GiB,
      connection_status: "connected",
      dht_nodes: 368,
    };
  else if (route.endsWith("/transfer/downloadLimit")) result = downLimit;
  else if (route.endsWith("/transfer/uploadLimit")) result = upLimit;
  else if (route.endsWith("/transfer/setDownloadLimit"))
    downLimit = Number(get("limit"));
  else if (route.endsWith("/transfer/setUploadLimit"))
    upLimit = Number(get("limit"));
  else if (route.endsWith("/transfer/toggleSpeedLimitsMode")) alt = !alt;
  else if (route.endsWith("/transfer/speedLimitsMode")) result = alt ? 1 : 0;
  else if (
    route.endsWith("/torrents/filePrio") ||
    route.endsWith("/auth/logout")
  )
    result = "";
  else throw new Error("演示模式不支持此操作");
  return result as T;
}
