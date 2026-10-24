<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import Icon from "./Icon.vue";
import CapsuleSelect from "./CapsuleSelect.vue";
import TorrentExtras from "./TorrentExtras.vue";
import TorrentOperations from "./TorrentOperations.vue";
import ModalShell from "./ModalShell.vue";
import { scopedAPI } from "../lib/api";
import { bytes, speed, duration, date, percent } from "../lib/format";
import { statusOf } from "../lib/torrents";
import type {
  Torrent,
  TorrentFile,
  Tracker,
  TorrentProperties,
} from "../lib/types";
const api = scopedAPI();
const props = defineProps<{ torrent: Torrent; busy: boolean }>();
const emit = defineEmits<{
  close: [];
  action: [action: "start" | "stop", hashes: string[]];
  remove: [hashes: string[]];
  changed: [];
  notice: [message: string];
}>();
const tab = ref<"overview" | "files" | "trackers" | "advanced">("overview"),
  files = ref<TorrentFile[]>([]),
  trackers = ref<Tracker[]>([]),
  properties = ref<TorrentProperties | null>(null),
  loading = ref(true),
  error = ref(""),
  fileBusy = ref(false),
  copied = ref(false);
const status = computed(() => statusOf(props.torrent.state));
const priorityId = useId();
const priorityOptions = [
  { value: 0, label: "不下载" },
  { value: 1, label: "正常" },
  { value: 6, label: "高优先" },
  { value: 7, label: "最高" },
];
let controller: AbortController | undefined;
async function load() {
  controller?.abort();
  controller = new AbortController();
  const local = controller;
  loading.value = true;
  error.value = "";
  try {
    const hash = encodeURIComponent(props.torrent.hash);
    const [p, f, t] = await Promise.all([
      api.get<TorrentProperties>(
        "/api/v2/torrents/properties?hash=" + hash,
        local.signal,
      ),
      api.get<TorrentFile[]>(
        "/api/v2/torrents/files?hash=" + hash,
        local.signal,
      ),
      api.get<Tracker[]>(
        "/api/v2/torrents/trackers?hash=" + hash,
        local.signal,
      ),
    ]);
    if (local !== controller || local.signal.aborted) return;
    properties.value = p;
    files.value = f;
    trackers.value = t;
  } catch (e) {
    if (local === controller && !local.signal.aborted)
      error.value = e instanceof Error ? e.message : "读取任务详情失败";
  } finally {
    if (local === controller && !local.signal.aborted) loading.value = false;
  }
}
watch(
  () => props.torrent.hash,
  () => {
    properties.value = null;
    files.value = [];
    trackers.value = [];
    load();
  },
  { immediate: true },
);
onBeforeUnmount(() => controller?.abort());
async function priority(file: TorrentFile, value: string) {
  const next = Number(value);
  if (
    fileBusy.value ||
    props.busy ||
    !priorityOptions.some((option) => option.value === next)
  )
    return;
  fileBusy.value = true;
  try {
    await api.post("/api/v2/torrents/filePrio", {
      hash: props.torrent.hash,
      id: String(file.index),
      priority: String(next),
    });
    file.priority = next;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "设置优先级失败";
  } finally {
    fileBusy.value = false;
  }
}
async function copyMagnet() {
  try {
    const hash = props.torrent.hash,
      xt = hash.length === 64 ? "urn:btmh:1220" + hash : "urn:btih:" + hash;
    await navigator.clipboard.writeText(
      `magnet:?xt=${xt}&dn=${encodeURIComponent(props.torrent.name)}`,
    );
    copied.value = true;
  } catch {
    error.value = "浏览器无法访问剪贴板，请使用 HTTPS 访问";
  }
}
</script>
<template>
  <ModalShell title="任务详情" drawer wide @close="emit('close')">
    <div class="detail-intro">
      <span class="eyebrow">{{ torrent.category || "未分类" }}</span>
      <h3 class="selectable">{{ torrent.name }}</h3>
      <div class="detail-status">
        <span class="status" :class="status.tone"
          ><i></i>{{ status.label }}</span
        ><span
          >{{ percent(torrent.progress) }} · {{ bytes(torrent.size) }}</span
        >
      </div>
      <div class="progress-track detail-track">
        <span
          :class="status.tone"
          :style="{ width: percent(torrent.progress) }"
        ></span>
      </div>
      <div class="detail-action-bar">
        <TorrentOperations
          :hashes="[torrent.hash]"
          :torrent="torrent"
          label="更多操作"
          @changed="emit('changed')"
          @notice="emit('notice', $event)"
          @remove="emit('remove', $event)"
        />
        <button
          class="button primary"
          :disabled="busy"
          @click="
            emit('action', status.key === 'paused' ? 'start' : 'stop', [
              torrent.hash,
            ])
          "
        >
          <Icon
            :name="status.key === 'paused' ? 'play' : 'pause'"
            :size="17"
          />{{ status.key === "paused" ? "继续下载" : "暂停任务" }}</button
        ><button
          class="icon-button quiet"
          :aria-label="copied ? '磁力链接已复制' : '复制磁力链接'"
          :title="copied ? '已复制' : '复制磁力链接'"
          @click="copyMagnet"
        >
          <Icon :name="copied ? 'check' : 'link'" :size="18" /></button
        ><button
          class="icon-button quiet danger"
          aria-label="删除此任务"
          @click="emit('remove', [torrent.hash])"
        >
          <Icon name="trash" :size="18" />
        </button>
      </div>
    </div>
    <div class="detail-tabs" role="tablist" aria-label="任务详情视图">
      <button
        v-for="(label, key) in {
          overview: '概览',
          files: '文件',
          trackers: 'Tracker',
          advanced: '连接与文件',
        }"
        :key="key"
        role="tab"
        :aria-selected="tab === key"
        :class="{ active: tab === key }"
        @click="tab = key"
      >
        {{ label
        }}<span v-if="key === 'files' && files.length">{{ files.length }}</span>
      </button>
    </div>
    <p v-if="error" class="form-error" role="alert">
      {{ error }}<button class="text-button" @click="load">重试</button>
    </p>
    <div v-if="loading" class="loading-state">
      <Icon name="loading" class="spin" />正在读取详情…
    </div>
    <template v-else-if="tab === 'overview'">
      <div class="detail-speeds">
        <div>
          <span><Icon name="down" :size="16" />下载速度</span
          ><strong>{{ speed(torrent.dlspeed) }}</strong>
        </div>
        <div>
          <span><Icon name="up" :size="16" />上传速度</span
          ><strong>{{ speed(torrent.upspeed) }}</strong>
        </div>
      </div>
      <dl class="detail-info">
        <div>
          <dt>已下载</dt>
          <dd>{{ bytes(torrent.downloaded) }}</dd>
        </div>
        <div>
          <dt>已上传</dt>
          <dd>{{ bytes(torrent.uploaded) }}</dd>
        </div>
        <div>
          <dt>分享率</dt>
          <dd>{{ torrent.ratio.toFixed(2) }}</dd>
        </div>
        <div>
          <dt>剩余时间</dt>
          <dd>
            {{ torrent.progress >= 1 ? "已完成" : duration(torrent.eta) }}
          </dd>
        </div>
        <div>
          <dt>种子 / 用户</dt>
          <dd>{{ torrent.num_seeds }} / {{ torrent.num_leechs }}</dd>
        </div>
        <div>
          <dt>添加时间</dt>
          <dd>{{ date(torrent.added_on) }}</dd>
        </div>
        <div>
          <dt>完成时间</dt>
          <dd>{{ date(torrent.completion_on) }}</dd>
        </div>
        <div>
          <dt>标签</dt>
          <dd>{{ torrent.tags || "无" }}</dd>
        </div>
      </dl>
      <div class="detail-block">
        <h4><Icon name="folder" :size="17" />保存位置</h4>
        <p class="mono">
          {{ properties?.save_path || torrent.save_path || "—" }}
        </p>
      </div>
      <div class="detail-block">
        <h4>Info hash</h4>
        <p class="mono">{{ torrent.hash }}</p>
      </div>
      <div v-if="properties?.comment" class="detail-block">
        <h4>备注</h4>
        <p>{{ properties.comment }}</p>
      </div>
    </template>
    <div v-else-if="tab === 'files'" class="file-list">
      <p class="muted detail-help">设置文件优先级，决定下载哪些内容。</p>
      <div v-for="file in files" :key="file.index" class="detail-file">
        <Icon name="file" :size="22" />
        <div>
          <strong>{{ file.name }}</strong
          ><span>{{ bytes(file.size) }} · {{ percent(file.progress) }}</span>
        </div>
        <div class="file-priority">
          <label :for="`${priorityId}-${file.index}`" class="sr-only"
            >{{ file.name }} 下载优先级</label
          >
          <CapsuleSelect
            :id="`${priorityId}-${file.index}`"
            :model-value="String(file.priority)"
            :options="priorityOptions"
            :disabled="fileBusy || busy"
            @update:model-value="priority(file, $event)"
          />
        </div>
      </div>
      <div v-if="!files.length" class="small-empty">尚未获取文件信息</div>
    </div>
    <TorrentExtras v-else-if="tab === 'advanced'" :hash="torrent.hash" />
    <div v-else class="tracker-list">
      <div v-for="tracker in trackers" :key="tracker.url" class="tracker-item">
        <div>
          <Icon name="globe" :size="18" /><strong>{{ tracker.url }}</strong>
        </div>
        <p>
          <span
            class="status"
            :class="
              tracker.status === 2
                ? 'green'
                : tracker.status === 4
                  ? 'red'
                  : 'gray'
            "
            ><i></i
            >{{
              tracker.status === 2
                ? "工作正常"
                : tracker.status === 4
                  ? "连接失败"
                  : "等待连接"
            }}</span
          ><span
            >{{ tracker.num_peers >= 0 ? tracker.num_peers : 0 }} 个用户</span
          >
        </p>
        <p v-if="tracker.msg" class="muted">{{ tracker.msg }}</p>
      </div>
      <div v-if="!trackers.length" class="small-empty">暂无 Tracker</div>
    </div>
  </ModalShell>
</template>
