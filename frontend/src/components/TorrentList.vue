<script setup lang="ts">
import { TransitionGroup } from "vue";
import Icon from "./Icon.vue";
import TorrentOperations from "./TorrentOperations.vue";
import { bytes, speed, percent, duration } from "../lib/format";
import { statusOf } from "../lib/torrents";
import type { Torrent } from "../lib/types";
defineProps<{
  torrents: Torrent[];
  selected: string[];
  selecting: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  open: [torrent: Torrent];
  changed: [];
  notice: [message: string];
  remove: [hashes: string[]];
  select: [hash: string];
  action: [action: "start" | "stop", hashes: string[]];
  contextmenu: [payload: { torrent: Torrent; x: number; y: number }];
}>();
function fileIcon(t: Torrent) {
  return /\.(iso|exe|dmg|appimage)$/i.test(t.name)
    ? "box"
    : t.category === "影视"
      ? "video"
      : t.category === "音乐"
        ? "music"
        : t.category === "资料"
          ? "archive"
          : "file";
}
</script>
<template>
  <div class="torrent-table" role="table" aria-label="下载任务">
    <div class="torrent-head" role="row">
      <span role="columnheader">名称</span
      ><span role="columnheader">状态 / 进度</span
      ><span role="columnheader">大小</span
      ><span role="columnheader">下载速度</span
      ><span role="columnheader">上传速度</span
      ><span role="columnheader" class="sr-only">操作</span>
    </div>
    <TransitionGroup v-if="torrents.length" name="list">
      <div
        v-for="torrent in torrents"
        :key="torrent.hash"
        class="torrent-row"
        :class="{ 'is-selected': selected.includes(torrent.hash) }"
        role="row"
        @contextmenu.prevent="
          emit('contextmenu', {
            torrent,
            x: $event.clientX,
            y: $event.clientY,
          })
        "
      >
      <div class="torrent-name-cell" role="cell">
        <button
          v-if="selecting"
          class="check-control"
          :class="{ checked: selected.includes(torrent.hash) }"
          :aria-label="'选择 ' + torrent.name"
          :aria-pressed="selected.includes(torrent.hash)"
          @click="emit('select', torrent.hash)"
        >
          <span
            ><Icon
              v-if="selected.includes(torrent.hash)"
              name="check"
              :size="14"
          /></span>
        </button>
        <div v-else class="file-symbol" :class="fileIcon(torrent)">
          <Icon :name="fileIcon(torrent)" :size="22" />
        </div>
        <button
          class="torrent-name-button"
          @click="
            selecting ? emit('select', torrent.hash) : emit('open', torrent)
          "
        >
          <strong class="selectable">{{ torrent.name }}</strong
          ><span
            >{{ torrent.category || "未分类" }} <span class="name-dot">·</span>
            {{ torrent.num_seeds || 0 }} 个种子<span
              v-if="torrent.tags"
              class="torrent-tags"
            >
              <span class="name-dot">·</span>
              {{ torrent.tags.split(",")[0] }}</span
            ></span
          >
        </button>
      </div>
      <div class="torrent-progress-cell" role="cell">
        <div class="progress-label">
          <span class="status" :class="statusOf(torrent.state).tone"
            ><i></i>{{ statusOf(torrent.state).label }}</span
          ><span class="tabular">{{ percent(torrent.progress) }}</span>
        </div>
        <span class="desktop-eta">{{
          torrent.progress >= 1
            ? "分享率 " + torrent.ratio.toFixed(2)
            : torrent.dlspeed > 0
              ? "剩余 " + duration(torrent.eta)
              : "等待继续"
        }}</span>
        <div
          class="progress-track"
          role="progressbar"
          :aria-label="torrent.name + ' 下载进度'"
          :aria-valuenow="Math.round(torrent.progress * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span
            :class="statusOf(torrent.state).tone"
            :style="{ width: percent(torrent.progress) }"
          ></span>
        </div>
      </div>
      <span class="torrent-size tabular" role="cell">{{
        bytes(torrent.size)
      }}</span>
      <span
        class="torrent-down tabular"
        :class="{ active: torrent.dlspeed > 0 }"
        role="cell"
        ><Icon class="mobile-only" name="down" :size="14" />{{
          torrent.dlspeed > 0 ? speed(torrent.dlspeed) : "—"
        }}</span
      >
      <span
        class="torrent-up tabular"
        :class="{ active: torrent.upspeed > 0 }"
        role="cell"
        ><Icon class="mobile-only" name="up" :size="14" />{{
          torrent.upspeed > 0 ? speed(torrent.upspeed) : "—"
        }}</span
      >
      <div class="torrent-actions" role="cell">
        <button
          class="icon-button row-action"
          :disabled="busy"
          :aria-label="
            (statusOf(torrent.state).key === 'paused' ? '继续 ' : '暂停 ') +
            torrent.name
          "
          :title="statusOf(torrent.state).key === 'paused' ? '继续' : '暂停'"
          @click="
            emit(
              'action',
              statusOf(torrent.state).key === 'paused' ? 'start' : 'stop',
              [torrent.hash],
            )
          "
        >
          <Icon
            :name="statusOf(torrent.state).key === 'paused' ? 'play' : 'pause'"
            :size="18"
          />
        </button>
        <TorrentOperations
          :hashes="[torrent.hash]"
          :torrent="torrent"
          :disabled="busy"
          :menu-label="'操作 ' + torrent.name"
          @changed="emit('changed')"
          @notice="emit('notice', $event)"
          @remove="emit('remove', $event)"
        />
      </div>
      <span class="torrent-eta muted">{{
        torrent.progress >= 1
          ? "分享率 " + torrent.ratio.toFixed(2)
          : torrent.dlspeed > 0
            ? "剩余 " + duration(torrent.eta)
            : "等待继续"
      }}</span>
    </div>
    </TransitionGroup>
  </div>
</template>
