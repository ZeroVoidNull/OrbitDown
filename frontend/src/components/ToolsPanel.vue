<script setup lang="ts">
const connectionNames: Record<string, string> = {
  connected: "已连接",
  firewalled: "受防火墙限制",
  disconnected: "未连接",
};
const buildNames: Record<string, string> = {
  qt: "Qt",
  libtorrent: "libtorrent",
  boost: "Boost",
  openssl: "OpenSSL",
  bitness: "位数",
};
import { computed, onMounted, ref, useId, watch } from "vue";
import ModalShell from "./ModalShell.vue";
import CapsuleSelect from "./CapsuleSelect.vue";
import Icon from "./Icon.vue";
import { scopedAPI } from "../lib/api";
import { bytes, date, speed } from "../lib/format";
import { peerList, type MainLog, type PeerLog } from "../lib/native-tools";
import type { Transfer } from "../lib/types";
import "../styles/native-tools.css";
const api = scopedAPI();
const selectorId = useId();
const emit = defineEmits<{ close: []; changed: [] }>();
const tab = ref("labels"),
  busy = ref(false),
  loading = ref(false),
  error = ref(""),
  message = ref("");
const categories = ref<Record<string, { name: string; savePath: string }>>({}),
  tags = ref<string[]>([]),
  categoryName = ref(""),
  categoryPath = ref(""),
  editingCategory = ref(false),
  newTags = ref(""),
  editingTag = ref(""),
  renamedTag = ref("");
const logs = ref<MainLog[]>([]),
  peers = ref<PeerLog[]>([]),
  logType = ref("main"),
  filter = ref(""),
  levels = ref({ normal: true, info: true, warning: true, critical: true }),
  blockedOnly = ref(false),
  banAddresses = ref("");
const transfer = ref<Partial<Transfer>>({}),
  version = ref(""),
  apiVersion = ref(""),
  build = ref<Record<string, string | number>>({});
const filteredLogs = computed(() =>
  logs.value
    .filter((log) =>
      log.message.toLowerCase().includes(filter.value.toLowerCase()),
    )
    .slice()
    .reverse(),
);
const filteredPeers = computed(() =>
  peers.value
    .filter(
      (log) =>
        (!blockedOnly.value || log.blocked) &&
        `${log.ip} ${log.reason}`
          .toLowerCase()
          .includes(filter.value.toLowerCase()),
    )
    .slice()
    .reverse(),
);
const levelNames: Record<number, string> = {
  1: "常规",
  2: "信息",
  4: "警告",
  8: "错误",
};
async function loadLabels() {
  const [allCategories, allTags] = await Promise.all([
    api.get<typeof categories.value>("/api/v2/torrents/categories"),
    api.get<string[]>("/api/v2/torrents/tags"),
  ]);
  categories.value = allCategories;
  tags.value = allTags;
}
async function loadLogs() {
  if (logType.value === "main")
    logs.value = await api.get<MainLog[]>(
      `/api/v2/log/main?${new URLSearchParams({ ...Object.fromEntries(Object.entries(levels.value).map(([name, value]) => [name, String(value)])), last_known_id: "-1" })}`,
    );
  else
    peers.value = await api.get<PeerLog[]>(
      "/api/v2/log/peers?last_known_id=-1",
    );
}
async function loadStats() {
  const [stats, appVersion, webapi, info] = await Promise.all([
    api.get<Partial<Transfer>>("/api/v2/transfer/info"),
    api.get<string>("/api/v2/app/version"),
    api.get<string>("/api/v2/app/webapiVersion"),
    api.get<typeof build.value>("/api/v2/app/buildInfo"),
  ]);
  transfer.value = stats;
  version.value = appVersion;
  apiVersion.value = webapi;
  build.value = info;
}
async function load() {
  if (busy.value) return;
  loading.value = true;
  error.value = "";
  try {
    await (tab.value === "labels"
      ? loadLabels()
      : tab.value === "logs"
        ? loadLogs()
        : loadStats());
  } catch (e) {
    error.value = e instanceof Error ? e.message : "读取失败";
  } finally {
    loading.value = false;
  }
}
async function run(
  action: () => Promise<unknown>,
  success: string,
  changed = false,
) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await action();
    message.value = success;
    if (changed) emit("changed");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败";
  } finally {
    busy.value = false;
  }
}
function editCategory(name = "") {
  categoryName.value = name;
  categoryPath.value = categories.value[name]?.savePath || "";
  editingCategory.value = Boolean(name);
}
async function saveCategory() {
  await run(
    async () => {
      if (!categoryName.value.trim()) throw new Error("请输入分类名称");
      if (!editingCategory.value && categories.value[categoryName.value.trim()])
        throw new Error("分类已存在");
      await api.post(
        `/api/v2/torrents/${editingCategory.value ? "editCategory" : "createCategory"}`,
        {
          category: categoryName.value.trim(),
          savePath: categoryPath.value.trim(),
        },
      );
      await loadLabels();
      editCategory();
    },
    "分类已保存",
    true,
  );
}
function removeCategory(name: string) {
  if (!window.confirm(`删除分类“${name}”？下载任务将取消该分类。`)) return;
  void run(
    async () => {
      await api.post("/api/v2/torrents/removeCategories", { categories: name });
      await loadLabels();
      if (categoryName.value === name) editCategory();
    },
    "分类已删除",
    true,
  );
}
function removeTag(tag: string) {
  if (!window.confirm(`删除标签“${tag}”？下载任务将移除此标签。`)) return;
  void run(
    async () => {
      await api.post("/api/v2/torrents/deleteTags", { tags: tag });
      await loadLabels();
    },
    "标签已删除",
    true,
  );
}
async function renameTag() {
  const oldName = editingTag.value,
    newName = renamedTag.value.trim();
  if (!oldName || !newName || oldName === newName) return;
  await run(
    async () => {
      if (newName.includes(",")) throw new Error("标签名称不能包含逗号");
      const torrents = await api.get<{ hash: string }[]>(
        `/api/v2/torrents/info?${new URLSearchParams({ tag: oldName })}`,
      );
      await api.post("/api/v2/torrents/createTags", { tags: newName });
      if (torrents.length) {
        const hashes = torrents.map((torrent) => torrent.hash).join("|");
        await api.post("/api/v2/torrents/addTags", { hashes, tags: newName });
        await api.post("/api/v2/torrents/removeTags", {
          hashes,
          tags: oldName,
        });
      }
      await api.post("/api/v2/torrents/deleteTags", { tags: oldName });
      editingTag.value = "";
      renamedTag.value = "";
      await loadLabels();
    },
    "标签已重命名",
    true,
  );
}
async function createTags() {
  await run(
    async () => {
      await api.post("/api/v2/torrents/createTags", {
        tags: newTags.value.trim(),
      });
      newTags.value = "";
      await loadLabels();
    },
    "标签已创建",
    true,
  );
}
async function ban() {
  let peersToBan: string;
  try {
    peersToBan = peerList(banAddresses.value);
  } catch (e) {
    error.value = (e as Error).message;
    return;
  }
  if (!window.confirm(`封禁以下连接？\n${peersToBan.split("|").join("\n")}`))
    return;
  await run(
    async () => {
      await api.post("/api/v2/transfer/banPeers", { peers: peersToBan });
      banAddresses.value = "";
      if (tab.value === "logs") await loadLogs();
    },
    "连接已封禁",
    true,
  );
}
async function shutdown() {
  if (
    !window.confirm(
      "关闭 qBittorrent 将中断所有下载和做种，并使服务无法连接。需要在主机上重新启动。确认关闭？",
    )
  )
    return;
  await run(
    () => api.post("/api/v2/app/shutdown", { confirm: "true" }),
    "已发送关闭请求，需要在主机上重新启动 qBittorrent。",
    true,
  );
}
watch(tab, load);
watch(logType, () => {
  if (tab.value === "logs") void load();
});
onMounted(load);
</script>
<template>
  <ModalShell title="管理工具" wide embedded @close="!busy && emit('close')"
    ><div class="native-tools">
      <nav class="tool-tabs" aria-label="工具页面">
        <button :aria-selected="tab === 'labels'" @click="tab = 'labels'">
          分类与标签</button
        ><button :aria-selected="tab === 'logs'" @click="tab = 'logs'">
          运行日志</button
        ><button :aria-selected="tab === 'stats'" @click="tab = 'stats'">
          统计与服务
        </button>
      </nav>
      <p v-if="error" class="tool-message error" role="alert">{{ error }}</p>
      <p v-if="message" class="tool-message" role="status">{{ message }}</p>
      <p v-if="loading" class="tool-muted" role="status">正在读取…</p>
      <fieldset
        :disabled="busy || loading"
        style="border: 0; padding: 0; margin: 0; min-width: 0"
      >
        <div class="tool-actions">
          <button class="button" @click="load">
            <Icon name="refresh" />刷新
          </button>
        </div>
        <template v-if="tab === 'labels'"
          ><section>
            <h3>分类</h3>
            <form @submit.prevent="saveCategory">
              <div class="tool-grid">
                <label class="field"
                  >{{ editingCategory ? "分类名称" : "新分类名称"
                  }}<input
                    v-model="categoryName"
                    required
                    :readonly="editingCategory" /></label
                ><label class="field"
                  >保存目录<input
                    v-model="categoryPath"
                    placeholder="使用默认目录"
                /></label>
              </div>
              <div class="tool-actions">
                <button class="button primary" type="submit">
                  {{ editingCategory ? "保存目录" : "创建分类" }}</button
                ><button
                  v-if="editingCategory"
                  class="button"
                  type="button"
                  @click="editCategory()"
                >
                  取消编辑
                </button>
              </div>
            </form>
            <article
              v-for="(item, name) in categories"
              :key="name"
              class="tool-card entity-card"
            >
              <div class="entity-info">
                <h3>{{ item.name || name }}</h3>
                <p class="tool-muted">{{ item.savePath || "使用默认目录" }}</p>
              </div>
              <div class="tool-actions">
                <button class="button" @click="editCategory(String(name))">
                  <Icon name="edit" :size="16" />编辑目录</button
                ><button
                  class="button danger"
                  @click="removeCategory(String(name))"
                >
                  <Icon name="trash" :size="16" />删除
                </button>
              </div>
            </article>
            <p v-if="!Object.keys(categories).length" class="tool-muted">
              暂无分类
            </p>
          </section>
          <section class="tool-section">
            <h3>标签</h3>
            <form class="tool-actions" @submit.prevent="createTags">
              <label class="field"
                >新标签<input
                  v-model="newTags"
                  required
                  placeholder="多个标签以逗号分隔" /></label
              ><button class="button primary" type="submit">创建标签</button>
            </form>
            <div v-for="tag in tags" :key="tag" class="tool-card entity-card">
              <div class="entity-info">
                <h3>{{ tag }}</h3>
              </div>
              <div class="tool-actions">
                <button
                  class="button"
                  @click="
                    editingTag = tag;
                    renamedTag = tag;
                  "
                >
                  <Icon name="edit" :size="16" />重命名</button
                ><button class="button danger" @click="removeTag(tag)">
                  <Icon name="trash" :size="16" />删除
                </button>
              </div>
            </div>
            <p v-if="!tags.length" class="tool-muted">暂无标签</p>
            <form v-if="editingTag" @submit.prevent="renameTag">
              <label class="field"
                >重命名“{{ editingTag }}”<input v-model="renamedTag" required
              /></label>
              <div class="tool-actions">
                <button
                  class="button primary"
                  type="submit"
                  :disabled="
                    !renamedTag.trim() || renamedTag.trim() === editingTag
                  "
                >
                  保存标签</button
                ><button class="button" type="button" @click="editingTag = ''">
                  取消
                </button>
              </div>
            </form>
          </section></template
        >
        <template v-else-if="tab === 'logs'"
          ><div class="tool-grid">
            <div class="field">
              <label :for="`${selectorId}-log-type`">日志类型</label>
              <CapsuleSelect
                :id="`${selectorId}-log-type`"
                v-model="logType"
                :options="[
                  { value: 'main', label: '运行日志' },
                  { value: 'peers', label: '连接日志' },
                ]"
                :disabled="busy || loading"
                aria-label="日志类型"
              />
            </div>
            <label class="field"
              >筛选<input
                v-model="filter"
                type="search"
                placeholder="内容、IP 或原因"
            /></label>
          </div>
          <div v-if="logType === 'main'" class="tool-actions">
            <label
              v-for="(enabled, level) in levels"
              :key="level"
              class="checkbox-field"
              ><input
                v-model="levels[level]"
                type="checkbox"
                @change="load"
              />{{
                {
                  normal: "常规",
                  info: "信息",
                  warning: "警告",
                  critical: "错误",
                }[level]
              }}</label
            >
          </div>
          <label v-else class="checkbox-field"
            ><input
              v-model="blockedOnly"
              type="checkbox"
            />仅显示被封禁连接</label
          >
          <div v-if="logType === 'main'">
            <article
              v-for="log in filteredLogs"
              :key="log.id"
              class="tool-card"
            >
              <div class="tool-meta">
                <span>{{ date(log.timestamp) }}</span
                ><span>{{ levelNames[log.type] || log.type }}</span>
              </div>
              <p>{{ log.message }}</p>
            </article>
            <p v-if="!filteredLogs.length" class="tool-muted">
              暂无符合条件的日志
            </p>
          </div>
          <div v-else>
            <article
              v-for="peer in filteredPeers"
              :key="peer.id"
              class="tool-card"
            >
              <h3>{{ peer.ip }}</h3>
              <div class="tool-meta">
                <span>{{ date(peer.timestamp) }}</span
                ><span>{{ peer.blocked ? "已封禁" : "已连接" }}</span>
              </div>
              <p>{{ peer.reason }}</p>
            </article>
            <p v-if="!filteredPeers.length" class="tool-muted">
              暂无符合条件的连接日志
            </p>
          </div></template
        >
        <template v-else
          ><dl class="tool-stats">
            <div>
              <dt>下载速度</dt>
              <dd>{{ speed(transfer.dl_info_speed || 0) }}</dd>
            </div>
            <div>
              <dt>上传速度</dt>
              <dd>{{ speed(transfer.up_info_speed || 0) }}</dd>
            </div>
            <div>
              <dt>本次下载</dt>
              <dd>{{ bytes(transfer.dl_info_data || 0) }}</dd>
            </div>
            <div>
              <dt>本次上传</dt>
              <dd>{{ bytes(transfer.up_info_data || 0) }}</dd>
            </div>
            <div>
              <dt>下载限制</dt>
              <dd>
                {{
                  transfer.dl_rate_limit
                    ? speed(transfer.dl_rate_limit)
                    : "不限速"
                }}
              </dd>
            </div>
            <div>
              <dt>上传限制</dt>
              <dd>
                {{
                  transfer.up_rate_limit
                    ? speed(transfer.up_rate_limit)
                    : "不限速"
                }}
              </dd>
            </div>
            <div>
              <dt>连接状态</dt>
              <dd>
                {{
                  connectionNames[transfer.connection_status || ""] || "未知"
                }}
              </dd>
            </div>
            <div>
              <dt>DHT 节点</dt>
              <dd>{{ transfer.dht_nodes ?? "—" }}</dd>
            </div>
          </dl>
          <section class="tool-section">
            <h3>版本与构建</h3>
            <dl class="tool-stats">
              <div>
                <dt>qBittorrent</dt>
                <dd>{{ version || "—" }}</dd>
              </div>
              <div>
                <dt>Web API</dt>
                <dd>{{ apiVersion || "—" }}</dd>
              </div>
              <div v-for="(value, name) in build" :key="name">
                <dt>{{ buildNames[name] || name }}</dt>
                <dd>{{ value }}</dd>
              </div>
            </dl>
          </section>
          <section class="tool-section">
            <h3>关闭服务</h3>
            <p class="tool-muted">关闭后需要在主机上重新启动 qBittorrent。</p>
            <button class="button danger" @click="shutdown">
              关闭 qBittorrent
            </button>
          </section></template
        >
        <section v-if="tab !== 'labels'" class="tool-section">
          <h3>封禁连接</h3>
          <form @submit.prevent="ban">
            <label class="field"
              >连接地址<textarea
                v-model="banAddresses"
                required
                placeholder="192.0.2.10:6881&#10;[2001:db8::10]:6881"
              /><small>每行一个 IP:端口，IPv6 地址使用方括号。</small></label
            ><button class="button danger" type="submit">封禁</button>
          </form>
        </section>
      </fieldset>
    </div></ModalShell
  >
</template>
