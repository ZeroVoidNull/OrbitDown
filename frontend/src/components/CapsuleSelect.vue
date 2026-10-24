<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import Icon from "./Icon.vue";
import { findOptionByPrefix, nextOptionIndex } from "../lib/capsuleSelect";

const props = defineProps<{
  id?: string;
  modelValue: string;
  options: { value: string | number | boolean; label: string }[];
  disabled?: boolean;
  ariaLabel?: string;
  describedby?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const uniqueId = useId();
const triggerId = computed(() => props.id || `select-${uniqueId}`);
const listId = `select-list-${uniqueId}`;
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const open = ref(false);
const active = ref(-1);
const menuStyle = ref<Record<string, string>>({});
const selected = computed(() =>
  props.options.findIndex(
    (option) => String(option.value) === props.modelValue,
  ),
);
const label = computed(
  () => props.options[selected.value]?.label ?? props.modelValue,
);
let search = "";
let searchedAt = 0;

function positionMenu() {
  if (!trigger.value || !open.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const padding = 8;
  const below = window.innerHeight - rect.bottom - padding - 6;
  const above = rect.top - padding - 6;
  const upward = below < 160 && above > below;
  const height = Math.max(44, Math.min(280, upward ? above : below));
  const width = Math.min(rect.width, window.innerWidth - padding * 2);
  menuStyle.value = {
    left: `${Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding))}px`,
    top: upward ? "auto" : `${rect.bottom + 6}px`,
    bottom: upward ? `${window.innerHeight - rect.top + 6}px` : "auto",
    width: `${width}px`,
    maxHeight: `${height}px`,
  };
}
function trackPosition(track: boolean) {
  window[track ? "addEventListener" : "removeEventListener"](
    "resize",
    positionMenu,
  );
  window[track ? "addEventListener" : "removeEventListener"](
    "scroll",
    positionMenu,
    true,
  );
}
function reveal() {
  if (props.disabled || open.value) return;
  active.value = selected.value >= 0 ? selected.value : 0;
  search = "";
  open.value = true;
  positionMenu();
  menu.value?.showPopover?.();
  trackPosition(true);
  scrollActive();
}
function close() {
  menu.value?.hidePopover?.();
  open.value = false;
  trackPosition(false);
}
function toggle(event: Event) {
  const visible = (event as ToggleEvent).newState === "open";
  open.value = visible;
  if (!visible) trackPosition(false);
}
function choose(index: number) {
  const option = props.options[index];
  if (props.disabled || !option) return;
  emit("update:modelValue", String(option.value));
  close();
  trigger.value?.focus();
}
function scrollActive() {
  void nextTick(() =>
    menu.value
      ?.querySelector(`[data-option-index="${active.value}"]`)
      ?.scrollIntoView({ block: "nearest" }),
  );
}
function keydown(event: KeyboardEvent) {
  if (props.disabled) return;
  if (event.key === "Escape" && open.value) {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (event.key === "Tab") {
    close();
    return;
  }
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const wasOpen = open.value;
    reveal();
    if (wasOpen || event.key === "Home" || event.key === "End")
      active.value = nextOptionIndex(
        active.value,
        event.key,
        props.options.length,
      );
    scrollActive();
  } else if (
    event.key === "Enter" ||
    (event.key === " " && (!search || Date.now() - searchedAt > 700))
  ) {
    event.preventDefault();
    if (open.value) choose(active.value);
    else reveal();
  } else if (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    reveal();
    const now = Date.now();
    search = now - searchedAt < 700 ? search + event.key : event.key;
    searchedAt = now;
    // Repeated letters cycle through matching options.
    const prefix = [...search].every((letter) => letter === search[0])
      ? search[0]!
      : search;
    const match = findOptionByPrefix(
      props.options.map((option) => option.label),
      prefix,
      active.value,
    );
    if (match >= 0) active.value = match;
    scrollActive();
  }
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close();
  },
);
watch(
  () => props.modelValue,
  () => {
    if (open.value) active.value = selected.value;
  },
);
onBeforeUnmount(() => trackPosition(false));
</script>

<template>
  <div class="capsule-select">
    <button
      :id="triggerId"
      ref="trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      aria-autocomplete="none"
      :aria-label="ariaLabel"
      :aria-describedby="describedby"
      :aria-controls="listId"
      :aria-expanded="open"
      :aria-activedescendant="
        open && active >= 0 ? `${listId}-${active}` : undefined
      "
      :disabled="disabled"
      class="capsule-select-trigger"
      @click="open ? close() : reveal()"
      @keydown="keydown"
    >
      <span>{{ label }}</span
      ><Icon name="chevronDown" :size="16" />
    </button>
    <div
      :id="listId"
      ref="menu"
      class="capsule-select-menu"
      popover="auto"
      role="listbox"
      :aria-labelledby="ariaLabel ? undefined : triggerId"
      :aria-label="ariaLabel"
      :data-open="open"
      :style="menuStyle"
      @toggle="toggle"
      @keydown="keydown"
      @mousedown.prevent
    >
      <div
        v-for="(option, index) in options"
        :id="`${listId}-${index}`"
        :key="String(option.value)"
        role="option"
        :aria-selected="String(option.value) === modelValue"
        :data-option-index="index"
        :class="{
          active: active === index,
          selected: String(option.value) === modelValue,
        }"
        class="capsule-select-option"
        @pointermove="active = index"
        @click.stop.prevent="choose(index)"
      >
        <span>{{ option.label }}</span
        ><Icon
          v-if="String(option.value) === modelValue"
          name="check"
          :size="16"
        />
      </div>
    </div>
  </div>
</template>
