<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
const appWindow = getCurrentWindow();
</script>

<template>
  <div class="traffic-dock" role="group" aria-label="窗口控制">
    <button
      class="window-control close"
      type="button"
      aria-label="关闭窗口"
      @click="() => appWindow.close()"
    >
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <path
          d="M3.2 3.2 L8.8 8.8 M8.8 3.2 L3.2 8.8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <button
      class="window-control minimize"
      type="button"
      aria-label="最小化窗口"
      @click="() => appWindow.minimize()"
    >
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <path
          d="M3 6 H9"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <button
      class="window-control maximize"
      type="button"
      aria-label="最大化或还原窗口"
      @click="() => appWindow.toggleMaximize()"
    >
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <rect
          x="3"
          y="3"
          width="6"
          height="6"
          rx="1.6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
        />
      </svg>
    </button>
  </div>
</template>
