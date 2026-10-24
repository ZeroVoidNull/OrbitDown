<script setup lang="ts">
import { ref, computed, useId } from "vue";
import Icon from "./Icon.vue";
import ModalShell from "./ModalShell.vue";
import CapsuleSelect from "./CapsuleSelect.vue";
import { scopedAPI } from "../lib/api";
import { addOptions, validTorrentLinks } from "../lib/add-torrent";
const api = scopedAPI();
const props = defineProps<{ categories: string[]; defaultPath: string }>();
const emit = defineEmits<{ close: []; added: [] }>();
const selectId = useId();
const categoryOptions = computed(() => [
  { value: "", label: "未分类" },
  ...props.categories.map((value) => ({ value, label: value })),
]);
const defaultOptions = [
  { value: "", label: "沿用默认设置" },
  { value: "true", label: "启用" },
  { value: "false", label: "禁用" },
];
const tab = ref<"magnet" | "file">("magnet"),
  urls = ref(""),
  files = ref<File[]>([]),
  savepath = ref(props.defaultPath),
  category = ref(""),
  advanced = ref(false),
  options = ref<Record<string, string>>({
    stopped: "",
    autoTMM: "",
    contentLayout: "",
    stopCondition: "",
    rename: "",
    tags: "",
    dlLimit: "",
    upLimit: "",
    ratioLimit: "",
    seedingTimeLimit: "",
    inactiveSeedingTimeLimit: "",
    skip_checking: "",
    sequentialDownload: "",
    firstLastPiecePrio: "",
    addToTopOfQueue: "",
  }),
  busy = ref(false),
  error = ref(""),
  dragging = ref(false);
const canSubmit = computed(() =>
  tab.value === "magnet"
    ? urls.value.trim().length > 0
    : files.value.length > 0,
);
function choose(list: FileList | null) {
  if (!list) return;
  const all = [...list];
  if (all.some((f) => !f.name.toLowerCase().endsWith(".torrent"))) {
    error.value = "请选择 .torrent 格式的种子文件";
    return;
  }
  if (all.reduce((sum, f) => sum + f.size, 0) > 31 * 1024 * 1024) {
    error.value = "种子文件总大小不能超过 31 MiB";
    return;
  }
  files.value = all;
  error.value = "";
}
function drop(event: DragEvent) {
  dragging.value = false;
  choose(event.dataTransfer?.files || null);
}
async function submit() {
  error.value = "";
  if (!canSubmit.value || busy.value) return;
  if (tab.value === "magnet" && !validTorrentLinks(urls.value)) {
    error.value = "请输入有效的磁力或 HTTP(S) 种子链接，每行一个";
    return;
  }
  busy.value = true;
  try {
    const data = new FormData();
    if (tab.value === "file")
      files.value.forEach((file) => data.append("torrents", file));
    else data.append("urls", urls.value.trim());
    if (savepath.value.trim()) data.append("savepath", savepath.value.trim());
    if (category.value) data.append("category", category.value);
    for (const [key, value] of Object.entries(addOptions(options.value)))
      data.append(key, value);
    const result = await api.post("/api/v2/torrents/add", data);
    if (typeof result === "string" && result.trim() === "Fails.")
      throw new Error("qBittorrent 未能添加任务，请检查种子或磁力链接");
    emit("added");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "添加失败，请重试";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <ModalShell
    title="添加下载"
    description="添加磁力或 HTTP(S) 链接，或上传 .torrent 文件。"
    @close="!busy && emit('close')"
  >
    <form @submit.prevent="submit">
      <div class="segmented add-tabs" role="tablist" aria-label="添加方式">
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'magnet'"
          :class="{ active: tab === 'magnet' }"
          @click="tab = 'magnet'"
        >
          <Icon name="link" :size="17" />种子链接</button
        ><button
          type="button"
          role="tab"
          :aria-selected="tab === 'file'"
          :class="{ active: tab === 'file' }"
          @click="tab = 'file'"
        >
          <Icon name="file" :size="17" />种子文件
        </button>
      </div>
      <label v-if="tab === 'magnet'" class="field"
        >种子链接<textarea
          v-model="urls"
          autofocus
          rows="4"
          placeholder="magnet:?xt=urn:btih:…&#10;或 https://…/download.torrent；每行一个"
          :disabled="busy"
          required
        />
      </label>
      <div
        v-else
        class="upload-zone"
        :class="{ dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="drop"
      >
        <Icon name="upload" :size="30" /><strong>{{
          files.length
            ? `已选择 ${files.length} 个种子文件`
            : "点击选择或拖入种子文件"
        }}</strong
        ><span class="muted">.torrent 格式 · 总大小不超过 31 MiB</span
        ><input
          type="file"
          accept=".torrent"
          multiple
          aria-label="选择种子文件"
          @change="choose(($event.target as HTMLInputElement).files)"
        />
        <p v-if="files.length" class="file-names">
          {{ files.map((f) => f.name).join("、") }}
        </p>
      </div>
      <label class="field"
        >保存位置<input
          v-model="savepath"
          placeholder="使用 qBittorrent 默认下载目录"
          :disabled="busy"
        /><small>路径位于运行 qBittorrent 的设备上。</small></label
      >
      <div class="field">
        <label :for="`${selectId}-category`">分类</label>
        <CapsuleSelect
          :id="`${selectId}-category`"
          v-model="category"
          :options="categoryOptions"
          :disabled="busy"
        />
      </div>
      <div class="field">
        <label :for="`${selectId}-stopped`">开始下载</label>
        <CapsuleSelect
          :id="`${selectId}-stopped`"
          v-model="options.stopped"
          :options="[
            { value: '', label: '沿用默认设置' },
            { value: 'false', label: '立即开始' },
            { value: 'true', label: '添加后停止' },
          ]"
          :disabled="busy"
        />
      </div>
      <button
        type="button"
        class="button quiet"
        :aria-expanded="advanced"
        @click="advanced = !advanced"
      >
        <Icon name="settings" :size="17" />{{
          advanced ? "收起高级选项" : "高级选项"
        }}
      </button>
      <div v-if="advanced" class="add-advanced">
        <label class="field"
          >任务名称<input
            v-model="options.rename"
            :disabled="busy"
            placeholder="保留原名称"
        /></label>
        <label class="field"
          >标签<input
            v-model="options.tags"
            :disabled="busy"
            placeholder="多个标签用逗号分隔"
        /></label>
        <div class="field">
          <label :for="`${selectId}-autoTMM`">种子管理模式</label>
          <CapsuleSelect
            :id="`${selectId}-autoTMM`"
            v-model="options.autoTMM"
            :options="[
              { value: '', label: '沿用默认设置' },
              { value: 'true', label: '自动' },
              { value: 'false', label: '手动' },
            ]"
            :disabled="busy"
          />
        </div>
        <div class="field">
          <label :for="`${selectId}-contentLayout`">内容布局</label>
          <CapsuleSelect
            :id="`${selectId}-contentLayout`"
            v-model="options.contentLayout"
            :options="[
              { value: '', label: '沿用默认设置' },
              { value: 'Original', label: '原始' },
              { value: 'Subfolder', label: '创建子目录' },
              { value: 'NoSubfolder', label: '不创建子目录' },
            ]"
            :disabled="busy"
          />
        </div>
        <div class="field">
          <label :for="`${selectId}-stopCondition`">停止条件</label>
          <CapsuleSelect
            :id="`${selectId}-stopCondition`"
            v-model="options.stopCondition"
            :options="[
              { value: '', label: '沿用默认设置' },
              { value: 'None', label: '无' },
              { value: 'MetadataReceived', label: '接收元数据后' },
              { value: 'FilesChecked', label: '文件检查后' },
            ]"
            :disabled="busy"
          />
        </div>
        <label
          v-for="[key, label] in [
            ['dlLimit', '下载限速（KiB/s）'],
            ['upLimit', '上传限速（KiB/s）'],
            ['ratioLimit', '分享率限制'],
            ['seedingTimeLimit', '做种时间限制（分钟）'],
            ['inactiveSeedingTimeLimit', '不活跃做种时间（分钟）'],
          ]"
          :key="key"
          class="field"
          >{{ label
          }}<input
            v-model="options[key!]"
            type="number"
            :min="
              key?.endsWith('Limit') && !['dlLimit', 'upLimit'].includes(key)
                ? -2
                : 0
            "
            :step="
              key === 'ratioLimit' || key === 'dlLimit' || key === 'upLimit'
                ? 'any'
                : 1
            "
            :disabled="busy"
            placeholder="沿用默认设置"
        /></label>
        <p class="muted">
          限速 0 为无限制；分享限制 -1 为无限制、-2 为全局设置。
        </p>
        <div
          v-for="[key, label] in [
            ['skip_checking', '跳过文件校验'],
            ['sequentialDownload', '顺序下载'],
            ['firstLastPiecePrio', '优先下载首尾分块'],
            ['addToTopOfQueue', '添加到队列顶部'],
          ]"
          :key="key"
          class="field"
        >
          <label :for="`${selectId}-${key}`">{{ label }}</label>
          <CapsuleSelect
            :id="`${selectId}-${key}`"
            v-model="options[key!]"
            :options="defaultOptions"
            :disabled="busy"
          />
        </div>
      </div>
      <p v-if="error" class="form-error" role="alert">
        <Icon name="alert" :size="17" />{{ error }}
      </p>
      <footer class="modal-footer">
        <button
          class="button quiet"
          type="button"
          :disabled="busy"
          @click="emit('close')"
        >
          取消</button
        ><button
          class="button primary"
          type="submit"
          :disabled="!canSubmit || busy"
        >
          <Icon
            :name="busy ? 'loading' : 'plus'"
            :class="{ spin: busy }"
            :size="18"
          />{{ busy ? "正在添加…" : "添加下载" }}
        </button>
      </footer>
    </form>
  </ModalShell>
</template>

<style scoped>
.add-advanced {
  margin-top: 18px;
}
.add-advanced .muted {
  font-size: 13px;
  line-height: 1.6;
}
</style>
