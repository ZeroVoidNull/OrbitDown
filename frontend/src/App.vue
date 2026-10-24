<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import Icon from "./components/Icon.vue";
import MetricValue from "./components/MetricValue.vue";
import CapsuleSelect from "./components/CapsuleSelect.vue";
import TorrentList from "./components/TorrentList.vue";
import AddTorrent from "./components/AddTorrent.vue";
import DetailsPanel from "./components/DetailsPanel.vue";
import TorrentOperations from "./components/TorrentOperations.vue";
import RSSPanel from "./components/RSSPanel.vue";
import SearchPanel from "./components/SearchPanel.vue";
import ToolsPanel from "./components/ToolsPanel.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import ConnectionPanel from "./components/ConnectionPanel.vue";
import ModalShell from "./components/ModalShell.vue";
import WindowControls from "./components/WindowControls.vue";
import { api, APIError, isDemo } from "./lib/api";
import { inTauri, isDesktopTauri } from "./lib/transport";
import {
  adoptSession,
  authenticate,
  eraseConnection,
  invalidateSession,
  readConnection,
  readSavedPassword,
  writeConnection,
} from "./lib/qbit";
import { bytes, speed } from "./lib/format";
import type { ConnectionInfo } from "./lib/connection";
import { connectionValidationError, splitConnectionUrl, joinConnectionAddress, connectionEndpointError } from "./lib/connection";
import {
  filterTorrents,
  mergeMainData,
  statusOf,
  tagsOf,
} from "./lib/torrents";
import type {
  Filters,
  MainData,
  Session,
  StatusKey,
  Torrent,
  Transfer,
} from "./lib/types";

const session = ref<Session | null>(null),
  booting = ref(true),
  loading = ref(true),
  refreshing = ref(false),
  error = ref(""),
  toast = ref(""),
  version = ref(""),
  lastSync = ref<Date | null>(null);
const connection = ref<ConnectionInfo | null>(null);
const showConnection = ref(false);
const loginForm = reactive({
  address: "",
  port: "",
  username: "",
  password: "",
});
const loginBusy = ref(false);
const listEpoch = ref(0);
const torrents = ref<Record<string, Torrent>>(Object.create(null)),
  transfer = ref<Partial<Transfer>>({}),
  categories = ref<string[]>([]),
  tags = ref<string[]>([]),
  defaultPath = ref("");
const filter = reactive<Filters>({
  search: "",
  status: "all",
  category: "",
  tag: "",
  sort: "added",
});
const showAdd = ref(false),
  showFilters = ref(false),
  showAccount = ref(false),
  selecting = ref(false),
  selected = ref<string[]>([]),
  detailHash = ref(""),
  deleteHashes = ref<string[]>([]),
  deleteFiles = ref(false),
  busy = ref(false);
type PageKey = "tasks" | "search" | "rss" | "tools" | "settings";
const page = ref<PageKey>("tasks");
const pages: {
  key: PageKey;
  label: string;
  icon: "download" | "search" | "globe" | "listFilter" | "settings";
}[] = [
  { key: "tasks", label: "下载任务", icon: "download" },
  { key: "search", label: "种子搜索", icon: "search" },
  { key: "rss", label: "RSS 订阅", icon: "globe" },
  { key: "tools", label: "管理工具", icon: "listFilter" },
  { key: "settings", label: "设置", icon: "settings" },
];

// 工作区导航滑动指示器：测量当前选中按钮的位置，指示器平滑滑动。
// 任务行右键菜单：右击已选中的任务时作用于整个选中集合。
const contextMenu = ref<InstanceType<typeof TorrentOperations> | null>(null);
const contextHashes = ref<string[]>([]);
const contextTorrent = ref<Torrent | undefined>();
async function rowContextMenu(payload: {
  torrent: Torrent;
  x: number;
  y: number;
}) {
  const inSelection =
    selecting.value && selected.value.includes(payload.torrent.hash);
  contextHashes.value = inSelection ? [...selected.value] : [payload.torrent.hash];
  contextTorrent.value = inSelection && contextHashes.value.length > 1
    ? undefined
    : payload.torrent;
  await nextTick();
  void contextMenu.value?.open({ x: payload.x, y: payload.y });
}

// 桌面 app 内屏蔽系统右键菜单（输入控件保留系统粘贴等选项）。
function suppressContextMenu(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable]")) return;
  event.preventDefault();
}
const list = computed(() => Object.values(torrents.value)),
  visible = computed(() => filterTorrents(list.value, filter)),
  detail = computed(() => torrents.value[detailHash.value]),
  deleteNames = computed(() =>
    deleteHashes.value.map((h) => torrents.value[h]?.name).filter(Boolean),
  );
const statuses: {
  key: StatusKey;
  label: string;
  icon: "grid" | "download" | "upload" | "pause" | "checks" | "alert";
}[] = [
  { key: "all", label: "所有任务", icon: "grid" },
  { key: "downloading", label: "下载中", icon: "download" },
  { key: "seeding", label: "做种中", icon: "upload" },
  { key: "paused", label: "已暂停", icon: "pause" },
  { key: "completed", label: "已完成", icon: "checks" },
  { key: "error", label: "有异常", icon: "alert" },
];
const title = computed(
  () =>
    filter.category ||
    filter.tag ||
    statuses.find((s) => s.key === filter.status)?.label ||
    "所有任务",
);
const statusCounts = computed(() =>
  Object.fromEntries(
    statuses.map((s) => [
      s.key,
      s.key === "all"
        ? list.value.length
        : s.key === "completed"
          ? list.value.filter((t) => t.progress >= 1).length
          : list.value.filter((t) => statusOf(t.state).key === s.key).length,
    ]),
  ),
);
const hasFilter = computed(
  () =>
    !!filter.search ||
    !!filter.category ||
    !!filter.tag ||
    filter.status !== "all",
);
const allSelected = computed(
  () =>
    visible.value.length > 0 &&
    visible.value.every((t) => selected.value.includes(t.hash)),
);
const downloadHistory = ref<number[]>([]),
  uploadHistory = ref<number[]>([]);
const spark = (history: number[]) => {
  const max = Math.max(...history, 1);
  return history
    .map(
      (value, i) =>
        `${(i * 180) / Math.max(history.length - 1, 1)},${36 - (value / max) * 28}`,
    )
    .join(" ");
};
let rid = 0,
  instanceEpoch = 0,
  timer: ReturnType<typeof setTimeout> | undefined,
  toastTimer: ReturnType<typeof setTimeout> | undefined,
  inFlight: Promise<void> | null = null,
  disposed = false,
  failures = 0;
function notify(message: string) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 4500);
}
function unauthorized() {
  instanceEpoch++;
  session.value = null;
  torrents.value = Object.create(null);
  selected.value = [];
  detailHash.value = "";
  showAdd.value = false;
  showAccount.value = false;
  showConnection.value = false;
  connection.value = null;
  page.value = "tasks";
  deleteHashes.value = [];
  loginForm.password = "";
  rid = 0;
  clearTimeout(timer);
  error.value = "qBittorrent 连接已失效，请重新登录。";
}
function schedule() {
  clearTimeout(timer);
  if (!disposed && session.value)
    timer = setTimeout(
      () => void refresh(),
      Math.min(
        30000,
        document.hidden ? 15000 : 2000 * 2 ** Math.min(failures, 4),
      ),
    );
}
async function performRefresh() {
  refreshing.value = true;
  try {
    const update = await api.get<MainData>("/api/v2/sync/maindata?rid=" + rid);
    if (!session.value || disposed) return;
    torrents.value = mergeMainData(torrents.value, update);
    rid = update.rid;
    transfer.value = {
      ...(update.full_update ? {} : transfer.value),
      ...update.server_state,
    };
    if (update.full_update) {
      categories.value = [];
      tags.value = [];
    }
    categories.value = [
      ...new Set([
        ...categories.value,
        ...Object.keys(update.categories || {}),
        ...list.value.map((t) => t.category).filter(Boolean),
      ]),
    ]
      .filter((c) => !update.categories_removed?.includes(c))
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
    tags.value = [
      ...new Set([
        ...tags.value,
        ...(update.tags || []),
        ...list.value.flatMap(tagsOf),
      ]),
    ].filter((t) => !update.tags_removed?.includes(t));
    selected.value = selected.value.filter((hash) => !!torrents.value[hash]);
    if (detailHash.value && !torrents.value[detailHash.value])
      detailHash.value = "";
    lastSync.value = new Date();
    error.value = "";
    failures = 0;
    downloadHistory.value = [
      ...downloadHistory.value,
      transfer.value.dl_info_speed || 0,
    ].slice(-28);
    uploadHistory.value = [
      ...uploadHistory.value,
      transfer.value.up_info_speed || 0,
    ].slice(-28);
  } catch (e) {
    failures++;
    if (!(e instanceof APIError && (e.status === 401 || e.status === 403)))
      error.value = e instanceof Error ? e.message : "无法同步任务";
  } finally {
    loading.value = false;
    refreshing.value = false;
    schedule();
  }
}
function refresh() {
  if (inFlight) return inFlight;
  inFlight = performRefresh().finally(() => (inFlight = null));
  return inFlight;
}
// 诊断上报：登录失败细节打到 Rust stdout（cargo run / 控制台可见）。
function reportDiag(tag: string, e: unknown) {
  if (!inTauri) return;
  import("@tauri-apps/api/core")
    .then(({ invoke }) =>
      invoke("report_log", {
        msg: `${tag} ${e instanceof Error ? e.message : String(e)}\n${e instanceof Error ? (e.stack ?? "") : ""}`,
      }),
    )
    .catch(() => {});
}
async function initialize() {
  booting.value = true;
  error.value = "";
  try {
    if (isDemo) {
      connection.value = await readConnection();
      session.value = {
        user: { name: "Feng", username: "feng" },
        instance: "Home NAS",
      };
      booting.value = false;
      await refresh();
      return;
    }
    const saved = await readConnection();
    const endpoint = splitConnectionUrl(saved.url);
    loginForm.address = endpoint.address;
    loginForm.port = endpoint.port;
    loginForm.username = saved.username;
    if (!saved.configured) {
      booting.value = false;
      return;
    }
    const password = await readSavedPassword(saved.username);
    const auth = await authenticate(saved.url, saved.username, password);
    adoptSession(saved.url, saved.username, auth.sid, password);
    connection.value = saved;
    session.value = {
      user: { name: saved.username, username: saved.username },
      instance: "qBittorrent",
    };
    booting.value = false;
    await refresh();
    await refreshInstanceInfo();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "无法连接 qBittorrent";
    reportDiag("[auto-login-error]", e);
  } finally {
    booting.value = false;
  }
}

async function submitLogin() {
  if (loginBusy.value) return;
  const fields = {
    url: joinConnectionAddress(loginForm.address, loginForm.port),
    username: loginForm.username.trim(),
    password: loginForm.password,
  };
  error.value =
    connectionEndpointError(loginForm.address, loginForm.port) ||
    connectionValidationError(null, fields);
  if (error.value) return;
  loginBusy.value = true;
  error.value = "";
  try {
    const auth = await authenticate(fields.url, fields.username, fields.password);
    await writeConnection(fields);
    adoptSession(fields.url, fields.username, auth.sid, fields.password);
    connection.value = await readConnection();
    session.value = {
      user: { name: fields.username, username: fields.username },
      instance: "qBittorrent",
    };
    loginForm.password = "";
    loading.value = true;
    await refresh();
    await refreshInstanceInfo();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "登录失败，请重试";
    reportDiag("[login-error]", e);
  } finally {
    loginBusy.value = false;
  }
}
async function refreshInstanceInfo() {
  const epoch = ++instanceEpoch;
  const [info, appVersion, prefs] = await Promise.allSettled([
    readConnection(),
    api.get<string>("/api/v2/app/version"),
    api.get<{ save_path: string }>("/api/v2/app/preferences"),
  ] as const);
  if (epoch !== instanceEpoch || !session.value || disposed) return;
  if (info.status === "fulfilled") connection.value = info.value;
  if (appVersion.status === "fulfilled") version.value = appVersion.value;
  if (prefs.status === "fulfilled")
    defaultPath.value = prefs.value.save_path || "";
}
async function connectionSaved() {
  showConnection.value = false;
  await inFlight;
  clearTimeout(timer);
  rid = 0;
  torrents.value = Object.create(null);
  transfer.value = {};
  categories.value = [];
  tags.value = [];
  selected.value = [];
  detailHash.value = "";
  defaultPath.value = "";
  version.value = "";
  lastSync.value = null;
  downloadHistory.value = [];
  uploadHistory.value = [];
  resetFilters();
  loading.value = true;
  connection.value = await readConnection();
  await refreshInstanceInfo();
  await refresh();
  if (session.value) notify("qBittorrent 连接已保存");
}
function setStatus(key: StatusKey) {
  filter.status = key;
  filter.category = "";
  filter.tag = "";
  showFilters.value = false;
}
function resetFilters() {
  filter.search = "";
  filter.status = "all";
  filter.category = "";
  filter.tag = "";
}
function toggleSelect(hash: string) {
  selected.value = selected.value.includes(hash)
    ? selected.value.filter((h) => h !== hash)
    : [...selected.value, hash];
}
function toggleAll() {
  if (allSelected.value)
    selected.value = selected.value.filter(
      (h) => !visible.value.some((t) => t.hash === h),
    );
  else
    selected.value = [
      ...new Set([...selected.value, ...visible.value.map((t) => t.hash)]),
    ];
}
function exitSelection() {
  selecting.value = false;
  selected.value = [];
}
async function action(type: "start" | "stop", hashes: string[]) {
  if (!hashes.length || busy.value) return;
  busy.value = true;
  try {
    await api.post("/api/v2/torrents/" + type, { hashes: hashes.join("|") });
    notify(`${hashes.length} 个任务已${type === "start" ? "继续" : "暂停"}`);
    await refresh();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败");
  } finally {
    busy.value = false;
  }
}
function remove(hashes: string[]) {
  deleteHashes.value = [...hashes];
  deleteFiles.value = false;
}
async function confirmDelete() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.post("/api/v2/torrents/delete", {
      hashes: deleteHashes.value.join("|"),
      deleteFiles: String(deleteFiles.value),
    });
    notify(`已删除 ${deleteHashes.value.length} 个任务`);
    deleteHashes.value = [];
    await refresh();
  } catch (e) {
    notify(e instanceof Error ? e.message : "删除失败");
  } finally {
    busy.value = false;
  }
}
async function added() {
  showAdd.value = false;
  resetFilters();
  notify("下载任务已添加");
  await refresh();
}
async function saved(path: string) {
  defaultPath.value = path;
  notify("下载设置已保存");
  await refresh();
}
async function logout() {
  busy.value = true;
  try {
    invalidateSession();
    unauthorized();
    error.value = "";
    notify("已退出登录");
  } finally {
    busy.value = false;
  }
}
async function clearSavedCredentials() {
  if (busy.value) return;
  busy.value = true;
  try {
    await eraseConnection(session.value?.user.username || loginForm.username);
    invalidateSession();
    unauthorized();
    error.value = "";
    loginForm.address = "";
    loginForm.port = "";
    loginForm.username = "";
    notify("已清除本机保存的连接信息");
  } catch (e) {
    notify(e instanceof Error ? e.message : "清除失败");
  } finally {
    busy.value = false;
  }
}
async function toggleAlternative() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.post("/api/v2/transfer/toggleSpeedLimitsMode");
    await refresh();
    notify(
      transfer.value.use_alt_speed_limits
        ? "已开启备用限速"
        : "已恢复正常速度限制",
    );
  } catch (e) {
    notify(e instanceof Error ? e.message : "切换失败");
  } finally {
    busy.value = false;
  }
}
function visibility() {
  if (!document.hidden && session.value) void refresh();
}
function shortcuts(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (
    ["INPUT", "TEXTAREA", "SELECT"].includes(tag) ||
    showAdd.value ||
    page.value !== "tasks" ||
    detail.value ||
    showAccount.value ||
    showFilters.value ||
    deleteHashes.value.length
  )
    return;
  if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    document.querySelector<HTMLInputElement>("#torrent-search")?.focus();
  }
  if (e.key === "Escape") exitSelection();
}
onMounted(() => {
  window.addEventListener("orbitdown:unauthorized", unauthorized);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("keydown", shortcuts);
  if (inTauri) document.documentElement.classList.add("in-tauri");
  window.addEventListener("contextmenu", suppressContextMenu);
  void initialize();
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(timer);
  clearTimeout(toastTimer);
  window.removeEventListener("orbitdown:unauthorized", unauthorized);
  window.removeEventListener("contextmenu", suppressContextMenu);
  document.removeEventListener("visibilitychange", visibility);
  document.removeEventListener("keydown", shortcuts);
});
</script>

<template>
  <WindowControls v-if="isDesktopTauri" />
  <div v-if="booting" class="boot-screen" data-tauri-drag-region="deep">
    <img src="/logo.svg" width="50" height="50" alt="" /><span>OrbitDown</span
    ><Icon name="loading" class="spin" :size="20" />
    <p>正在连接…</p>
  </div>
  <div v-else-if="!session" class="login-layout" data-tauri-drag-region>
    <a class="brand login-brand" href="/"
      ><img src="/logo.svg" alt="" width="40" height="40" />OrbitDown</a
    >
    <section class="login-panel glass">
      <span class="login-orbit"><Icon name="download" :size="28" /></span>
      <h2>连接 qBittorrent</h2>
      <p class="muted">输入 qBittorrent WebUI 地址与账号，登录后凭据保存在本机。</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <form class="login-form" autocomplete="off" @submit.prevent="submitLogin">
        <div class="login-server-row">
          <label class="field" for="login-address">
            服务器地址
            <input
              id="login-address"
              v-model="loginForm.address"
              type="text"
              inputmode="url"
              placeholder="192.168.1.10"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              :disabled="loginBusy"
              required
            />
          </label>
          <label class="field" for="login-port">
            端口
            <input
              id="login-port"
              v-model="loginForm.port"
              type="text"
              inputmode="numeric"
              placeholder="8080"
              autocomplete="off"
              :disabled="loginBusy"
              required
            />
          </label>
        </div>
        <label class="field" for="login-username">
          用户名
          <input
            id="login-username"
            v-model="loginForm.username"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :disabled="loginBusy"
            required
          />
        </label>
        <label class="field" for="login-password">
          密码
          <input
            id="login-password"
            v-model="loginForm.password"
            type="password"
            autocomplete="off"
            data-lpignore="true"
            data-1p-ignore
            :disabled="loginBusy"
            required
          />
        </label>
        <button
          class="button primary login-button"
          type="submit"
          :disabled="loginBusy"
        >
          <Icon
            :name="loginBusy ? 'loading' : 'link'"
            :class="{ spin: loginBusy }"
            :size="19"
          />{{ loginBusy ? "正在连接…" : "连接并登录" }}
        </button>
      </form>
    </section>
  </div>
  <div v-else class="app-shell">
    <div class="app-body">
      <aside
        class="app-sidebar"
        aria-label="应用导航"
        data-tauri-drag-region="deep"
      >
        <div class="app-sidebar-head" aria-hidden="true"></div>
        <nav class="app-sidebar-nav">
          <button
            v-for="item in pages"
            :key="item.key"
            class="app-nav-item"
            :class="{ active: page === item.key }"
            :aria-current="page === item.key ? 'page' : undefined"
            @click="page = item.key"
          >
            <Icon :name="item.icon" :size="19" /><span>{{ item.label }}</span>
          </button>
        </nav>
        <div class="app-sidebar-foot">
          <button
            class="button quiet speed-mode-toggle"
            :class="{ enabled: transfer.use_alt_speed_limits }"
            :disabled="busy"
            :aria-pressed="!!transfer.use_alt_speed_limits"
            aria-label="切换备用限速"
            title="切换备用限速"
            @click="toggleAlternative"
          >
            <Icon name="turtle" :size="18" />
            <span>备用限速</span>
            <span class="speed-mode-state">{{
              transfer.use_alt_speed_limits ? "开启" : "关闭"
            }}</span>
            <span class="speed-mode-switch" aria-hidden="true"></span>
          </button>
          <span class="version">qBittorrent {{ version || "—" }}</span>
        </div>
      </aside>
      <div class="app-main-col">
        <header class="site-header" data-tauri-drag-region="deep">
          <span class="brand"
            ><img src="/logo.svg" alt="" width="30" height="30" /><span
              >OrbitDown</span
            ></span
          ><span class="brand-separator"></span>
          <button
            class="instance-pill connection-trigger"
            aria-label="配置 qBittorrent 连接"
            :title="connection?.url || '连接 qBittorrent'"
            @click="showConnection = true"
          >
            <span
              class="connection-dot"
              :class="{ offline: !!error || !connection?.configured }"
            ></span>
            <Icon class="connection-mobile-icon" name="link" :size="20" />
            <span class="instance-name">{{
              isDemo ? "Home NAS" : connection?.username || "qBittorrent"
            }}</span>
            <span class="instance-label">{{
              !connection?.configured ? "未连接" : error ? "连接异常" : "已连接"
            }}</span>
            <Icon class="connection-chevron" name="chevronDown" :size="14" />
          </button>
          <div class="header-right">
            <span v-if="isDemo" class="demo-badge">演示模式</span
            ><button
              class="avatar"
              :aria-label="'账号：' + session.user.name"
              @click="showAccount = true"
            >
              {{ session.user.name.charAt(0).toUpperCase() }}
            </button>
          </div>
        </header>
        <main class="main-container">
        <h1 class="sr-only">{{ pages.find((p) => p.key === page)?.label }}</h1>
        <template v-if="page === 'tasks'">
      <section class="overview" aria-label="传输概览">
        <article class="stat-card glass download-stat">
          <div class="stat-top">
            <span class="stat-label"
              ><span class="stat-icon blue"
                ><Icon name="down" :size="18" /></span
              >下载速度</span
            ><span class="stat-meta"
              >{{ statusCounts.downloading }} 个任务</span
            >
          </div>
          <div class="stat-value tabular">
            <MetricValue :value="speed(transfer.dl_info_speed || 0)" />
            <svg class="sparkline blue" viewBox="0 0 180 40" aria-hidden="true">
              <polyline :points="spark(downloadHistory)" />
            </svg>
          </div>
          <div class="stat-bottom">
            累计下载 <span>{{ bytes(transfer.dl_info_data || 0) }}</span>
          </div>
        </article>
        <article class="stat-card glass upload-stat">
          <div class="stat-top">
            <span class="stat-label"
              ><span class="stat-icon green"><Icon name="up" :size="18" /></span
              >上传速度</span
            ><span class="stat-meta">{{ statusCounts.seeding }} 个做种</span>
          </div>
          <div class="stat-value tabular">
            <MetricValue :value="speed(transfer.up_info_speed || 0)" />
            <svg
              class="sparkline green"
              viewBox="0 0 180 40"
              aria-hidden="true"
            >
              <polyline :points="spark(uploadHistory)" />
            </svg>
          </div>
          <div class="stat-bottom">
            累计上传 <span>{{ bytes(transfer.up_info_data || 0) }}</span>
          </div>
        </article>
        <article class="stat-card glass storage-stat">
          <div class="stat-top">
            <span class="stat-label"
              ><span class="stat-icon gray"
                ><Icon name="disk" :size="18" /></span
              >可用空间</span
            ><span class="stat-meta">下载磁盘</span>
          </div>
          <div class="stat-value tabular">
            <MetricValue :value="bytes(transfer.free_space_on_disk ?? NaN)" />
            <div class="storage-illustration" aria-hidden="true">
              <Icon name="disk" :size="44" />
            </div>
          </div>
          <div class="stat-bottom">
            {{ transfer.dht_nodes || 0 }} 个 DHT 节点
            <span class="storage-dot">·</span>
            {{
              transfer.connection_status === "connected"
                ? "网络通畅"
                : transfer.connection_status === "firewalled"
                  ? "连接受限"
                  : "正在连接"
            }}
          </div>
        </article>
      </section>
      <div v-if="error" class="connection-error" role="alert">
        <Icon name="alert" :size="19" /><span
          >{{ error
          }}<small v-if="lastSync">正在展示上次同步的数据。</small></span
        ><button class="button quiet" :disabled="refreshing" @click="refresh">
          <Icon name="refresh" :class="{ spin: refreshing }" :size="16" />重试
        </button>
      </div>
      <div class="workspace">
        <aside class="sidebar" aria-label="任务筛选">
          <div class="sidebar-section">
            <h2>任务</h2>
            <button
              v-for="status in statuses"
              :key="status.key"
              class="nav-item"
              :class="{
                active:
                  filter.status === status.key &&
                  !filter.category &&
                  !filter.tag,
              }"
              :aria-pressed="
                filter.status === status.key && !filter.category && !filter.tag
              "
              @click="setStatus(status.key)"
            >
              <Icon :name="status.icon" :size="18" /><span>{{
                status.label
              }}</span
              ><b>{{ statusCounts[status.key] }}</b>
            </button>
          </div>
          <div class="sidebar-section">
            <h2>分类 <Icon name="folder" :size="14" /></h2>
            <button
              v-for="category in categories"
              :key="category"
              class="nav-item category-nav"
              :class="{ active: filter.category === category }"
              @click="
                filter.category = filter.category === category ? '' : category;
                filter.tag = '';
                filter.status = 'all';
              "
            >
              <span
                class="category-dot"
                :class="
                  category === '软件'
                    ? 'blue'
                    : category === '影视'
                      ? 'purple'
                      : category === '音乐'
                        ? 'amber'
                        : 'green'
                "
              ></span
              ><span>{{ category }}</span
              ><b>{{
                list.filter((t) => t.category === category).length
              }}</b></button
            ><span v-if="!categories.length" class="sidebar-empty"
              >还没有分类</span
            >
          </div>
          <div class="sidebar-section tags-section">
            <h2>标签 <Icon name="tag" :size="14" /></h2>
            <div class="tag-cloud">
              <button
                v-for="tag in tags"
                :key="tag"
                :class="{ active: filter.tag === tag }"
                @click="
                  filter.tag = filter.tag === tag ? '' : tag;
                  filter.category = '';
                  filter.status = 'all';
                "
              >
                {{ tag }}</button
              ><span v-if="!tags.length" class="sidebar-empty">还没有标签</span>
            </div>
          </div>
        </aside>
        <section class="tasks-panel glass" :aria-label="title">
          <div class="tasks-heading">
            <div v-if="title !== '所有任务'" class="tasks-title">
              <h2>{{ title }}</h2>
              <span class="count-badge">{{ visible.length }}</span>
            </div>
            <div class="task-heading-actions">
              <button
                class="icon-button mobile-filter"
                aria-label="筛选任务"
                @click="showFilters = true"
              >
                <Icon name="filter" :size="19" /><i
                  v-if="hasFilter"
                  class="filter-indicator"
                ></i></button
              ><button
                class="icon-button mobile-tools"
                aria-label="打开管理工具"
                @click="page = 'tools'"
              >
                <Icon name="listFilter" :size="19" />
              </button>
              <button
                class="button primary add-button"
                :disabled="busy"
                @click="showAdd = true"
              >
                <Icon name="plus" :size="18" /><span>添加下载</span>
              </button>
              <button
                class="button text-button select-button"
                :class="{ selected: selecting }"
                @click="selecting ? exitSelection() : (selecting = true)"
              >
                <Icon
                  :name="selecting ? 'close' : 'select'"
                  :size="17"
                /><span>{{ selecting ? "取消选择" : "选择" }}</span></button
              ><button
                class="icon-button refresh-button"
                :disabled="refreshing"
                aria-label="刷新任务"
                @click="refresh"
              >
                <Icon name="refresh" :size="17" :class="{ spin: refreshing }" />
              </button>
            </div>
          </div>
          <div class="list-toolbar">
            <label class="search-field" for="torrent-search"
              ><Icon name="search" :size="18" /><input
                id="torrent-search"
                v-model="filter.search"
                type="search"
                placeholder="搜索任务…"
                autocomplete="off"
              /><kbd v-if="!filter.search">/</kbd></label
            ><label class="sort-field"
              ><Icon name="sort" :size="16" /><CapsuleSelect
                :model-value="filter.sort"
                aria-label="任务排序"
                :options="[
                  { value: 'added', label: '最近添加' },
                  { value: 'name', label: '名称排序' },
                  { value: 'size', label: '文件大小' },
                  { value: 'progress', label: '完成进度' },
                  { value: 'speed', label: '下载速度' },
                ]"
                @update:model-value="filter.sort = $event as Filters['sort']"
              />
            </label>
          </div>
          <div v-if="selecting" class="selection-toolbar">
            <button
              class="checkbox-button"
              :aria-pressed="allSelected"
              @click="toggleAll"
            >
              <span class="mini-checkbox" :class="{ checked: allSelected }"
                ><Icon v-if="allSelected" name="check" :size="12" /></span
              >全选<span class="selection-count"
                >已选 {{ selected.length }}</span
              >
            </button>
            <div class="bulk-actions">
              <TorrentOperations
                :hashes="selected"
                :torrent="
                  selected.length === 1 ? torrents[selected[0]] : undefined
                "
                :disabled="busy"
                @changed="refresh"
                @notice="notify"
                @remove="remove"
              />
              <button
                class="icon-button"
                :disabled="!selected.length || busy"
                aria-label="继续选中的任务"
                @click="action('start', selected)"
              >
                <Icon name="play" :size="17" /></button
              ><button
                class="icon-button"
                :disabled="!selected.length || busy"
                aria-label="暂停选中的任务"
                @click="action('stop', selected)"
              >
                <Icon name="pause" :size="17" /></button
              ><button
                class="icon-button danger"
                :disabled="!selected.length || busy"
                aria-label="删除选中的任务"
                @click="remove(selected)"
              >
                <Icon name="trash" :size="17" />
              </button>
            </div>
          </div>
          <div
            v-if="loading"
            class="task-skeleton"
            aria-label="正在加载任务"
            aria-busy="true"
          >
            <div v-for="i in 5" :key="i">
              <span></span>
              <div><i></i><i></i></div>
              <b></b>
            </div>
          </div>
          <TorrentList
            v-else-if="visible.length"
            :key="listEpoch"
            :torrents="visible"
            :selected="selected"
            :selecting="selecting"
            :busy="busy"
            @open="detailHash = $event.hash"
            @select="toggleSelect"
            @action="action"
            @changed="refresh"
            @notice="notify"
            @remove="remove"
            @contextmenu="rowContextMenu"
          />
          <div v-else class="empty-state">
            <span class="empty-orbit"
              ><Icon
                :name="hasFilter ? 'search' : error ? 'wifi' : 'download'"
                :size="32"
            /></span>
            <h3>
              {{
                !connection?.configured
                  ? "尚未连接 qBittorrent"
                  : hasFilter
                    ? "没有找到匹配的任务"
                    : error
                      ? "暂时无法获取任务"
                      : "暂无下载任务"
              }}
            </h3>
            <p>
              {{
                !connection?.configured
                  ? "点击左上角连接状态，填写 WebUI 地址和账号。"
                  : hasFilter
                    ? "试试其他关键词，或调整筛选条件。"
                    : error
                      ? "检查 qBittorrent 的连接后再试一次。"
                      : "添加磁力链接或种子文件。"
              }}
            </p>
            <button
              class="button quiet"
              @click="
                !connection?.configured
                  ? (showConnection = true)
                  : hasFilter
                    ? resetFilters()
                    : error
                      ? refresh()
                      : (showAdd = true)
              "
            >
              {{
                !connection?.configured
                  ? "连接 qBittorrent"
                  : hasFilter
                    ? "清除筛选"
                    : error
                      ? "重新连接"
                      : "添加第一个下载"
              }}<Icon :name="hasFilter ? 'close' : 'arrow'" :size="16" />
            </button>
          </div>
          <footer class="list-footer">
            <span
              >共 {{ list.length }} 个任务<span v-if="hasFilter">
                · 显示 {{ visible.length }} 个</span
              ></span
            ><span class="sync-label"
              ><span class="connection-dot" :class="{ offline: !!error }"></span
              >{{
                error ? "等待重新连接" : refreshing ? "正在同步" : "实时同步"
              }}</span
            >
          </footer>
        </section>
      </div>
          <footer class="app-footer">
            <span>OrbitDown</span>
            <div>
              <button
                class="button speed-mode-toggle"
                :class="{ enabled: transfer.use_alt_speed_limits }"
                :disabled="busy"
                :aria-pressed="!!transfer.use_alt_speed_limits"
                aria-label="切换备用限速"
                title="切换备用限速"
                @click="toggleAlternative"
              >
                <Icon name="turtle" :size="20" />
                <span>备用限速</span>
                <span class="speed-mode-state">{{
                  transfer.use_alt_speed_limits ? "开启" : "关闭"
                }}</span>
                <span class="speed-mode-switch" aria-hidden="true"></span></button
              ><span class="version">qBittorrent {{ version || "—" }}</span>
            </div>
          </footer>
        </template>
        <SearchPanel
          v-else-if="page === 'search'"
          @close="page = 'tasks'"
          @added="refresh"
        />
        <RSSPanel
          v-else-if="page === 'rss'"
          @close="page = 'tasks'"
          @added="refresh"
        />
        <ToolsPanel v-else-if="page === 'tools'" @changed="refresh" />
        <SettingsPanel v-else-if="page === 'settings'" @saved="saved" />
        </main>
      </div>
    </div>
    <nav class="mobile-nav" aria-label="移动端导航">
      <button
        :class="{ active: page === 'tasks' }"
        :aria-pressed="page === 'tasks'"
        @click="page = 'tasks'"
      >
        <Icon name="grid" :size="21" /><span>任务</span></button
      ><button
        :class="{ active: page === 'search' }"
        :aria-pressed="page === 'search'"
        @click="page = 'search'"
      >
        <Icon name="search" :size="21" /><span>搜索</span></button
      ><button
        :class="{ active: page === 'rss' }"
        :aria-pressed="page === 'rss'"
        @click="page = 'rss'"
      >
        <Icon name="globe" :size="21" /><span>RSS</span></button
      ><button
        class="mobile-add"
        aria-label="添加下载"
        :aria-expanded="showAdd"
        aria-haspopup="dialog"
        @click="showAdd = true"
      >
        <Icon name="plus" :size="25" /></button
      ><button
        :class="{ active: page === 'tools' }"
        :aria-pressed="page === 'tools'"
        @click="page = 'tools'"
      >
        <Icon name="listFilter" :size="21" /><span>工具</span></button
      ><button
        :class="{ active: page === 'settings' }"
        :aria-pressed="page === 'settings'"
        @click="page = 'settings'"
      >
        <Icon name="settings" :size="21" /><span>设置</span>
      </button>
    </nav>
  </div>
  <AddTorrent
    v-if="showAdd"
    :categories="categories"
    :default-path="defaultPath"
    @close="showAdd = false"
    @added="added"
  />
  <DetailsPanel
    v-if="detail"
    :key="detail.hash"
    :torrent="detail"
    :busy="busy"
    @close="detailHash = ''"
    @action="action"
    @remove="remove"
    @changed="refresh"
    @notice="notify"
  />
  <ConnectionPanel
    v-if="showConnection && session"
    @close="showConnection = false"
    @saved="connectionSaved"
  />
  <ModalShell
    v-if="deleteHashes.length"
    title="删除下载任务？"
    @close="!busy && (deleteHashes = [])"
    ><p class="delete-description">
      将从 qBittorrent 中移除 {{ deleteHashes.length }} 个任务。
    </p>
    <div class="delete-names">
      <span v-for="name in deleteNames.slice(0, 3)" :key="name"
        ><Icon name="file" :size="16" />{{ name }}</span
      ><span v-if="deleteNames.length > 3" class="muted"
        >以及其他 {{ deleteNames.length - 3 }} 个任务</span
      >
    </div>
    <label class="checkbox-field delete-check"
      ><input v-model="deleteFiles" type="checkbox" :disabled="busy" /><span
        >同时删除已下载的文件<small
          >勾选后会从磁盘删除文件，无法撤销。</small
        ></span
      ></label
    >
    <footer class="modal-footer">
      <button class="button quiet" :disabled="busy" @click="deleteHashes = []">
        取消</button
      ><button
        class="button danger-solid"
        :disabled="busy"
        @click="confirmDelete"
      >
        <Icon
          :name="busy ? 'loading' : 'trash'"
          :class="{ spin: busy }"
          :size="17"
        />{{ busy ? "删除中…" : deleteFiles ? "删除任务及文件" : "仅删除任务" }}
      </button>
    </footer></ModalShell
  >
  <ModalShell v-if="showFilters" title="筛选任务" @close="showFilters = false"
    ><div class="mobile-status-options">
      <button
        v-for="status in statuses"
        :key="status.key"
        :class="{ active: filter.status === status.key }"
        @click="filter.status = status.key"
      >
        <Icon :name="status.icon" :size="18" /><span>{{ status.label }}</span
        ><b>{{ statusCounts[status.key] }}</b>
      </button>
    </div>
    <label class="field"
      >分类<CapsuleSelect
        v-model="filter.category"
        aria-label="分类"
        :options="[
          { value: '', label: '全部分类' },
          ...categories.map((category) => ({
            value: category,
            label: category,
          })),
          { value: '__none', label: '未分类' },
        ]" /></label
    ><label class="field"
      >标签<CapsuleSelect
        v-model="filter.tag"
        aria-label="标签"
        :options="[
          { value: '', label: '全部标签' },
          ...tags.map((tag) => ({ value: tag, label: tag })),
        ]"
    /></label>
    <footer class="modal-footer">
      <button class="button quiet" @click="resetFilters">重置筛选</button
      ><button class="button primary" @click="showFilters = false">
        查看 {{ visible.length }} 个任务<Icon name="arrow" :size="17" />
      </button></footer
  ></ModalShell>
  <ModalShell
    v-if="showAccount && session"
    title="账号与连接"
    @close="showAccount = false"
    ><div class="account-card">
      <span class="avatar large">{{
        session.user.name.charAt(0).toUpperCase()
      }}</span>
      <h3>{{ session.user.name }}</h3>
      <p>{{ session.user.username }}</p>
      <span class="account-provider"
        ><Icon name="shield" :size="16" />{{
          isDemo ? "演示账号" : "qBittorrent 账号登录"
        }}</span
      >
    </div>
    <div class="account-connection">
      <div class="account-connection-row">
        <span>实例</span>
        <strong class="selectable">{{ connection?.url || "—" }}</strong>
      </div>
      <div class="account-connection-row">
        <span>账号</span>
        <strong class="selectable">{{ connection?.username || "—" }}</strong>
      </div>
      <p class="account-connection-note">
        凭据仅保存在本机安全存储中，用于管理这个 qBittorrent 实例。
      </p>
    </div>
    <p class="field-hint account-hint">
      退出仅结束本次会话，已保存的连接保持不变，下次打开时自动登录。
    </p>
    <div class="account-actions">
      <button class="button quiet logout-button" :disabled="busy" @click="logout">
        <Icon name="logout" :size="18" />退出登录
      </button>
      <button
        class="button quiet logout-button account-danger"
        :disabled="busy"
        @click="clearSavedCredentials"
      >
        <Icon name="trash" :size="18" />清除本机保存的连接信息
      </button>
    </div></ModalShell
  >
  <div class="context-menu-host" aria-hidden="true">
    <TorrentOperations
      ref="contextMenu"
      :hashes="contextHashes"
      :torrent="contextTorrent"
      :menu-label="'操作任务'"
      @changed="refresh"
      @notice="notify"
      @remove="remove"
    />
  </div>
  <Transition name="toast"
    ><div v-if="toast" class="toast-message" role="status" aria-live="polite">
      <Icon name="info" :size="18" />{{ toast
      }}<button class="icon-button" aria-label="关闭提示" @click="toast = ''">
        <Icon name="close" :size="16" />
      </button></div
  ></Transition>
</template>
