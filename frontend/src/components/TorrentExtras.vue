<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import CapsuleSelect from "./CapsuleSelect.vue";
import { scopedAPI } from "../lib/api";
import { bytes, percent, speed } from "../lib/format";
import {
  mergePeers,
  peerAddress,
  pieceSummary,
  renamePath,
  type Peer,
  type PeerUpdate,
} from "../lib/torrent-operations";
import type { TorrentFile, Tracker } from "../lib/types";
import "../styles/torrent-operations.css";
const api = scopedAPI();

const props = defineProps<{ hash: string }>();
const emit = defineEmits<{ changed: [] }>();
const renameId = useId();
const renameKindOptions = [
  { value: "file", label: "文件" },
  { value: "folder", label: "文件夹" },
];
type ExtraTab = "trackers" | "peers" | "pieces" | "webseeds" | "rename";
interface NativeTracker extends Tracker {
  num_seeds?: number;
  num_leeches?: number;
  num_downloaded?: number;
}
const tabs: Record<ExtraTab, string> = {
  trackers: "Tracker",
  peers: "用户连接",
  pieces: "分块",
  webseeds: "Web seeds",
  rename: "文件重命名",
};
const tab = ref<ExtraTab>("trackers"),
  loading = ref(false),
  busy = ref(false),
  error = ref(""),
  notice = ref("");
const trackers = ref<NativeTracker[]>([]),
  peers = ref<Record<string, Peer>>(Object.create(null));
const pieces = ref<number[]>([]),
  seeds = ref<{ url: string }[]>([]),
  files = ref<TorrentFile[]>([]);
const trackerUrls = ref(""),
  originalUrl = ref(""),
  newUrl = ref(""),
  peerInput = ref("");
const renameKind = ref<"file" | "folder">("file"),
  oldPath = ref(""),
  newName = ref("");
let controller: AbortController | undefined,
  timer: ReturnType<typeof setTimeout> | undefined;
let peerRid = 0,
  disposed = false;
function stop() {
  controller?.abort();
  clearTimeout(timer);
}
onBeforeUnmount(() => {
  disposed = true;
  stop();
});
const folders = computed(() => {
  const result = new Set<string>();
  for (const file of files.value) {
    const segments = file.name.split("/");
    for (let index = 1; index < segments.length; index++)
      result.add(segments.slice(0, index).join("/"));
  }
  return [...result].sort();
});
const pathOptions = computed(() => [
  { value: "", label: renameKind.value === "file" ? "选择文件" : "选择文件夹" },
  ...(renameKind.value === "file"
    ? files.value.map((file) => file.name)
    : folders.value
  ).map((value) => ({ value, label: value })),
]);
function setRenameKind(value: string) {
  if (value === "file" || value === "folder") renameKind.value = value;
}
const counts = computed(() => pieceSummary(pieces.value));
const cells = computed(() => {
  const size = Math.max(1, Math.ceil(pieces.value.length / 512));
  return Array.from(
    { length: Math.ceil(pieces.value.length / size) },
    (_, index) => {
      const start = index * size,
        end = Math.min(start + size, pieces.value.length);
      const values = pieces.value.slice(start, end),
        summary = pieceSummary(values);
      const tone =
        summary.complete === values.length
          ? "complete"
          : summary.downloading
            ? "downloading"
            : summary.complete
              ? "mixed"
              : summary.unknown
                ? "unknown"
                : "missing";
      return {
        start,
        tone,
        title: `分块 ${start}–${end - 1}：已完成 ${summary.complete}，下载中 ${summary.downloading}，未下载 ${summary.missing}，未知 ${summary.unknown}`,
      };
    },
  );
});
async function load() {
  if (disposed) return;
  controller?.abort();
  clearTimeout(timer);
  const local = new AbortController();
  controller = local;
  const hash = props.hash,
    activeTab = tab.value;
  loading.value = true;
  error.value = "";
  const suffix = "?hash=" + encodeURIComponent(hash);
  try {
    switch (activeTab) {
      case "trackers": {
        const value = await api.get<NativeTracker[]>(
          "/api/v2/torrents/trackers" + suffix,
          local.signal,
        );
        if (controller !== local || local.signal.aborted) return;
        trackers.value = value;
        break;
      }
      case "peers": {
        const update = await api.get<PeerUpdate>(
          "/api/v2/sync/torrentPeers" + suffix + "&rid=" + peerRid,
          local.signal,
        );
        if (controller !== local || local.signal.aborted) return;
        peers.value = mergePeers(peers.value, update);
        peerRid = update.rid;
        break;
      }
      case "pieces": {
        const value = await api.get<number[]>(
          "/api/v2/torrents/pieceStates" + suffix,
          local.signal,
        );
        if (controller !== local || local.signal.aborted) return;
        pieces.value = value;
        break;
      }
      case "webseeds": {
        const value = await api.get<{ url: string }[]>(
          "/api/v2/torrents/webseeds" + suffix,
          local.signal,
        );
        if (controller !== local || local.signal.aborted) return;
        seeds.value = value;
        break;
      }
      case "rename": {
        const value = await api.get<TorrentFile[]>(
          "/api/v2/torrents/files" + suffix,
          local.signal,
        );
        if (controller !== local || local.signal.aborted) return;
        files.value = value;
        break;
      }
    }
  } catch (e) {
    if (!local.signal.aborted)
      error.value = e instanceof Error ? e.message : "读取失败";
  } finally {
    if (controller === local && !local.signal.aborted) {
      loading.value = false;
      if (activeTab === "peers") timer = setTimeout(load, 5000);
    }
  }
}
watch(
  () => [props.hash, tab.value],
  () => {
    stop();
    peerRid = 0;
    peers.value = Object.create(null);
    trackers.value = [];
    pieces.value = [];
    seeds.value = [];
    files.value = [];
    oldPath.value = "";
    newName.value = "";
    originalUrl.value = "";
    newUrl.value = "";
    notice.value = "";
    trackerUrls.value = "";
    peerInput.value = "";
    load();
  },
  { immediate: true },
);
watch([oldPath, renameKind], () => {
  newName.value = oldPath.value.split("/").at(-1) || "";
});
watch(renameKind, () => {
  oldPath.value = "";
});
async function mutate(
  endpoint: string,
  data: Record<string, string>,
  message: string,
) {
  if (busy.value) return false;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await api.post("/api/v2/" + endpoint, data);
    notice.value = message;
    emit("changed");
    await load();
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败";
    return false;
  } finally {
    busy.value = false;
  }
}
async function addTrackers() {
  if (
    await mutate(
      "torrents/addTrackers",
      { hash: props.hash, urls: trackerUrls.value.trim() },
      "Tracker 已添加",
    )
  )
    trackerUrls.value = "";
}
async function editTracker() {
  if (
    await mutate(
      "torrents/editTracker",
      {
        hash: props.hash,
        origUrl: originalUrl.value,
        newUrl: newUrl.value.trim(),
      },
      "Tracker 已更新",
    )
  )
    originalUrl.value = "";
}
async function addPeers() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await api.post<
      Record<string, { added: number; failed: number }>
    >("/api/v2/torrents/addPeers", {
      hashes: props.hash,
      peers: peerInput.value
        .split(/[\n|]+/)
        .map((v) => v.trim())
        .filter(Boolean)
        .join("|"),
    });
    const value = result[props.hash];
    notice.value = value
      ? `已添加 ${value.added} 个连接，失败 ${value.failed} 个`
      : "已请求连接用户";
    peerInput.value = "";
    emit("changed");
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "添加连接失败";
  } finally {
    busy.value = false;
  }
}
async function rename() {
  if (busy.value || loading.value) return;
  if (
    !oldPath.value ||
    !pathOptions.value.some((option) => option.value === oldPath.value)
  ) {
    error.value =
      renameKind.value === "file"
        ? "请选择要重命名的文件"
        : "请选择要重命名的文件夹";
    return;
  }
  try {
    const next = renamePath(oldPath.value, newName.value);
    if (next === oldPath.value) {
      error.value = "请输入不同的新名称";
      return;
    }
    if (
      await mutate(
        renameKind.value === "file"
          ? "torrents/renameFile"
          : "torrents/renameFolder",
        { hash: props.hash, oldPath: oldPath.value, newPath: next },
        "名称已更新",
      )
    )
      oldPath.value = next;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function trackerStatus(status: number) {
  return (
    ["已禁用", "尚未联系", "工作正常", "正在更新", "连接失败"][status] || "未知"
  );
}
</script>

<template>
  <section class="torrent-extras">
    <div class="extra-tabs" aria-label="任务连接与文件">
      <button
        v-for="(label, key) in tabs"
        :key="key"
        class="button"
        :aria-pressed="tab === key"
        :class="{ active: tab === key }"
        @click="tab = key"
      >
        {{ label }}
      </button>
    </div>
    <div class="extra-toolbar">
      <h3>{{ tabs[tab] }}</h3>
      <button class="button" :disabled="loading || busy" @click="load">
        {{ loading ? "读取中…" : "刷新" }}
      </button>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="operation-notice" role="status">{{ notice }}</p>
    <template v-if="tab === 'trackers'">
      <div class="operation-table-scroll">
        <table class="operation-table">
          <thead>
            <tr>
              <th>地址</th>
              <th>状态</th>
              <th>层级</th>
              <th>用户数</th>
              <th>种子 / 下载者</th>
              <th>已完成</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tracker in trackers" :key="tracker.url">
              <td class="path-cell">
                {{ tracker.url
                }}<small v-if="tracker.msg">{{ tracker.msg }}</small>
              </td>
              <td>{{ trackerStatus(tracker.status) }}</td>
              <td>{{ tracker.tier < 0 ? "—" : tracker.tier }}</td>
              <td>{{ tracker.num_peers < 0 ? "—" : tracker.num_peers }}</td>
              <td>
                {{
                  tracker.num_seeds === undefined || tracker.num_seeds < 0
                    ? "—"
                    : tracker.num_seeds
                }}
                /
                {{
                  tracker.num_leeches === undefined || tracker.num_leeches < 0
                    ? "—"
                    : tracker.num_leeches
                }}
              </td>
              <td>
                {{
                  tracker.num_downloaded === undefined ||
                  tracker.num_downloaded < 0
                    ? "—"
                    : tracker.num_downloaded
                }}
              </td>
              <td>
                <div v-if="tracker.tier >= 0" class="operation-buttons">
                  <button
                    class="button"
                    :disabled="busy"
                    @click="
                      originalUrl = tracker.url;
                      newUrl = tracker.url;
                    "
                  >
                    编辑</button
                  ><button
                    class="button danger"
                    :disabled="busy"
                    @click="
                      mutate(
                        'torrents/removeTrackers',
                        { hash, urls: encodeURIComponent(tracker.url) },
                        'Tracker 已移除',
                      )
                    "
                  >
                    移除
                  </button>
                </div>
                <span v-else>内置发现</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && !trackers.length" class="small-empty">
        暂无 Tracker
      </p>
      <form
        v-if="originalUrl"
        class="operation-section"
        @submit.prevent="editTracker"
      >
        <p class="muted path-cell">原地址：{{ originalUrl }}</p>
        <label>新 Tracker 地址<input v-model="newUrl" required /></label>
        <div class="operation-buttons">
          <button class="button" :disabled="busy" type="submit">保存地址</button
          ><button class="button" type="button" @click="originalUrl = ''">
            取消编辑
          </button>
        </div>
      </form>
      <form class="operation-section" @submit.prevent="addTrackers">
        <label
          >添加 Tracker（每行一个）<textarea
            v-model="trackerUrls"
            rows="3"
            required
            placeholder="https://tracker.example/announce"
          /></label
        ><button class="button" :disabled="busy" type="submit">
          添加 Tracker
        </button>
      </form>
    </template>
    <template v-else-if="tab === 'peers'">
      <p class="muted">
        {{ Object.keys(peers).length }} 个连接，每 5 秒更新。封禁会将该 IP
        加入全局黑名单。
      </p>
      <div class="operation-table-scroll">
        <table class="operation-table">
          <thead>
            <tr>
              <th>地址</th>
              <th>客户端 / 协议</th>
              <th>进度</th>
              <th>下载</th>
              <th>上传</th>
              <th>已下载 / 已上传</th>
              <th>标志</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(peer, id) in peers" :key="id">
              <td class="path-cell">
                {{ peerAddress(peer) || peer.ip || id
                }}<small v-if="peer.country">{{ peer.country }}</small>
              </td>
              <td>
                {{ peer.client || "—"
                }}<small>{{ peer.connection || "—" }}</small>
              </td>
              <td>
                {{ peer.progress === undefined ? "—" : percent(peer.progress) }}
              </td>
              <td>{{ speed(peer.dl_speed ?? 0) }}</td>
              <td>{{ speed(peer.up_speed ?? 0) }}</td>
              <td>
                {{ bytes(peer.downloaded ?? 0) }} /
                {{ bytes(peer.uploaded ?? 0) }}
              </td>
              <td :title="peer.flags_desc">{{ peer.flags || "—" }}</td>
              <td>
                <button
                  class="button danger"
                  :disabled="busy || !peerAddress(peer)"
                  @click="
                    mutate(
                      'transfer/banPeers',
                      { peers: peerAddress(peer) },
                      'IP 已封禁',
                    )
                  "
                >
                  封禁
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && !Object.keys(peers).length" class="small-empty">
        暂无用户连接
      </p>
      <form class="operation-section" @submit.prevent="addPeers">
        <label
          >添加连接（每行一个 IP:端口）<textarea
            v-model="peerInput"
            rows="3"
            required
            placeholder="192.0.2.1:6881&#10;[2001:db8::1]:6881"
          /></label
        ><button class="button" type="submit" :disabled="busy">添加连接</button>
      </form>
    </template>
    <template v-else-if="tab === 'pieces'">
      <div class="piece-legend">
        <span class="missing">未下载 {{ counts.missing }}</span
        ><span class="downloading">下载中 {{ counts.downloading }}</span
        ><span class="complete">已完成 {{ counts.complete }}</span
        ><span v-if="counts.unknown" class="unknown"
          >未知 {{ counts.unknown }}</span
        >
      </div>
      <p class="muted">
        共 {{ pieces.length }} 块。每格最多
        {{ Math.max(1, Math.ceil(pieces.length / 512)) }}
        块，混合状态表示部分完成。
      </p>
      <div
        class="piece-map"
        role="img"
        :aria-label="`分块状态：未下载 ${counts.missing}，下载中 ${counts.downloading}，已完成 ${counts.complete}`"
      >
        <span
          v-for="cell in cells"
          :key="cell.start"
          :class="cell.tone"
          :title="cell.title"
        />
      </div>
      <p v-if="!loading && !pieces.length" class="small-empty">尚无分块信息</p>
    </template>
    <template v-else-if="tab === 'webseeds'">
      <div class="operation-table-scroll">
        <table class="operation-table">
          <thead>
            <tr>
              <th>Web seed 地址</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="seed in seeds" :key="seed.url">
              <td class="path-cell">{{ seed.url }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && !seeds.length" class="small-empty">
        此任务没有 Web seeds
      </p>
    </template>
    <template v-else>
      <form class="operation-section" @submit.prevent="rename">
        <div>
          <label :for="`${renameId}-kind`">重命名类型</label>
          <CapsuleSelect
            :id="`${renameId}-kind`"
            :model-value="renameKind"
            :options="renameKindOptions"
            :disabled="busy || loading"
            :describedby="`${renameId}-help`"
            @update:model-value="setRenameKind"
          />
        </div>
        <div>
          <label :for="`${renameId}-path`">原路径</label>
          <CapsuleSelect
            :id="`${renameId}-path`"
            v-model="oldPath"
            :options="pathOptions"
            :disabled="busy || loading || pathOptions.length <= 1"
            :describedby="`${renameId}-help`"
          />
        </div>
        <label
          >新名称<input v-model="newName" :disabled="busy || loading" required
        /></label>
        <p :id="`${renameId}-help`" class="muted">
          只修改所选项目的名称，保留父目录。文件夹重命名会更新其中所有文件的路径。
        </p>
        <button
          class="button"
          type="submit"
          :disabled="busy || loading || !oldPath"
        >
          重命名
        </button>
      </form>
      <div class="operation-table-scroll">
        <table class="operation-table">
          <thead>
            <tr>
              <th>文件路径</th>
              <th>大小</th>
              <th>进度</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in files" :key="file.index">
              <td class="path-cell">{{ file.name }}</td>
              <td>{{ bytes(file.size) }}</td>
              <td>{{ percent(file.progress) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && !files.length" class="small-empty">
        尚未获取文件信息
      </p>
    </template>
  </section>
</template>
