<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import Icon from "./Icon.vue";
import CapsuleSelect from "./CapsuleSelect.vue";
import { scopedAPI } from "../lib/api";
import type { Torrent } from "../lib/types";
import {
  rateLimit,
  shareLimits,
  type NativeTorrent,
} from "../lib/torrent-operations";
import "../styles/task-menu.css";
const api = scopedAPI();
const props = defineProps<{
  hashes: string[];
  torrent?: Torrent;
  label?: string;
  menuLabel?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  changed: [];
  notice: [message: string];
  remove: [hashes: string[]];
}>();
type View =
  | "main"
  | "queue"
  | "download"
  | "limits"
  | "organize"
  | "files"
  | "downloadLimit"
  | "uploadLimit"
  | "share"
  | "location"
  | "category"
  | "tags"
  | "rename";
type Item = {
  label: string;
  view?: View;
  endpoint?: string;
  data?: Record<string, string>;
  icon?:
    | "play"
    | "pause"
    | "sort"
    | "download"
    | "turtle"
    | "tag"
    | "folder"
    | "trash";
  danger?: boolean;
  special?: "remove" | "export";
};
const trigger = ref<HTMLButtonElement>(),
  popup = ref<HTMLElement>(),
  id = useId(),
  opened = ref(false),
  view = ref<View>("main"),
  busy = ref(false),
  loading = ref(false),
  ready = ref(false),
  error = ref(""),
  targets = ref<string[]>([]),
  current = ref<NativeTorrent>(),
  position = ref({ left: "0px", top: "0px" });
const categories = ref<Record<string, { name: string; savePath: string }>>({}),
  tags = ref<string[]>([]),
  value = ref(""),
  ratio = ref("-2"),
  seeding = ref("-2"),
  inactive = ref("-2"),
  tagAction = ref("add");
let controller: AbortController | undefined,
  revision = 0;
const single = computed(() => targets.value.length === 1),
  hashes = computed(() => targets.value.join("|"));
const titles: Record<View, string> = {
  main: "任务操作",
  queue: "队列与校验",
  download: "下载方式",
  limits: "限速与分享",
  organize: "分类与标签",
  files: "文件",
  downloadLimit: "下载限速",
  uploadLimit: "上传限速",
  share: "分享限制",
  location: "保存位置",
  category: "设置分类",
  tags: "编辑标签",
  rename: "重命名",
};
const formViews: View[] = [
  "downloadLimit",
  "uploadLimit",
  "share",
  "location",
  "category",
  "tags",
  "rename",
];
const isForm = computed(() => formViews.includes(view.value));
const items = computed<Item[]>(() => {
  switch (view.value) {
    case "main":
      return [
        { label: "继续下载", endpoint: "start", icon: "play" },
        { label: "停止下载", endpoint: "stop", icon: "pause" },
        {
          label: "强制启动",
          endpoint: "setForceStart",
          data: { value: "true" },
          icon: "play",
        },
        { label: "队列与校验", view: "queue", icon: "sort" },
        { label: "下载方式", view: "download", icon: "download" },
        { label: "限速与分享", view: "limits", icon: "turtle" },
        { label: "分类与标签", view: "organize", icon: "tag" },
        { label: "文件", view: "files", icon: "folder" },
        { label: "删除任务…", special: "remove", icon: "trash", danger: true },
      ];
    case "queue":
      return [
        { label: "移到队列顶部", endpoint: "topPrio" },
        { label: "上移", endpoint: "increasePrio" },
        { label: "下移", endpoint: "decreasePrio" },
        { label: "移到队列底部", endpoint: "bottomPrio" },
        {
          label: "恢复正常队列",
          endpoint: "setForceStart",
          data: { value: "false" },
        },
        { label: "重新校验", endpoint: "recheck" },
        { label: "重新汇报 Tracker", endpoint: "reannounce" },
      ];
    case "download":
      return [
        {
          label: single.value
            ? current.value?.seq_dl === undefined
              ? "切换顺序下载"
              : current.value.seq_dl
                ? "关闭顺序下载"
                : "启用顺序下载"
            : "切换每个任务的顺序下载",
          endpoint: "toggleSequentialDownload",
        },
        {
          label: single.value
            ? current.value?.f_l_piece_prio === undefined
              ? "切换首尾分块优先"
              : current.value.f_l_piece_prio
                ? "关闭首尾分块优先"
                : "启用首尾分块优先"
            : "切换每个任务的首尾优先",
          endpoint: "toggleFirstLastPiecePrio",
        },
        {
          label: "启用超级做种",
          endpoint: "setSuperSeeding",
          data: { value: "true" },
        },
        {
          label: "关闭超级做种",
          endpoint: "setSuperSeeding",
          data: { value: "false" },
        },
        {
          label: "自动任务管理",
          endpoint: "setAutoManagement",
          data: { enable: "true" },
        },
        {
          label: "手动任务管理",
          endpoint: "setAutoManagement",
          data: { enable: "false" },
        },
      ];
    case "limits":
      return [
        { label: "下载限速…", view: "downloadLimit" },
        { label: "上传限速…", view: "uploadLimit" },
        { label: "分享限制…", view: "share" },
      ];
    case "organize":
      return [
        { label: "设置分类…", view: "category" },
        { label: "编辑标签…", view: "tags" },
      ];
    case "files":
      return [
        { label: "移动保存位置…", view: "location" },
        ...(single.value
          ? [
              { label: "重命名…", view: "rename" } as Item,
              { label: "导出种子文件", special: "export" } as Item,
            ]
          : []),
      ];
    default:
      return [];
  }
});
function place() {
  if (anchor) {
    // 右键呼出：按指针坐标定位并夹在视口内。
    const p = popup.value?.getBoundingClientRect();
    const width = p?.width || 260,
      height = p?.height || 320;
    position.value = {
      left:
        Math.max(
          12,
          Math.min(anchor.x, window.innerWidth - width - 12),
        ) + "px",
      top:
        Math.max(
          12,
          Math.min(anchor.y + 7, window.innerHeight - height - 12),
        ) + "px",
    };
    return;
  }
  if (!trigger.value || !popup.value) return;
  const b = trigger.value.getBoundingClientRect(),
    p = popup.value.getBoundingClientRect();
  position.value = {
    left:
      Math.max(12, Math.min(b.right - p.width, innerWidth - p.width - 12)) +
      "px",
    top:
      Math.max(12, Math.min(b.bottom + 7, innerHeight - p.height - 12)) + "px",
  };
}
async function focusFirst() {
  await nextTick();
  if (!opened.value) return;
  place();
  popup.value
    ?.querySelector<HTMLElement>(
      isForm.value ? "input,select,[role=combobox]" : "[data-menu-item]",
    )
    ?.focus({ preventScroll: true });
}
function close(restore = true) {
  if (popup.value?.matches(":popover-open")) popup.value.hidePopover();
  opened.value = false;
  anchor = null;
  controller?.abort();
  revision++;
  if (restore) trigger.value?.focus({ preventScroll: true });
}
async function load() {
  controller?.abort();
  controller = new AbortController();
  const token = ++revision,
    signal = controller.signal;
  loading.value = true;
  ready.value = false;
  error.value = "";
  try {
    const [tasks, catalog, labels] = await Promise.all([
      api.get<NativeTorrent[]>(
        "/api/v2/torrents/info?hashes=" + encodeURIComponent(hashes.value),
        signal,
      ),
      api.get<Record<string, { name: string; savePath: string }>>(
        "/api/v2/torrents/categories",
        signal,
      ),
      api.get<string[]>("/api/v2/torrents/tags", signal),
    ]);
    if (token !== revision || signal.aborted) return;
    current.value = single.value ? tasks[0] : undefined;
    categories.value = catalog;
    tags.value = labels;
    ready.value = true;
    if (isForm.value) setFormValues(view.value);
  } catch (e) {
    if (token === revision && !signal.aborted)
      error.value = e instanceof Error ? e.message : "读取任务设置失败";
  } finally {
    if (token === revision && !signal.aborted) {
      loading.value = false;
      await nextTick();
      if (isForm.value) await focusFirst();
      else place();
    }
  }
}
let anchor: { x: number; y: number } | null = null;

// at 传入时按坐标（右键呼出）定位，否则按触发按钮定位。
async function open(at?: { x: number; y: number }) {
  if (props.disabled || !props.hashes.length) return;
  anchor = at || null;
  if (opened.value && !at) {
    close();
    return;
  }
  targets.value = [...new Set(props.hashes)];
  current.value = props.torrent ? { ...props.torrent } : undefined;
  view.value = "main";
  error.value = "";
  opened.value = true;
  popup.value?.showPopover();
  await focusFirst();
  void load();
  window.addEventListener("resize", place);
}
function toggle(event: Event) {
  if ((event as Event & { newState: string }).newState === "closed") {
    opened.value = false;
    controller?.abort();
    revision++;
    window.removeEventListener("resize", place);
  }
}
watch(
  () => props.hashes.join("|"),
  () => close(false),
);
onBeforeUnmount(() => {
  controller?.abort();
  window.removeEventListener("resize", place);
});
function setFormValues(next: View) {
  value.value =
    next === "location"
      ? current.value?.save_path || ""
      : next === "category"
        ? current.value?.category || ""
        : next === "rename"
          ? current.value?.name || ""
          : next === "downloadLimit" && single.value
            ? String(Math.max(0, current.value?.dl_limit || 0) / 1024)
            : next === "uploadLimit" && single.value
              ? String(Math.max(0, current.value?.up_limit || 0) / 1024)
              : "";
  ratio.value = String(current.value?.ratio_limit ?? -2);
  seeding.value = String(current.value?.seeding_time_limit ?? -2);
  inactive.value = String(current.value?.inactive_seeding_time_limit ?? -2);
  tagAction.value = "add";
}
async function navigate(next: View) {
  view.value = next;
  error.value = "";
  setFormValues(next);
  if (popup.value) popup.value.scrollTop = 0;
  await focusFirst();
}
function back() {
  void navigate(
    ["downloadLimit", "uploadLimit", "share"].includes(view.value)
      ? "limits"
      : ["category", "tags"].includes(view.value)
        ? "organize"
        : ["location", "rename"].includes(view.value)
          ? "files"
          : "main",
  );
}
async function post(
  endpoint: string,
  data: Record<string, string>,
  message: string,
  scoped = true,
) {
  if (busy.value) return;
  const snapshot = [...targets.value];
  busy.value = true;
  error.value = "";
  try {
    await api.post("/api/v2/torrents/" + endpoint, {
      ...(scoped ? { hashes: snapshot.join("|") } : {}),
      ...data,
    });
    emit("changed");
    close();
    emit("notice", message);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败";
    await nextTick();
    place();
  } finally {
    busy.value = false;
  }
}
async function pick(item: Item) {
  if (item.view) {
    await navigate(item.view);
    return;
  }
  if (item.special === "remove") {
    const snapshot = [...targets.value];
    close();
    emit("remove", snapshot);
    return;
  }
  if (item.special === "export") {
    busy.value = true;
    try {
      await api.download(
        "/api/v2/torrents/export?hash=" + encodeURIComponent(targets.value[0]!),
        (current.value?.name || targets.value[0]) + ".torrent",
      );
      close();
      emit("notice", "种子文件已导出");
    } catch (e) {
      error.value = e instanceof Error ? e.message : "导出失败";
    } finally {
      busy.value = false;
    }
    return;
  }
  if (item.endpoint)
    await post(item.endpoint, item.data || {}, "已执行：" + item.label);
}
async function submit() {
  if (!ready.value || busy.value) return;
  try {
    switch (view.value) {
      case "downloadLimit":
      case "uploadLimit":
        await post(
          view.value === "downloadLimit"
            ? "setDownloadLimit"
            : "setUploadLimit",
          { limit: rateLimit(value.value) },
          "任务限速已保存",
        );
        break;
      case "share":
        await post(
          "setShareLimits",
          shareLimits(ratio.value, seeding.value, inactive.value),
          "分享限制已保存",
        );
        break;
      case "location":
        await post(
          "setLocation",
          { location: value.value.trim() },
          "已请求移动文件",
        );
        break;
      case "category":
        await post("setCategory", { category: value.value }, "分类已更新");
        break;
      case "tags":
        await post(
          tagAction.value === "add" ? "addTags" : "removeTags",
          { tags: tagAction.value === "clear" ? "" : value.value.trim() },
          "标签已更新",
        );
        break;
      case "rename":
        await post(
          "rename",
          { hash: targets.value[0]!, name: value.value.trim() },
          "任务已重命名",
          false,
        );
        break;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "参数无效";
    await nextTick();
    place();
  }
}
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (isForm.value) return;
  const options = [
    ...(popup.value?.querySelectorAll<HTMLButtonElement>(
      "[data-menu-item]:not(:disabled)",
    ) || []),
  ];
  let index = options.indexOf(document.activeElement as HTMLButtonElement);
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length;
    options[index]?.focus();
  }
  if (event.key === "ArrowLeft" && view.value !== "main") {
    event.preventDefault();
    back();
  }
  if (event.key === "Tab") close(false);
}
defineExpose({ open });
</script>
<template>
  <button
    ref="trigger"
    type="button"
    :class="
      label ? 'button quiet task-menu-trigger' : 'icon-button task-menu-trigger'
    "
    :disabled="disabled || !props.hashes.length || busy"
    :aria-label="menuLabel || label || '操作已选任务'"
    aria-haspopup="menu"
    :aria-expanded="opened"
    :aria-controls="id"
    @click="open"
  >
    <Icon name="more" :size="18" /><span v-if="label">{{ label }}</span>
  </button>
  <div
    :id="id"
    ref="popup"
    popover="auto"
    class="task-menu-popover"
    :class="{ 'task-menu-form': isForm }"
    :style="position"
    :role="isForm ? 'dialog' : 'menu'"
    :aria-label="titles[view]"
    @toggle="toggle"
    @keydown="keyboard"
  >
    <header class="task-menu-heading">
      <button
        v-if="view !== 'main'"
        class="icon-button"
        type="button"
        aria-label="返回操作菜单"
        @click="back"
      >
        <Icon name="chevronRight" class="task-menu-back" :size="16" />
      </button>
      <div>
        <strong>{{ titles[view] }}</strong
        ><small v-if="!single">已选 {{ targets.length }} 个任务</small>
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label="关闭操作菜单"
        @click="close()"
      >
        <Icon name="close" :size="16" />
      </button>
    </header>
    <p v-if="error" class="task-menu-error" role="alert">
      {{ error
      }}<button v-if="!ready && !loading" class="text-button" @click="load">
        重新读取
      </button>
    </p>
    <template v-if="!isForm"
      ><button
        v-for="item in items"
        :key="item.label"
        data-menu-item
        type="button"
        role="menuitem"
        class="task-menu-item"
        :class="{ danger: item.danger }"
        :disabled="busy"
        @click="pick(item)"
      >
        <Icon v-if="item.icon" :name="item.icon" :size="17" /><span>{{
          item.label
        }}</span
        ><Icon v-if="item.view" name="chevronRight" :size="15" /></button
    ></template>
    <p v-else-if="loading" class="task-menu-note" role="status">
      正在读取任务设置…
    </p>
    <form v-else-if="ready" class="task-menu-fields" @submit.prevent="submit">
      <fieldset :disabled="busy">
        <template v-if="view === 'downloadLimit' || view === 'uploadLimit'"
          ><label
            >{{
              view === "downloadLimit" ? "下载限速" : "上传限速"
            }}（KiB/s）<input
              v-model="value"
              autofocus
              type="number"
              min="0"
              step="any"
              required
              inputmode="decimal"
          /></label>
          <p>
            0 为不限速。{{ single ? "" : "应用到每个选中任务。" }}
          </p></template
        >
        <template v-else-if="view === 'share'"
          ><label
            >分享率<input
              v-model="ratio"
              type="number"
              min="-2"
              step="any"
              required /></label
          ><label
            >做种时间（分钟）<input
              v-model="seeding"
              type="number"
              min="-2"
              step="1"
              required /></label
          ><label
            >不活跃做种时间（分钟）<input
              v-model="inactive"
              type="number"
              min="-2"
              step="1"
              required
          /></label>
          <p>-2 为全局设置，-1 为不限制。</p></template
        >
        <template v-else-if="view === 'category'"
          ><label
            >分类<CapsuleSelect
              v-model="value"
              aria-label="分类"
              :options="[
                { value: '', label: '未分类' },
                ...Object.values(categories).map((item) => ({
                  value: item.name,
                  label: item.name,
                })),
              ]"
              :disabled="busy" /></label
        ></template>
        <template v-else-if="view === 'tags'"
          ><label
            >操作<CapsuleSelect
              v-model="tagAction"
              aria-label="标签操作"
              :options="[
                { value: 'add', label: '添加标签' },
                { value: 'remove', label: '移除指定标签' },
                { value: 'clear', label: '移除全部标签' },
              ]"
              :disabled="busy" /></label
          ><label v-if="tagAction !== 'clear'"
            >标签<input
              v-model="value"
              :list="id + '-tags'"
              required
              placeholder="多个标签用逗号分隔" /></label
          ><datalist :id="id + '-tags'">
            <option v-for="tag in tags" :key="tag" :value="tag" />
          </datalist>
          <p v-if="single">当前标签：{{ current?.tags || "无" }}</p></template
        >
        <template v-else-if="view === 'location'"
          ><label
            >保存目录<input v-model="value" required placeholder="/downloads"
          /></label>
          <p>移动现有文件，路径位于 qBittorrent 服务器。</p></template
        >
        <label v-else-if="view === 'rename'"
          >任务名称<input v-model="value" required
        /></label>
        <footer>
          <button type="button" class="button quiet" @click="back">返回</button
          ><button type="submit" class="button primary">
            {{ busy ? "保存中…" : view === "location" ? "移动文件" : "应用" }}
          </button>
        </footer>
      </fieldset>
    </form>
  </div>
</template>
