<script setup lang="ts">
import { computed, ref, useId } from "vue";
import CapsuleSelect from "./CapsuleSelect.vue";
import Icon from "./Icon.vue";
import { apiValue, displayValue, type FieldSpec } from "../lib/preferences";
const props = defineProps<{
  field: FieldSpec;
  modelValue: unknown;
  baseline: unknown;
  configured?: boolean;
  disabled?: boolean;
  clearValue?: boolean;
  suggestions?: { value: string; label: string }[];
}>();
const emit = defineEmits<{
  "update:modelValue": [value: unknown];
  clear: [value: boolean];
}>();
const fieldId = `pref-${useId()}`;
const hintId = `${fieldId}-hint`;
const folderModes = [
  { value: "1", label: "默认保存目录" },
  { value: "0", label: "监控目录" },
  { value: "custom", label: "自定义目录" },
];
const locked = computed(() => props.disabled || props.field.readonly);
const suggestionOptions = computed(() => {
  const items = [...(props.suggestions || [])];
  if (!items.some((item) => item.value === String(props.modelValue)))
    items.unshift({
      value: String(props.modelValue),
      label: String(props.modelValue || "任意"),
    });
  return items;
});
const revealed = ref(false),
  objectText = ref(JSON.stringify(props.modelValue, null, 2)),
  jsonError = ref("");
const rows = ref<{ path: string; mode: string; destination: string }[]>(
  Object.entries(
    (props.modelValue && typeof props.modelValue === "object"
      ? props.modelValue
      : {}) as Record<string, unknown>,
  ).map(([path, value]) => ({
    path,
    mode: value === 0 ? "0" : value === 1 ? "1" : "custom",
    destination: typeof value === "string" ? value : "",
  })),
);
const options = computed(() => {
  const options = [...(props.field.options || [])];
  if (
    !options.some((option) => String(option.value) === String(props.modelValue))
  )
    options.push({
      value: String(props.modelValue),
      label: String(props.modelValue),
    });
  return options;
});
const value = computed(() => displayValue(props.modelValue, props.field));
function selected(value: string) {
  emit("update:modelValue", apiValue(value, props.field, props.baseline));
}
function changed(event: Event) {
  selected((event.target as HTMLInputElement).value);
}
function folders() {
  const values: Record<string, string | number> = Object.create(null);
  for (const row of rows.value) {
    if (row.path.trim())
      values[row.path.trim()] =
        row.mode === "custom" ? row.destination : Number(row.mode);
  }
  emit("update:modelValue", values);
}
function structured(event: Event) {
  objectText.value = (event.target as HTMLTextAreaElement).value;
  try {
    const object = JSON.parse(objectText.value);
    if (typeof object !== "object" || object === null) throw new Error();
    emit("update:modelValue", object);
    jsonError.value = "";
  } catch {
    jsonError.value = "请输入有效的对象或数组";
  }
}
</script>
<template>
  <div
    class="preference-row"
    :class="{
      'preference-toggle': field.type === 'boolean',
      'preference-readonly': field.readonly,
    }"
  >
    <label v-if="field.type === 'boolean'" class="preference-checkbox"
      ><span
        ><strong>{{ field.label }}</strong
        ><small v-if="field.hint" :id="hintId">{{ field.hint }}</small></span
      ><input
        :id="fieldId"
        class="capsule-switch"
        type="checkbox"
        role="switch"
        :aria-describedby="field.hint ? hintId : undefined"
        :checked="!!modelValue"
        :disabled="locked"
        @change="
          emit('update:modelValue', ($event.target as HTMLInputElement).checked)
        "
    /></label>
    <template v-else>
      <label :for="fieldId" class="preference-label"
        >{{ field.label }}
        <span v-if="field.readonly" class="muted">（只读）</span></label
      >
      <div class="preference-control">
        <template v-if="field.secret"
          ><div class="secret-control">
            <input
              :id="fieldId"
            :aria-describedby="field.hint ? hintId : undefined"
              :type="revealed ? 'text' : 'password'"
              :value="modelValue as string"
              :placeholder="configured ? '已设置；留空保留原值' : '未设置'"
              autocomplete="new-password"
              :disabled="locked || clearValue"
              @input="changed"
            /><button
              class="icon-button"
              type="button"
              :disabled="locked || clearValue"
              :aria-label="revealed ? '隐藏输入的密码' : '显示输入的密码'"
              @click="revealed = !revealed"
            >
              <Icon :name="revealed ? 'shield' : 'info'" :size="17" />
            </button>
          </div>
          <label
            v-if="!field.readonly && field.key !== 'web_ui_password'"
            class="clear-secret"
            ><input
              :checked="clearValue"
              class="capsule-switch"
              role="switch"
              type="checkbox"
              :disabled="locked"
              @change="emit('clear', ($event.target as HTMLInputElement).checked)"
            />清除已保存值</label
          ></template
        >
        <CapsuleSelect
          v-else-if="field.type === 'enum' && field.options?.length"
          :id="fieldId"
          :model-value="String(modelValue)"
          :options="options"
          :disabled="locked"
          :describedby="field.hint ? hintId : undefined"
          @update:model-value="selected"
        />
        <CapsuleSelect
          v-else-if="suggestions?.length"
          :id="fieldId"
          :model-value="String(modelValue)"
          :options="suggestionOptions"
          :disabled="locked"
          :describedby="field.hint ? hintId : undefined"
          @update:model-value="selected"
        />
        <textarea
          v-else-if="field.type === 'textarea'"
          :id="fieldId"
          :aria-describedby="field.hint ? hintId : undefined"
          :value="modelValue as string"
          :disabled="locked"
          rows="3"
          @input="changed"
        />
        <div v-else-if="field.type === 'folders'" class="watched-folders">
          <div v-for="(row, index) in rows" :key="index" class="watched-folder">
            <label
              ><span class="sr-only">监控目录 {{ index + 1 }}</span
              ><input
                :id="index === 0 ? fieldId : undefined"
                v-model="row.path"
                placeholder="监控目录"
                :disabled="locked"
                @input="folders" /></label
            ><CapsuleSelect
              :model-value="row.mode"
              :options="folderModes"
              :aria-label="'保存位置 ' + (index + 1)"
              :disabled="locked"
              @update:model-value="row.mode = $event; folders()"
            /><input
              v-if="row.mode === 'custom'"
              v-model="row.destination"
              aria-label="自定义保存目录"
              placeholder="保存目录"
              :disabled="locked"
              @input="folders"
            /><button
              class="icon-button danger"
              type="button"
              :aria-label="'移除监控目录 ' + (index + 1)"
              :disabled="locked"
              @click="
                rows.splice(index, 1);
                folders();
              "
            >
              <Icon name="trash" :size="17" />
            </button>
          </div>
          <button
            type="button"
            class="button quiet"
            :disabled="locked"
            @click="rows.push({ path: '', mode: '1', destination: '' })"
          >
            <Icon name="plus" :size="16" />添加监控目录
          </button>
      </div>
      <template v-else-if="field.type === 'object' || field.type === 'array'">
        <textarea
          :id="fieldId"
            :aria-describedby="field.hint ? hintId : undefined"
          :value="objectText"
          rows="4"
          :disabled="locked"
          @input="structured"
        /><small v-if="jsonError" class="danger">{{
          jsonError
        }}</small></template
      >
      <div v-else class="preference-input">
        <input
          :id="fieldId"
            :aria-describedby="field.hint ? hintId : undefined"
          :type="field.type === 'number' ? 'number' : 'text'"
          :value="value as string | number"
          :min="
            field.type === 'number'
              ? Math.min(
                  field.min ?? -1,
                  Number(displayValue(baseline, field)) || 0,
                )
              : undefined
          "
          :max="field.max"
          :step="field.step || 1"
          :disabled="locked"
          @input="changed"
        /><span v-if="field.unit">{{ field.unit }}</span>
      </div>
      <small v-if="field.hint" :id="hintId" class="preference-hint">{{ field.hint }}</small>
      </div>
    </template>
  </div>
</template>
