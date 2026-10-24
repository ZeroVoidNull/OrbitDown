<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, useId } from "vue";
import Icon from "./Icon.vue";
import { pushModal, popModal, topModal } from "../lib/modal";
const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    wide?: boolean;
    drawer?: boolean;
    /** 内嵌页面模式：作为主区域页面渲染，无遮罩与焦点陷阱。 */
    embedded?: boolean;
  }>(),
  { wide: false, drawer: false, embedded: false },
);
const emit = defineEmits<{ close: [] }>();
const root = ref<HTMLElement>(),
  id = useId();
let previous: Element | null = null;
function keyboard(event: KeyboardEvent) {
  if (!root.value || !topModal(root.value)) return;
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
  }
  if (event.key === "Tab") {
    const focusable = [
      ...root.value.querySelectorAll<HTMLElement>(
        'button:enabled,a[href],input:enabled,select:enabled,textarea:enabled,[tabindex="0"]:not([aria-disabled="true"])',
      ),
    ].filter((el) => el.getClientRects().length > 0);
    const first = focusable[0],
      last = focusable.at(-1);
    if (!first) {
      event.preventDefault();
      root.value.focus();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === root.value)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
onMounted(() => {
  if (props.embedded) return; // 内嵌页面无对话框焦点管理
  previous = document.activeElement;
  if (root.value) {
    pushModal(root.value);
    (
      root.value.querySelector<HTMLElement>("[autofocus]") || root.value
    ).focus();
  }
  document.addEventListener("keydown", keyboard);
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", keyboard);
  if (props.embedded) return;
  if (root.value) popModal(root.value);
  if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
});
</script>
<template>
  <!-- 内嵌页面：直接渲染为内容区块 -->
  <section
    v-if="embedded"
    ref="root"
    class="modal glass page-panel"
    :class="{ wide }"
    :aria-labelledby="id"
    :aria-describedby="description ? id + '-description' : undefined"
  >
    <header class="modal-heading">
      <div>
        <h2 :id="id">{{ title }}</h2>
        <p v-if="description" :id="id + '-description'" class="muted">
          {{ description }}
        </p>
      </div>
      <slot name="actions" />
    </header>
    <slot />
  </section>
  <Teleport v-else to="body"
    ><div
      class="modal-backdrop"
      :class="{ drawer }"
      @click.self="emit('close')"
    >
      <section
        ref="root"
        class="modal glass"
        :class="{ wide }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="id"
        :aria-describedby="description ? id + '-description' : undefined"
        tabindex="-1"
      >
        <header class="modal-heading">
          <div>
            <h2 :id="id">{{ title }}</h2>
            <p v-if="description" :id="id + '-description'" class="muted">
              {{ description }}
            </p>
          </div>
          <button
            class="icon-button quiet"
            aria-label="关闭对话框"
            @click="emit('close')"
          >
            <Icon name="close" />
          </button>
        </header>
        <slot />
      </section></div
  ></Teleport>
</template>
