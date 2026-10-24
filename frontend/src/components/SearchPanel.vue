<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import ModalShell from "./ModalShell.vue";
import CapsuleSelect from "./CapsuleSelect.vue";
import Icon from "./Icon.vue";
import { scopedAPI } from "../lib/api";
import { bytes } from "../lib/format";
import {
  safeExternalURL,
  searchCategories,
  type SearchPlugin,
  type SearchJob,
  type SearchResults,
  type SearchResult,
} from "../lib/native-tools";
import "../styles/native-tools.css";
const api = scopedAPI();
const selectorId = useId();
const emit = defineEmits<{ close: []; added: [] }>();
const tab = ref("search"),
  pattern = ref(""),
  selection = ref("enabled"),
  category = ref("all"),
  plugins = ref<SearchPlugin[]>([]),
  jobs = ref<SearchJob[]>([]),
  selectedID = ref<number | null>(null),
  results = ref<SearchResults>({ results: [], status: "Stopped", total: 0 }),
  offset = ref(0),
  limit = 50,
  busy = ref(false),
  loading = ref(false),
  error = ref(""),
  message = ref(""),
  sources = ref(""),
  filter = ref(""),
  savePath = ref(""),
  downloadCategory = ref("");
const categories = computed(() =>
  searchCategories(plugins.value, selection.value),
);
type SelectOption = { value: string | number | boolean; label: string };
function withCurrentOption(
  options: SelectOption[],
  value: string,
): SelectOption[] {
  return options.some((option) => String(option.value) === value)
    ? options
    : [...options, { value, label: `当前值：${value}` }];
}
const pluginOptions = computed(() =>
  withCurrentOption(
    [
      { value: "enabled", label: "所有已启用插件" },
      { value: "all", label: "所有插件" },
      ...plugins.value.map((plugin) => ({
        value: plugin.name,
        label: plugin.fullName || plugin.name,
      })),
    ],
    selection.value,
  ),
);
const categoryOptions = computed(() =>
  withCurrentOption(
    categories.value.map((item) => ({ value: item.id, label: item.name })),
    category.value,
  ),
);
const jobOptions = computed(() => {
  const options: SelectOption[] = jobs.value.map((job) => ({
    value: job.id,
    label: `#${job.id} · ${job.status === "Running" ? "搜索中" : "已停止"} · ${job.total} 项`,
  }));
  if (selectedID.value === null)
    return [{ value: "", label: "选择任务" }, ...options];
  return withCurrentOption(options, String(selectedID.value));
});
function selectJobValue(value: string) {
  if (value === "") return;
  const id = Number(value);
  if (Number.isSafeInteger(id) && jobs.value.some((job) => job.id === id))
    selectJob(id);
}
const selectedJob = computed(() =>
  jobs.value.find((job) => job.id === selectedID.value),
);
const visibleResults = computed(() =>
  results.value.results.filter((result) =>
    result.fileName.toLowerCase().includes(filter.value.toLowerCase()),
  ),
);
let timer: ReturnType<typeof setInterval> | undefined,
  disposed = false,
  polling = false,
  refreshPending = false,
  revision = 0;
watch(selection, () => {
  category.value = "all";
});
async function loadPlugins() {
  plugins.value = await api.get<SearchPlugin[]>("/api/v2/search/plugins");
  if (
    !["enabled", "all"].includes(selection.value) &&
    !plugins.value.some((plugin) => plugin.name === selection.value)
  )
    selection.value = "enabled";
}
async function refresh() {
  if (disposed) return;
  if (polling) {
    refreshPending = true;
    return;
  }
  polling = true;
  const requestRevision = revision,
    id = selectedID.value,
    currentOffset = offset.value;
  try {
    const statuses = await api.get<SearchJob[]>("/api/v2/search/status");
    if (disposed || requestRevision !== revision) return;
    jobs.value = statuses;
    if (id !== null && statuses.some((job) => job.id === id)) {
      const data = await api.get<SearchResults>(
        `/api/v2/search/results?${new URLSearchParams({ id: String(id), limit: String(limit), offset: String(currentOffset) })}`,
      );
      if (!disposed && requestRevision === revision) results.value = data;
    }
  } catch (e) {
    if (!disposed && requestRevision === revision)
      error.value = e instanceof Error ? e.message : "读取搜索失败";
  } finally {
    polling = false;
    if (refreshPending && !disposed) {
      refreshPending = false;
      void refresh();
    }
  }
}
async function run(action: () => Promise<unknown>, success: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await action();
    message.value = success;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败";
  } finally {
    busy.value = false;
  }
}
async function start() {
  await run(async () => {
    const started = await api.post<{ id: number }>("/api/v2/search/start", {
      pattern: pattern.value.trim(),
      plugins: selection.value,
      category: category.value,
    });
    revision++;
    selectedID.value = started.id;
    offset.value = 0;
    results.value = { results: [], status: "Running", total: 0 };
    await refresh();
  }, "搜索已启动");
}
function selectJob(id: number) {
  revision++;
  selectedID.value = id;
  offset.value = 0;
  results.value = { results: [], status: "Running", total: 0 };
  void refresh();
}
async function stopJob() {
  const id = selectedID.value;
  if (id === null) return;
  await run(async () => {
    await api.post("/api/v2/search/stop", { id: String(id) });
    await refresh();
  }, "搜索已停止");
}
async function deleteJob() {
  const id = selectedID.value;
  if (id === null) return;
  await run(async () => {
    await api.post("/api/v2/search/delete", { id: String(id) });
    revision++;
    jobs.value = jobs.value.filter((job) => job.id !== id);
    selectedID.value = null;
    results.value = { results: [], status: "Stopped", total: 0 };
  }, "搜索任务已删除");
}
async function page(direction: number) {
  offset.value = Math.max(0, offset.value + direction * limit);
  revision++;
  await refresh();
}
async function add(result: SearchResult) {
  await run(async () => {
    const reply = await api.post("/api/v2/torrents/add", {
      urls: result.fileUrl,
      ...(savePath.value.trim() ? { savepath: savePath.value.trim() } : {}),
      ...(downloadCategory.value.trim()
        ? { category: downloadCategory.value.trim() }
        : {}),
    });
    if (typeof reply === "string" && /fails/i.test(reply))
      throw new Error("下载添加失败，请检查种子地址");
    emit("added");
  }, `已添加：${result.fileName}`);
}
async function pluginAction(
  endpoint: string,
  data: Record<string, string> = {},
) {
  await run(async () => {
    await api.post(`/api/v2/search/${endpoint}`, data);
    await loadPlugins();
  }, "插件已更新");
}
function uninstall(plugin: SearchPlugin) {
  if (window.confirm(`卸载插件“${plugin.fullName || plugin.name}”？`))
    void pluginAction("uninstallPlugin", { names: plugin.name });
}
async function install() {
  if (
    !window.confirm(
      "搜索插件会在 qBittorrent 主机上运行代码。仅安装可信来源的插件，继续安装？",
    )
  )
    return;
  await pluginAction("installPlugin", {
    sources: sources.value.trim().split(/\n+/).join("|"),
  });
}
onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([loadPlugins(), refresh()]);
    if (jobs.value[0]) selectJob(jobs.value[0].id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "读取搜索插件失败";
  } finally {
    loading.value = false;
  }
  timer = setInterval(() => {
    if (jobs.value.some((job) => job.status === "Running") && !busy.value)
      void refresh();
  }, 2000);
});
onBeforeUnmount(() => {
  disposed = true;
  if (timer) clearInterval(timer);
});
</script>
<template>
  <ModalShell title="搜索" wide embedded @close="!busy && emit('close')"
    ><div class="native-tools">
      <nav class="tool-tabs" aria-label="搜索页面">
        <button :aria-selected="tab === 'search'" @click="tab = 'search'">
          种子搜索</button
        ><button :aria-selected="tab === 'plugins'" @click="tab = 'plugins'">
          搜索插件
        </button>
      </nav>
      <p v-if="error" class="tool-message error" role="alert">{{ error }}</p>
      <p v-if="message" class="tool-message" role="status">{{ message }}</p>
      <p v-if="loading" class="tool-muted" role="status">正在读取…</p>
      <fieldset
        :disabled="busy || loading"
        style="border: 0; padding: 0; margin: 0; min-width: 0"
      >
        <template v-if="tab === 'search'"
          ><form @submit.prevent="start">
            <label class="field"
              >搜索内容<input
                v-model="pattern"
                required
                autofocus
                placeholder="名称或关键词"
            /></label>
            <div class="tool-grid">
              <div class="field">
                <label :for="`${selectorId}-plugin`">搜索插件</label>
                <CapsuleSelect
                  :id="`${selectorId}-plugin`"
                  v-model="selection"
                  :options="pluginOptions"
                  :disabled="busy || loading"
                  aria-label="搜索插件"
                />
              </div>
              <div class="field">
                <label :for="`${selectorId}-category`">分类</label>
                <CapsuleSelect
                  :id="`${selectorId}-category`"
                  v-model="category"
                  :options="categoryOptions"
                  :disabled="busy || loading"
                  aria-label="搜索分类"
                />
              </div>
            </div>
            <div class="tool-actions">
              <button
                class="button primary"
                type="submit"
                :disabled="!pattern.trim() || !plugins.length"
              >
                <Icon name="search" />搜索</button
              ><button class="button" type="button" @click="refresh">
                <Icon name="refresh" />刷新
              </button>
            </div>
          </form>
          <p v-if="!plugins.length" class="tool-muted">
            暂无搜索插件，请先安装插件。
          </p>
          <div v-if="jobs.length" class="tool-actions">
            <div class="field">
              <label :for="`${selectorId}-job`">搜索任务</label>
              <CapsuleSelect
                :id="`${selectorId}-job`"
                :model-value="selectedID === null ? '' : String(selectedID)"
                :options="jobOptions"
                :disabled="busy || loading"
                aria-label="搜索任务"
                @update:model-value="selectJobValue"
              />
            </div>
            <button
              class="button"
              :disabled="!selectedJob || selectedJob.status !== 'Running'"
              @click="stopJob"
            >
              停止搜索</button
            ><button
              class="button danger"
              :disabled="!selectedJob"
              @click="deleteJob"
            >
              删除任务
            </button>
          </div>
          <template v-if="selectedID !== null"
            ><div class="tool-grid">
              <label class="field"
                >下载目录<input
                  v-model="savePath"
                  placeholder="使用默认目录" /></label
              ><label class="field"
                >下载分类<input v-model="downloadCategory" placeholder="无分类"
              /></label>
            </div>
            <label class="field"
              >筛选当前页结果<input
                v-model="filter"
                type="search"
                placeholder="名称"
            /></label>
            <div class="tool-meta">
              <span>{{
                selectedJob?.status === "Running" ? "搜索中" : "已停止"
              }}</span
              ><span>共 {{ results.total }} 项</span>
            </div>
            <article
              v-for="(result, index) in visibleResults"
              :key="`${result.fileUrl}-${index}`"
              class="tool-card"
            >
              <h3>{{ result.fileName }}</h3>
              <div class="tool-meta">
                <span>{{ bytes(result.fileSize) }}</span
                ><span
                  >做种
                  {{ result.nbSeeders >= 0 ? result.nbSeeders : "—" }}</span
                ><span
                  >下载
                  {{ result.nbLeechers >= 0 ? result.nbLeechers : "—" }}</span
                ><span>{{ result.siteUrl }}</span>
              </div>
              <div class="tool-actions">
                <button class="button primary" @click="add(result)">
                  <Icon name="plus" />添加下载</button
                ><a
                  v-if="safeExternalURL(result.descrLink)"
                  class="button"
                  :href="safeExternalURL(result.descrLink)"
                  target="_blank"
                  rel="noopener noreferrer"
                  >详情<Icon name="external" :size="16"
                /></a>
              </div>
            </article>
            <p v-if="!visibleResults.length" class="tool-muted">暂无搜索结果</p>
            <div class="tool-actions">
              <button class="button" :disabled="offset === 0" @click="page(-1)">
                上一页</button
              ><span class="tool-muted"
                >第 {{ Math.floor(offset / limit) + 1 }} 页</span
              ><button
                class="button"
                :disabled="offset + limit >= results.total"
                @click="page(1)"
              >
                下一页
              </button>
            </div></template
          ></template
        >
        <template v-else
          ><form @submit.prevent="install">
            <label class="field"
              >插件地址或主机文件路径<textarea
                v-model="sources"
                required
                placeholder="https://example.org/plugin.py"
              /><small
                >多个来源每行一个。插件代码由 qBittorrent 主机执行。</small
              ></label
            >
            <div class="tool-actions">
              <button class="button primary" type="submit">安装插件</button
              ><button
                class="button"
                type="button"
                @click="pluginAction('updatePlugins')"
              >
                <Icon name="refresh" />检查更新</button
              ><button
                class="button"
                type="button"
                @click="run(loadPlugins, '已刷新插件列表')"
              >
                刷新列表
              </button>
            </div>
          </form>
          <article
            v-for="plugin in plugins"
            :key="plugin.name"
            class="tool-card"
          >
            <h3>{{ plugin.fullName || plugin.name }}</h3>
            <div class="tool-meta">
              <span>{{ plugin.enabled ? "已启用" : "已禁用" }}</span
              ><span>{{ plugin.version }}</span
              ><span>{{ plugin.name }}</span>
            </div>
            <div class="tool-actions">
              <button
                class="button"
                @click="
                  pluginAction('enablePlugin', {
                    names: plugin.name,
                    enable: String(!plugin.enabled),
                  })
                "
              >
                {{ plugin.enabled ? "禁用" : "启用" }}</button
              ><button class="button danger" @click="uninstall(plugin)">
                卸载</button
              ><a
                v-if="safeExternalURL(plugin.url)"
                class="button"
                :href="safeExternalURL(plugin.url)"
                target="_blank"
                rel="noopener noreferrer"
                >插件网站<Icon name="external" :size="16"
              /></a>
            </div></article
        ></template>
      </fieldset></div
  ></ModalShell>
</template>
