<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import ModalShell from "./ModalShell.vue";
import Icon from "./Icon.vue";
import {
  adoptSession,
  authenticate,
  readConnection,
  readSavedPassword,
  writeConnection,
} from "../lib/qbit";
import {
  canRetainConnectionPassword,
  connectionEndpointError,
  connectionValidationError,
  joinConnectionAddress,
  splitConnectionUrl,
  type ConnectionInfo,
} from "../lib/connection";
import "../styles/connection.css";

const emit = defineEmits<{ close: []; saved: [] }>();
const id = useId();
const saved = ref<ConnectionInfo | null>(null);
const address = ref("");
const port = ref("");
const username = ref("");
const password = ref("");
const loading = ref(true);
const action = ref<"test" | "save" | null>(null);
const loadError = ref("");
const error = ref("");
const testedVersion = ref("");
const busy = computed(() => loading.value || action.value !== null);
const retainPassword = computed(() =>
  canRetainConnectionPassword(
    saved.value,
    joinConnectionAddress(address.value, port.value),
    username.value,
  ),
);
let mounted = true;

watch([address, port, username, password], () => {
  testedVersion.value = "";
  error.value = "";
});

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const info = await readConnection();
    if (!mounted) return;
    saved.value = info;
    const endpoint = splitConnectionUrl(info.url);
    address.value = endpoint.address;
    port.value = endpoint.port;
    username.value = info.username;
    password.value = "";
  } catch (cause) {
    if (!mounted) return;
    loadError.value =
      cause instanceof Error ? cause.message : "无法读取连接配置，请重试";
  } finally {
    if (mounted) loading.value = false;
  }
}

async function submit(mode: "test" | "save") {
  if (busy.value || loadError.value) return;
  const fields = {
    url: joinConnectionAddress(address.value, port.value),
    username: username.value.trim(),
    password: password.value,
  };
  error.value =
    connectionEndpointError(address.value, port.value) ||
    connectionValidationError(saved.value, fields);
  testedVersion.value = "";
  if (error.value) return;
  action.value = mode;
  try {
    const effectivePassword =
      fields.password || (retainPassword.value ? await readSavedPassword(fields.username) : "");
    const auth = await authenticate(
      fields.url,
      fields.username,
      effectivePassword,
    );
    if (!mounted) return;
    if (mode === "test") {
      testedVersion.value = auth.version;
    } else {
      await writeConnection(fields);
      adoptSession(fields.url, fields.username, auth.sid, effectivePassword);
      password.value = "";
      emit("saved");
    }
  } catch (cause) {
    if (mounted)
      error.value =
        cause instanceof Error ? cause.message : "连接失败，请检查配置后重试";
  } finally {
    if (mounted) action.value = null;
  }
}

onMounted(load);
onBeforeUnmount(() => {
  mounted = false;
  password.value = "";
});
</script>

<template>
  <ModalShell
    title="连接 qBittorrent"
    description="配置本机直连的 qBittorrent 实例。地址须能从这台设备访问。"
    @close="!busy && emit('close')"
  >
    <div class="connection-panel" :aria-busy="busy">
      <p v-if="loading" class="connection-loading muted" role="status">
        <Icon name="loading" class="spin" :size="18" />正在读取连接配置…
      </p>
      <div v-else-if="loadError" class="connection-load-error">
        <p class="form-error" role="alert">{{ loadError }}</p>
        <button class="button quiet" type="button" @click="load">重试</button>
      </div>
      <form v-else autocomplete="off" @submit.prevent="submit('save')">
        <div class="login-server-row">
          <label class="field" :for="`${id}-address`">
            服务器地址
            <input
              :id="`${id}-address`"
              v-model="address"
              type="text"
              inputmode="url"
              placeholder="192.168.1.10"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              :disabled="busy"
              required
            />
          </label>
          <label class="field" :for="`${id}-port`">
            端口
            <input
              :id="`${id}-port`"
              v-model="port"
              type="text"
              inputmode="numeric"
              placeholder="8080"
              autocomplete="off"
              :disabled="busy"
              required
            />
          </label>
        </div>
        <label class="field" :for="`${id}-username`">
          用户名
          <input
            :id="`${id}-username`"
            v-model="username"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :disabled="busy"
            required
          />
        </label>
        <label class="field" :for="`${id}-password`">
          密码
          <input
            :id="`${id}-password`"
            v-model="password"
            type="password"
            autocomplete="off"
            data-lpignore="true"
            data-1p-ignore
            :placeholder="
              retainPassword ? '留空沿用已保存密码' : '输入 qBittorrent 密码'
            "
            :aria-describedby="`${id}-password-hint`"
            :disabled="busy"
            :required="!retainPassword"
          />
          <small :id="`${id}-password-hint`">{{
            retainPassword
              ? "已保存密码；地址和用户名不变时可留空。密码保存在本机系统安全存储中。"
              : "更改地址或用户名后需要重新输入密码。密码保存在本机系统安全存储中。"
          }}</small>
        </label>
        <p v-if="error" class="form-error" role="alert">
          <Icon name="alert" :size="17" />{{ error }}
        </p>
        <p v-if="testedVersion" class="connection-test-result" role="status">
          <Icon name="check" :size="17" />连接成功 · qBittorrent
          {{ testedVersion }}
        </p>
        <footer class="modal-footer connection-actions">
          <button
            class="button quiet"
            type="button"
            :disabled="busy"
            @click="emit('close')"
          >
            取消
          </button>
          <button
            class="button quiet"
            type="button"
            :disabled="busy"
            @click="submit('test')"
          >
            <Icon
              v-if="action === 'test'"
              name="loading"
              class="spin"
              :size="17"
            />{{ action === "test" ? "正在测试…" : "测试连接" }}
          </button>
          <button class="button primary" type="submit" :disabled="busy">
            <Icon
              v-if="action === 'save'"
              name="loading"
              class="spin"
              :size="17"
            />{{ action === "save" ? "正在保存…" : "保存连接" }}
          </button>
        </footer>
      </form>
    </div>
  </ModalShell>
</template>
