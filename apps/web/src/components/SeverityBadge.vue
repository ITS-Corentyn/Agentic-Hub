<script setup lang="ts">
import { computed } from 'vue';
import type { Severity } from '../api';
import { SEVERITY_COLOR, SEVERITY_LABELS } from '../lib/ui';

const props = defineProps<{ severity: Severity; count?: number }>();
const cls = computed(() => SEVERITY_COLOR[props.severity]);
</script>

<template>
  <span :class="['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', cls]">
    {{ SEVERITY_LABELS[severity] }}
    <span v-if="count !== undefined" class="tabular-nums">· {{ count }}</span>
  </span>
</template>
