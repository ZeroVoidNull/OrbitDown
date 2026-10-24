<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  watch,
  ref,
} from "vue";
import ModalShell from "./ModalShell.vue";
import PreferenceField from "./PreferenceField.vue";
import Icon from "./Icon.vue";
import { scopedAPI } from "../lib/api";
import {
  fieldsFor,
  maskPreferences,
  preferencePatch,
  setPreferenceValue,
  preferenceSections,
  type Preferences,
} from "../lib/preferences";
import "../styles/settings.css";
const api = scopedAPI();
const emit = defineEmits<{ close: []; saved: [path: string] }>();
const original = ref<Preferences>({}),
  draft = ref<Preferences>({}),
  loading = ref(true),
  loaded = ref(false),
  busy = ref(false),
  error = ref(""),
  section = ref("downloads"),
  search = ref(""),
  resetVersion = ref(0),
  clearFields = ref(new Set<string>()),
  confirmSave = ref(false),
  success = ref("");
const fields = computed(() => fieldsFor(original.value)),
  patch = computed(() =>
    preferencePatch(original.value, draft.value, clearFields.value),
  ),
  dirty = computed(() => Object.keys(patch.value).length),
  dangerous = computed(() =>
    fields.value.filter(
      (field) => field.danger && Object.hasOwn(patch.value, field.key),
    ),
  ),
  groups = computed(() =>
    preferenceSections
      .map((group) => ({
        ...group,
        count: fields.value.filter((field) => field.section === group.key)
          .length,
      }))
      .filter((group) => group.count),
  ),
  visible = computed(() =>
    fields.value.filter((field) =>
      search.value.trim()
        ? `${field.label} ${field.key} ${field.hint || ""}`
            .toLowerCase()
            .includes(search.value.trim().toLowerCase())
        : field.section === section.value,
    ),
  ),
  // 「发送测试邮件」跟随最后一个邮件字段，渲染为同款行卡片
  lastMailKey = computed(() => {
    if (section.value !== "downloads" || search.value.trim()) return "";
    const mailKeys = visible.value
      .filter((field) => field.key.startsWith("mail_"))
      .map((field) => field.key);
    return mailKeys.length ? mailKeys[mailKeys.length - 1] : "";
  });
function reset() {
  draft.value = JSON.parse(JSON.stringify(original.value));
  clearFields.value = new Set();
  resetVersion.value++;
  error.value = "";
  success.value = "";
}
async function load() {
  loading.value = true;
  loaded.value = false;
  error.value = "";
  try {
    original.value = maskPreferences(
      await api.get<Record<string, unknown>>("/api/v2/app/preferences"),
    );
    reset();
    loaded.value = true;
    if (!groups.value.some((group) => group.key === section.value))
      section.value = groups.value[0]?.key || "other";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "读取设置失败";
  } finally {
    loading.value = false;
  }
}
const interfaces = ref<{ value: string; label: string }[]>([]),
  addresses = ref<{ value: string; label: string }[]>([]),
  networkController = new AbortController();
onUnmounted(() => networkController.abort());
async function loadInterfaces() {
  try {
    const items = await api.get<{ name: string; value: string }[]>(
      "/api/v2/app/networkInterfaceList",
      networkController.signal,
    );
    interfaces.value = [
      { value: "", label: "任意网络接口" },
      ...items.map((item) => ({ value: item.value, label: item.name })),
    ];
  } catch {}
}
watch(
  () => draft.value.current_network_interface,
  async (iface) => {
    try {
      const items = await api.get<string[]>(
        "/api/v2/app/networkInterfaceAddressList?iface=" +
          encodeURIComponent(String(iface || "")),
        networkController.signal,
      );
      if (draft.value.current_network_interface !== iface) return;
      addresses.value = [
        { value: "", label: "全部地址" },
        { value: "0.0.0.0", label: "全部 IPv4 地址" },
        { value: "::", label: "全部 IPv6 地址" },
        ...items
          .filter((ip) => !["", "0.0.0.0", "::"].includes(ip))
          .map((ip) => ({ value: ip, label: ip })),
      ];
    } catch {}
  },
);
async function testEmail() {
  busy.value = true;
  error.value = "";
  success.value = "";
  try {
    await api.post("/api/v2/app/sendTestEmail", {});
    success.value = "已请求发送测试邮件，请检查收件箱或执行日志。";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "发送失败";
  } finally {
    busy.value = false;
  }
}
// 分组导航单行滚动，溢出时以两侧箭头滑动
const groupsNav = ref<HTMLElement | null>(null),
  canLeft = ref(false),
  canRight = ref(false),
  groupsObserver = new ResizeObserver(() => updateGroupArrows());
function updateGroupArrows() {
  const el = groupsNav.value;
  if (!el) return;
  canLeft.value = el.scrollLeft > 4;
  canRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
}
function scrollGroups(direction: number) {
  const el = groupsNav.value;
  if (!el) return;
  el.scrollBy({
    left: direction * Math.max(160, el.clientWidth * 0.7),
    behavior: "smooth",
  });
}
// 分组数量变化（加载完成/搜索）改变溢出状态；ResizeObserver 只看盒子尺寸，
// scrollWidth 变化需要手动补测
watch(
  () => groups.value.map((g) => g.count).join(","),
  () => nextTick(updateGroupArrows),
);
// 设置页加载期间导航尚未渲染，等 ref 就绪后再绑定滚动监听
watch(groupsNav, (el) => {
  if (!el) return;
  groupsObserver.observe(el);
  el.addEventListener("scroll", updateGroupArrows, { passive: true });
  updateGroupArrows();
});
onMounted(() => {
  void load();
  void loadInterfaces();
});
onUnmounted(() => groupsObserver.disconnect());
function clear(key: string, value: boolean) {
  const fields = new Set(clearFields.value);
  value ? fields.add(key) : fields.delete(key);
  clearFields.value = fields;
}
async function save(confirmed = false) {
  if (!loaded.value || busy.value || !dirty.value) return;
  if (dangerous.value.length && !confirmed) {
    confirmSave.value = true;
    return;
  }
  busy.value = true;
  error.value = "";
  confirmSave.value = false;
  const savedPath = String(draft.value.save_path || "");
  try {
    await api.post("/api/v2/app/setPreferences", {
      json: JSON.stringify(patch.value),
    });
    success.value = "设置已保存";
    emit("saved", savedPath);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存失败";
    success.value = "";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <ModalShell title="下载设置" wide embedded>
    <div class="settings-workspace">
      <div v-if="loading" class="loading-state">
        <Icon name="loading" class="spin" />正在读取设置…
      </div>
      <div v-else-if="!loaded">
        <p class="form-error" role="alert">{{ error }}</p>
        <button class="button quiet" @click="load">
          <Icon name="refresh" :size="17" />重新读取
        </button>
      </div>
      <template v-else>
        <div class="settings-search">
          <Icon name="search" :size="18" /><input
            v-model="search"
            type="search"
            aria-label="搜索设置"
            placeholder="搜索设置名称或字段"
          /><span>{{ search ? visible.length : fields.length }} 项</span>
        </div>
        <div class="settings-layout">
          <div class="groups-scroller">
            <nav ref="groupsNav" class="settings-groups" aria-label="设置分组">
              <button
                v-for="group in groups"
                :key="group.key"
                type="button"
                :class="{ active: section === group.key && !search }"
                :aria-pressed="section === group.key && !search"
                @click="
                  section = group.key;
                  search = '';
                "
              >
                {{ group.label }}<span>{{ group.count }}</span>
              </button>
            </nav>
            <button
              v-if="canLeft"
              type="button"
              class="group-arrow left"
              aria-label="向左查看更多分组"
              @click="scrollGroups(-1)"
            >
              <Icon name="chevronLeft" :size="14" />
            </button>
            <button
              v-if="canRight"
              type="button"
              class="group-arrow right"
              aria-label="向右查看更多分组"
              @click="scrollGroups(1)"
            >
              <Icon name="chevronRight" :size="14" />
            </button>
          </div>
          <form
            id="preferences-form"
            class="settings-content"
            @submit.prevent="save()"
          >
            <p class="settings-scope">
              设置作用于共享 qBittorrent 实例。只保存已修改项。
            </p>
            <h3>
              {{
                search
                  ? "搜索结果"
                  : preferenceSections.find((group) => group.key === section)
                      ?.label
              }}
            </h3>
            <template v-for="field in visible" :key="field.key + '-' + resetVersion">
              <PreferenceField
                :field="field"
                :model-value="draft[field.key]"
                :baseline="original[field.key]"
                :clear-value="clearFields.has(field.key)"
                :suggestions="
                  field.key === 'current_network_interface'
                    ? interfaces
                    : field.key === 'current_interface_address'
                      ? addresses
                      : undefined
                "
                :configured="
                  original._orbitdown?.configured_fields?.includes(field.key)
                "
                :disabled="busy"
                @update:model-value="setPreferenceValue(draft, field.key, $event)"
                @clear="clear(field.key, $event)"
              />
              <div v-if="field.key === lastMailKey" class="preference-row">
                <span class="preference-label">邮件通知连通性</span>
                <div class="preference-control">
                  <button
                    type="button"
                    class="button quiet"
                    :disabled="busy || !!dirty"
                    @click="testEmail"
                  >
                    发送测试邮件
                  </button>
                </div>
              </div>
            </template>
            <p v-if="!visible.length" class="small-empty">没有匹配的设置</p>
          </form>
        </div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="success" role="status">{{ success }}</p>
        <footer class="settings-footer">
          <span class="muted">{{
            dirty ? "已修改 " + dirty + " 项" : "无未保存的修改"
          }}</span>
          <div>
            <button
              type="button"
              class="button quiet"
              :disabled="busy || !dirty"
              @click="reset"
            >
              撤销修改</button
            ><button
              type="submit"
              form="preferences-form"
              class="button primary"
              :disabled="busy || !loaded || !dirty"
            >
              <Icon
                :name="busy ? 'loading' : 'check'"
                :class="{ spin: busy }"
                :size="17"
              />{{ busy ? "保存中…" : "保存设置" }}
            </button>
          </div>
        </footer>
      </template>
    </div>
  </ModalShell>
  <ModalShell
    v-if="confirmSave"
    title="确认修改设置"
    @close="confirmSave = false"
    ><p class="settings-confirm-text">
      以下修改可能影响连接、认证或外部程序执行：
    </p>
    <ul class="settings-confirm-list">
      <li v-for="field in dangerous" :key="field.key">{{ field.label }}</li>
    </ul>
    <p class="settings-confirm-text">
      修改 qBittorrent WebUI 地址、端口、HTTPS 或认证后，可能需要同步更新
      OrbitDown 的连接配置。
    </p>
    <footer class="modal-footer">
      <button class="button quiet" @click="confirmSave = false">返回检查</button
      ><button class="button primary" @click="save(true)">确认保存</button>
    </footer></ModalShell
  >
</template>
