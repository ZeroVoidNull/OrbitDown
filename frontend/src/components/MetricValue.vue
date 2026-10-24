<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{ value: string }>();

// 数值滚动：解析「数值 + 单位」并对数值部分做短促缓动。
// reduced-motion 偏好下直接切换（全局 CSS 不覆盖 JS 驱动的变化）。
const display = ref(props.value);
const parts = computed(() => {
  const [number, ...unit] = display.value.split(" ");
  return { number, unit: unit.join(" ") };
});

const reduceMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function parse(text: string) {
  const match = /^(-?[\d.]+)(.*)$/.exec(text.trim());
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const decimals = (match[1]!.split(".")[1] || "").length;
  return { number, decimals, rest: match[2] || "" };
}

let frame = 0;
watch(
  () => props.value,
  (next, previous) => {
    cancelAnimationFrame(frame);
    const to = parse(next);
    const from = parse(previous ?? "");
    if (reduceMotion || !to || !from) {
      display.value = next;
      return;
    }
    const start = performance.now(),
      duration = 320,
      distance = to.number - from.number;
    if (Math.abs(distance) < Math.pow(10, -to.decimals) / 2) {
      display.value = next;
      return;
    }
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = from.number + distance * eased;
      display.value = `${value.toFixed(to.decimals)}${to.rest}`;
      if (progress < 1) frame = requestAnimationFrame(tick);
      else display.value = next;
    };
    frame = requestAnimationFrame(tick);
  },
);
onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>

<template>
  <span class="metric-reading">
    <span class="metric-number">{{ parts.number }}</span>
    <small v-if="parts.unit" class="metric-unit"> {{ parts.unit }}</small>
  </span>
</template>
