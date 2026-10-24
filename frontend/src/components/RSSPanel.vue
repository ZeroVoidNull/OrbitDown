<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import ModalShell from "./ModalShell.vue";
import CapsuleSelect from "./CapsuleSelect.vue";
import Icon from "./Icon.vue";
import { scopedAPI } from "../lib/api";
import {
  flattenRSS,
  newRSSRule,
  normalizeRSSRule,
  serializeRSSRule,
  safeExternalURL,
  type RSSTree,
  type RSSRule,
  type RSSArticle,
} from "../lib/native-tools";
import "../styles/native-tools.css";
const api = scopedAPI();
const selectorId = useId();
const emit = defineEmits<{ close: []; added: [] }>();
const tab = ref("feeds"),
  tree = ref<RSSTree>({}),
  rules = ref<Record<string, RSSRule>>({}),
  selected = ref(""),
  busy = ref(false),
  loading = ref(false),
  error = ref(""),
  message = ref("");
const addType = ref("feed"),
  itemPath = ref(""),
  feedURL = ref(""),
  movePath = ref("");
const ruleName = ref(""),
  originalRuleName = ref(""),
  rule = ref<RSSRule>(newRSSRule()),
  matches = ref<Record<string, string[]> | null>(null);
const items = computed(() => flattenRSS(tree.value)),
  feeds = computed(() => items.value.filter((item) => item.feed)),
  selectedItem = computed(() =>
    items.value.find((item) => item.path === selected.value),
  );
const articles = computed(() => selectedItem.value?.data?.articles || []);
const tags = computed({
  get: () => ((rule.value.torrentParams?.tags as string[]) || []).join(", "),
  set: (value: string) => {
    ensureParams().tags = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
});
const previousEpisodes = computed({
  get: () => rule.value.previouslyMatchedEpisodes.join("\n"),
  set: (value: string) => {
    rule.value.previouslyMatchedEpisodes = value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  },
});
function ensureParams() {
  if (!rule.value.torrentParams)
    rule.value.torrentParams = {
      save_path: rule.value.savePath,
      category: rule.value.assignedCategory,
      stopped: rule.value.addPaused,
      content_layout: rule.value.torrentContentLayout || null,
    };
  return rule.value.torrentParams;
}
const extraParams: {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  min?: number;
  options?: [string, string][];
  secret?: boolean;
}[] = [
  { key: "download_path", label: "未完成下载目录", type: "text" },
  {
    key: "use_download_path",
    label: "使用未完成下载目录",
    type: "select",
    options: [
      ["true", "启用"],
      ["false", "禁用"],
    ],
  },
  {
    key: "operating_mode",
    label: "运行模式",
    type: "select",
    options: [
      ["AutoManaged", "队列管理"],
      ["Forced", "强制启动"],
    ],
  },
  {
    key: "add_to_top_of_queue",
    label: "添加到队列顶部",
    type: "select",
    options: [
      ["true", "启用"],
      ["false", "禁用"],
    ],
  },
  {
    key: "stop_condition",
    label: "停止条件",
    type: "select",
    options: [
      ["None", "无"],
      ["MetadataReceived", "收到元数据"],
      ["FilesChecked", "完成文件校验"],
    ],
  },
  {
    key: "seed_mode",
    label: "跳过初始文件校验",
    type: "select",
    options: [
      ["true", "启用"],
      ["false", "禁用"],
    ],
  },
  {
    key: "inactive_seeding_time_limit",
    label: "无活动做种限制（分钟）",
    type: "number",
    min: -2,
  },
  {
    key: "share_limits_mode",
    label: "分享限制模式",
    type: "select",
    options: [
      ["Default", "使用默认设置"],
      ["MatchAny", "任一限制满足时"],
      ["MatchAll", "全部限制满足时"],
    ],
  },
  {
    key: "share_limit_action",
    label: "达到分享限制后",
    type: "select",
    options: [
      ["Default", "使用默认设置"],
      ["Stop", "停止"],
      ["Remove", "移除任务"],
      ["RemoveWithContent", "移除任务与文件"],
      ["EnableSuperSeeding", "启用超级做种"],
    ],
  },
  { key: "ssl_certificate", label: "SSL 证书（PEM）", type: "text" },
  {
    key: "ssl_private_key",
    label: "SSL 私钥（PEM）",
    type: "text",
    secret: true,
  },
  { key: "ssl_dh_params", label: "SSL DH 参数（PEM）", type: "text" },
];
type SelectOption = { value: string | number | boolean; label: string };
function withCurrentOption(
  options: SelectOption[],
  value: unknown,
): SelectOption[] {
  if (
    value == null ||
    options.some((option) => String(option.value) === String(value))
  )
    return options;
  return [
    ...options,
    { value: String(value), label: `当前值：${String(value)}` },
  ];
}
const defaultOption = { value: "", label: "使用默认设置" };
const addTypeOptions = [
  { value: "feed", label: "RSS 订阅" },
  { value: "folder", label: "文件夹" },
];
const booleanOptions = [
  defaultOption,
  { value: true, label: "启用" },
  { value: false, label: "禁用" },
];
const pausedOptions = [
  defaultOption,
  { value: true, label: "停止" },
  { value: false, label: "启动" },
];
const layoutOptions = [
  defaultOption,
  { value: "Original", label: "原始布局" },
  { value: "Subfolder", label: "创建子目录" },
  { value: "NoSubfolder", label: "不创建子目录" },
];
function extraParamOptions(
  field: (typeof extraParams)[number],
): SelectOption[] {
  return withCurrentOption(
    [
      defaultOption,
      ...(field.options || []).map(([value, label]) => ({ value, label })),
    ],
    rule.value.torrentParams?.[field.key],
  );
}
function setPaused(value: string) {
  if (String(rule.value.addPaused ?? "") === value) return;
  if (value === "") rule.value.addPaused = null;
  else if (value === "true" || value === "false")
    rule.value.addPaused = value === "true";
}
function setAutoManagement(value: string) {
  if (String(rule.value.torrentParams?.use_auto_tmm ?? "") === value) return;
  if (value === "" || value === "true" || value === "false")
    ensureParams().use_auto_tmm = value === "" ? null : value === "true";
}
function setParam(key: string, value: string, type: string) {
  const params = ensureParams();
  if (type === "select" && String(params[key] ?? "") === value) return;
  params[key] =
    value === ""
      ? null
      : type === "number"
        ? Number(value)
        : type === "select" && value === "true"
          ? true
          : type === "select" && value === "false"
            ? false
            : value;
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [data, definitions] = await Promise.all([
      api.get<RSSTree>("/api/v2/rss/items?withData=true"),
      api.get<Record<string, RSSRule>>("/api/v2/rss/rules"),
    ]);
    tree.value = data;
    rules.value = definitions;
    if (!items.value.some((i) => i.path === selected.value))
      selected.value =
        items.value.find((i) => i.feed)?.path || items.value[0]?.path || "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "读取 RSS 失败";
  } finally {
    loading.value = false;
  }
}
async function downloadArticle(article: RSSArticle) {
  await run(async () => {
    const result = await api.post("/api/v2/torrents/add", {
      urls: article.torrentURL!,
    });
    if (typeof result === "string" && result.trim() === "Fails.")
      throw new Error("qBittorrent 未能添加任务，请检查链接或重复任务");
    emit("added");
  }, "已添加下载");
}
async function run(action: () => Promise<unknown>, success: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await action();
    await load();
    message.value = success;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败";
  } finally {
    busy.value = false;
  }
}
function addItem() {
  void run(async () => {
    if (!itemPath.value.trim()) throw new Error("请输入完整路径");
    if (addType.value === "folder")
      await api.post("/api/v2/rss/addFolder", { path: itemPath.value.trim() });
    else {
      if (!safeExternalURL(feedURL.value))
        throw new Error("请输入 HTTP(S) 订阅地址");
      await api.post("/api/v2/rss/addFeed", {
        url: feedURL.value.trim(),
        path: itemPath.value.trim(),
      });
    }
    selected.value = itemPath.value.trim();
    itemPath.value = "";
    feedURL.value = "";
  }, "已添加");
}
function moveItem() {
  const destination = movePath.value.trim();
  if (!destination) return;
  void run(async () => {
    await api.post("/api/v2/rss/moveItem", {
      itemPath: selected.value,
      destPath: destination,
    });
    selected.value = destination;
  }, "已移动");
}
function removeItem() {
  if (!selected.value || !window.confirm(`删除“${selected.value}”及其订阅？`))
    return;
  void run(
    () => api.post("/api/v2/rss/removeItem", { path: selected.value }),
    "已删除",
  );
}
function markRead(article?: RSSArticle) {
  void run(
    () =>
      api.post("/api/v2/rss/markAsRead", {
        itemPath: selected.value,
        ...(article ? { articleId: article.id } : {}),
      }),
    "已标记为已读",
  );
}
function editRule(name = "") {
  originalRuleName.value = name;
  ruleName.value = name;
  rule.value = name ? normalizeRSSRule(rules.value[name]!) : newRSSRule();
  matches.value = null;
}
function saveRule() {
  void run(async () => {
    const name = ruleName.value.trim();
    if (!name) throw new Error("请输入规则名称");
    if (name !== originalRuleName.value && rules.value[name])
      throw new Error("规则名称已存在");
    const definition = serializeRSSRule(rule.value);
    if (originalRuleName.value && name !== originalRuleName.value) {
      await api.post("/api/v2/rss/renameRule", {
        ruleName: originalRuleName.value,
        newRuleName: name,
      });
      originalRuleName.value = name;
    }
    await api.post("/api/v2/rss/setRule", {
      ruleName: name,
      ruleDef: definition,
    });
    originalRuleName.value = name;
  }, "规则已保存");
}
function removeRule() {
  const name = originalRuleName.value;
  if (!name || !window.confirm(`删除自动下载规则“${name}”？`)) return;
  void run(async () => {
    await api.post("/api/v2/rss/removeRule", { ruleName: name });
    editRule();
  }, "规则已删除");
}
async function previewRule() {
  if (!originalRuleName.value) return;
  await run(async () => {
    matches.value = await api.get<Record<string, string[]>>(
      `/api/v2/rss/matchingArticles?${new URLSearchParams({ ruleName: originalRuleName.value })}`,
    );
  }, "已读取已保存规则的匹配结果");
}
onMounted(load);
</script>
<template>
  <ModalShell title="RSS 订阅" wide embedded @close="!busy && emit('close')">
    <div class="native-tools">
      <nav class="tool-tabs" aria-label="RSS 页面">
        <button :aria-selected="tab === 'feeds'" @click="tab = 'feeds'">
          订阅与文章</button
        ><button :aria-selected="tab === 'rules'" @click="tab = 'rules'">
          自动下载规则
        </button>
      </nav>
      <p v-if="error" class="tool-message error" role="alert">{{ error }}</p>
      <p v-if="message" class="tool-message" role="status">{{ message }}</p>
      <p v-if="loading" class="tool-muted" role="status">正在读取…</p>
      <fieldset
        :disabled="busy || loading"
        style="border: 0; padding: 0; margin: 0; min-width: 0"
      >
        <template v-if="tab === 'feeds'">
          <details class="tool-section">
            <summary>添加订阅或文件夹</summary>
            <form @submit.prevent="addItem">
              <div class="tool-grid">
                <div class="field">
                  <label :for="`${selectorId}-add-type`">类型</label>
                  <CapsuleSelect
                    :id="`${selectorId}-add-type`"
                    v-model="addType"
                    :options="addTypeOptions"
                    :disabled="busy || loading"
                    aria-label="订阅或文件夹类型"
                  />
                </div>
                <label class="field"
                  >完整路径<input
                    v-model="itemPath"
                    required
                    placeholder="Linux\发行版"
                  /><small
                    >使用反斜线分隔文件夹与名称；父文件夹需已存在。</small
                  ></label
                ><label v-if="addType === 'feed'" class="field"
                  >订阅地址<input
                    v-model="feedURL"
                    type="url"
                    required
                    placeholder="https://example.org/feed.xml"
                /></label>
              </div>
              <button class="button primary" type="submit">
                <Icon name="plus" />添加
              </button>
            </form>
          </details>
          <div class="tool-split">
            <aside class="tool-sidebar" aria-label="订阅列表">
              <button
                v-for="item in items"
                :key="item.path"
                :class="{ selected: selected === item.path }"
                :style="{ paddingLeft: `${12 + item.depth * 14}px` }"
                @click="
                  selected = item.path;
                  movePath = item.path;
                "
              >
                <Icon :name="item.feed ? 'globe' : 'folder'" :size="16" />{{
                  item.name
                }}<span v-if="item.data?.hasError">读取失败</span>
              </button>
              <p v-if="!items.length" class="tool-muted">暂无订阅</p>
            </aside>
            <section v-if="selectedItem">
              <h3>{{ selectedItem.name }}</h3>
              <p v-if="selectedItem.data" class="tool-muted">
                {{ selectedItem.data.url }}
              </p>
              <div class="tool-actions">
                <button
                  class="button"
                  @click="
                    run(
                      () =>
                        api.post('/api/v2/rss/refreshItem', {
                          itemPath: selected,
                        }),
                      '已请求刷新',
                    )
                  "
                >
                  <Icon name="refresh" />刷新</button
                ><button class="button" @click="markRead()">
                  <Icon name="checks" :size="16" />全部已读</button
                ><button class="button danger" @click="removeItem">
                  <Icon name="trash" :size="16" />删除
                </button>
              </div>
              <form class="tool-actions" @submit.prevent="moveItem">
                <label class="field"
                  >移动或重命名<input
                    v-model="movePath"
                    required
                    placeholder="目标完整路径" /></label
                ><button
                  class="button"
                  :disabled="!movePath || movePath === selected"
                >
                  移动
                </button>
              </form>
              <article
                v-for="article in articles"
                :key="article.id"
                class="tool-card"
              >
                <h3>{{ article.title }}</h3>
                <div class="tool-meta">
                  <span>{{ article.isRead ? "已读" : "未读" }}</span
                  ><span>{{ article.date }}</span
                  ><span>{{ article.author }}</span>
                </div>
                <p v-if="article.description">
                  {{ article.description.replace(/<[^>]*>/g, "") }}
                </p>
                <div class="tool-actions">
                  <button
                    class="button"
                    :disabled="article.isRead"
                    @click="markRead(article)"
                  >
                    <Icon name="check" :size="16" />标记已读</button
                  ><a
                    v-if="safeExternalURL(article.link)"
                    class="button"
                    :href="safeExternalURL(article.link)"
                    target="_blank"
                    rel="noopener noreferrer"
                    >查看原文<Icon name="external" :size="16" /></a
                  ><button
                    v-if="article.torrentURL"
                    class="button primary"
                    @click="downloadArticle(article)"
                  >
                    <Icon name="download" :size="16" />下载
                  </button>
                </div>
              </article>
              <p v-if="!articles.length" class="tool-muted">
                {{
                  selectedItem.feed
                    ? "暂无文章，刷新后重试。"
                    : "请选择订阅查看文章。"
                }}
              </p>
            </section>
          </div>
        </template>
        <div v-else class="tool-split">
          <aside class="tool-sidebar" aria-label="自动下载规则">
            <button
              :class="{ selected: !originalRuleName }"
              @click="editRule()"
            >
              <Icon name="plus" :size="16" />新建规则</button
            ><button
              v-for="(definition, name) in rules"
              :key="name"
              :class="{ selected: originalRuleName === name }"
              @click="editRule(String(name))"
            >
              {{ definition.enabled ? "●" : "○" }} {{ name }}
            </button>
          </aside>
          <form @submit.prevent="saveRule">
            <label class="field"
              >规则名称<input v-model="ruleName" required
            /></label>
            <div class="tool-grid">
              <label class="checkbox-field"
                ><input v-model="rule.enabled" type="checkbox" />启用规则</label
              ><label class="checkbox-field"
                ><input
                  v-model="rule.useRegex"
                  type="checkbox"
                />使用正则表达式（PCRE2）</label
              ><label class="field"
                >必须包含<input v-model="rule.mustContain" /><small
                  >普通模式：空格表示同时匹配，| 表示任选，支持 *
                  通配符。</small
                ></label
              ><label class="field"
                >不能包含<input v-model="rule.mustNotContain" /></label
              ><label class="field"
                >剧集过滤<input
                  v-model="rule.episodeFilter"
                  placeholder="1x01-12;15;"
                /><small
                  >按季与集数过滤，例如 1x01-;；日期可通过标题正则匹配。</small
                ></label
              ><label class="field"
                >再次匹配间隔（天）<input
                  v-model.number="rule.ignoreDays"
                  type="number"
                  min="0"
                  step="1" /></label
              ><label class="checkbox-field"
                ><input
                  v-model="rule.smartFilter"
                  type="checkbox"
                />智能剧集过滤（含日期识别）</label
              ><label class="field"
                >规则优先级<input
                  v-model.number="rule.priority"
                  type="number"
                  step="1"
              /></label>
            </div>
            <div class="tool-section">
              <h3>应用到订阅</h3>
              <div class="tool-feed-options">
                <label
                  v-for="feed in feeds"
                  :key="feed.path"
                  class="checkbox-field"
                  ><input
                    v-model="rule.affectedFeeds"
                    type="checkbox"
                    :value="feed.data!.url"
                  />{{ feed.path }}</label
                ><label
                  v-for="url in rule.affectedFeeds.filter(
                    (url) => !feeds.some((feed) => feed.data!.url === url),
                  )"
                  :key="url"
                  class="checkbox-field"
                  ><input
                    v-model="rule.affectedFeeds"
                    type="checkbox"
                    :value="url"
                  />{{ url }}（订阅不可用）</label
                >
              </div>
              <p v-if="!feeds.length" class="tool-muted">请先添加订阅。</p>
            </div>
            <div class="tool-section">
              <h3>下载选项</h3>
              <div class="tool-grid">
                <label class="field"
                  >保存目录<input
                    v-model="rule.savePath"
                    placeholder="使用默认目录" /></label
                ><label class="field"
                  >分类<input v-model="rule.assignedCategory"
                /></label>
                <div class="field">
                  <label :for="`${selectorId}-paused`">添加状态</label>
                  <CapsuleSelect
                    :id="`${selectorId}-paused`"
                    :model-value="String(rule.addPaused ?? '')"
                    :options="withCurrentOption(pausedOptions, rule.addPaused)"
                    :disabled="busy || loading"
                    aria-label="添加状态"
                    @update:model-value="setPaused"
                  />
                </div>
                <div class="field">
                  <label :for="`${selectorId}-layout`">内容布局</label>
                  <CapsuleSelect
                    :id="`${selectorId}-layout`"
                    :model-value="rule.torrentContentLayout ?? ''"
                    :options="
                      withCurrentOption(
                        layoutOptions,
                        rule.torrentContentLayout,
                      )
                    "
                    :disabled="busy || loading"
                    aria-label="内容布局"
                    @update:model-value="
                      rule.torrentContentLayout =
                        $event === '' ? undefined : $event
                    "
                  />
                </div>
              </div>
              <details>
                <summary>更多下载参数</summary>
                <div class="tool-grid">
                  <label class="field"
                    >标签（逗号分隔）<input v-model="tags"
                  /></label>
                  <div class="field">
                    <label :for="`${selectorId}-auto-management`"
                      >自动管理</label
                    >
                    <CapsuleSelect
                      :id="`${selectorId}-auto-management`"
                      :model-value="
                        String(rule.torrentParams?.use_auto_tmm ?? '')
                      "
                      :options="
                        withCurrentOption(
                          booleanOptions,
                          rule.torrentParams?.use_auto_tmm,
                        )
                      "
                      :disabled="busy || loading"
                      aria-label="自动管理"
                      @update:model-value="setAutoManagement"
                    />
                  </div>
                  <label class="field"
                    >下载限速（B/s）<input
                      :value="rule.torrentParams?.download_limit ?? -1"
                      type="number"
                      min="-1"
                      @input="
                        ensureParams().download_limit = Number(
                          ($event.target as HTMLInputElement).value,
                        )
                      "
                    /><small>-1 使用默认限制，0 不限速</small></label
                  ><label class="field"
                    >上传限速（B/s）<input
                      :value="rule.torrentParams?.upload_limit ?? -1"
                      type="number"
                      min="-1"
                      @input="
                        ensureParams().upload_limit = Number(
                          ($event.target as HTMLInputElement).value,
                        )
                      " /></label
                  ><label class="field"
                    >分享率限制<input
                      :value="rule.torrentParams?.ratio_limit ?? -2"
                      type="number"
                      min="-2"
                      step="0.1"
                      @input="
                        ensureParams().ratio_limit = Number(
                          ($event.target as HTMLInputElement).value,
                        )
                      "
                    /><small>-2 使用默认，-1 不限制</small></label
                  ><label class="field"
                    >做种时间限制（分钟）<input
                      :value="rule.torrentParams?.seeding_time_limit ?? -2"
                      type="number"
                      min="-2"
                      @input="
                        ensureParams().seeding_time_limit = Number(
                          ($event.target as HTMLInputElement).value,
                        )
                      "
                  /></label>
                </div>
                <div class="tool-grid">
                  <div
                    v-for="field in extraParams"
                    :key="field.key"
                    class="field"
                  >
                    <label :for="`${selectorId}-param-${field.key}`">{{
                      field.label
                    }}</label>
                    <CapsuleSelect
                      v-if="field.type === 'select'"
                      :id="`${selectorId}-param-${field.key}`"
                      :model-value="
                        String(rule.torrentParams?.[field.key] ?? '')
                      "
                      :options="extraParamOptions(field)"
                      :disabled="busy || loading"
                      :aria-label="field.label"
                      @update:model-value="
                        setParam(field.key, $event, field.type)
                      "
                    />
                    <textarea
                      v-else-if="field.key.startsWith('ssl_')"
                      :id="`${selectorId}-param-${field.key}`"
                      :value="
                        field.secret
                          ? ''
                          : String(rule.torrentParams?.[field.key] ?? '')
                      "
                      :placeholder="
                        field.secret && rule.torrentParams?.[field.key]
                          ? '已设置，留空保留'
                          : ''
                      "
                      autocomplete="off"
                      @input="
                        setParam(
                          field.key,
                          ($event.target as HTMLTextAreaElement).value,
                          field.type,
                        )
                      "
                    /><input
                      v-else
                      :id="`${selectorId}-param-${field.key}`"
                      :value="rule.torrentParams?.[field.key] ?? ''"
                      :type="field.type"
                      :min="field.min"
                      @input="
                        setParam(
                          field.key,
                          ($event.target as HTMLInputElement).value,
                          field.type,
                        )
                      "
                    />
                  </div>
                </div>
                <p class="tool-muted">
                  未修改的扩展参数会保留；参数支持情况取决于 qBittorrent 版本。
                </p>
              </details>
            </div>
            <details class="tool-section">
              <summary>匹配历史与日期</summary>
              <label class="field"
                >上次匹配时间（RFC 2822）<input
                  v-model="rule.lastMatch"
                  placeholder="留空重置"
                /><small
                  >与忽略天数共同决定下一次允许匹配的文章日期。</small
                ></label
              ><label class="field"
                >已匹配剧集（每行一项）<textarea v-model="previousEpisodes" />
              </label>
            </details>
            <div class="tool-actions">
              <button class="button primary" type="submit">保存规则</button
              ><button
                class="button"
                type="button"
                :disabled="!originalRuleName"
                @click="previewRule"
              >
                查看匹配</button
              ><button
                class="button danger"
                type="button"
                :disabled="!originalRuleName"
                @click="removeRule"
              >
                删除规则
              </button>
            </div>
            <section v-if="matches" class="tool-section">
              <h3>已保存规则的匹配文章</h3>
              <div
                v-for="(titles, feed) in matches"
                :key="feed"
                class="tool-card"
              >
                <h3>{{ feed }}</h3>
                <p v-for="title in titles" :key="title">{{ title }}</p>
                <p v-if="!titles.length" class="tool-muted">无匹配文章</p>
              </div>
              <p v-if="!Object.keys(matches).length" class="tool-muted">
                无匹配文章
              </p>
            </section>
          </form>
        </div>
      </fieldset>
    </div>
  </ModalShell>
</template>
