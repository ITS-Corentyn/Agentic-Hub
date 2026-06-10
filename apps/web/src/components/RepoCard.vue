<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { RepoSummary } from '../api';
import { scoreColor, statusLabel, timeAgo } from '../lib/ui';
import ScoreGauge from './ScoreGauge.vue';

const props = defineProps<{ repo: RepoSummary; busy?: boolean }>();
const emit = defineEmits<{ audit: [id: string] }>();
const router = useRouter();

const last = computed(() => props.repo.audits[0] ?? null);
const score = computed(() => last.value?.globalScore ?? null);

function open() {
  if (last.value) router.push({ name: 'repo', params: { id: props.repo.id } });
}
</script>

<template>
  <div class="card group flex flex-col gap-4 p-5 transition hover:border-brand-500/40">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate font-semibold">{{ repo.name }}</p>
        <p class="truncate text-xs text-slate-400">{{ repo.fullName }}</p>
        <p v-if="repo.language" class="mt-1 inline-block rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
          {{ repo.language }}
        </p>
      </div>
      <ScoreGauge v-if="score !== null" :score="score" :size="84" />
      <div v-else class="grid h-[84px] w-[84px] place-items-center rounded-full border border-dashed border-white/10 text-[11px] text-slate-500">
        non audité
      </div>
    </div>

    <p class="line-clamp-2 min-h-[2.5rem] text-xs text-slate-400">{{ repo.description || '—' }}</p>

    <div class="flex items-center justify-between text-[11px] text-slate-400">
      <span v-if="last">
        <span :style="{ color: scoreColor(score ?? 0) }">●</span>
        {{ statusLabel(last.status) }} · {{ timeAgo(repo.lastAuditAt) }}
      </span>
      <span v-else>Aucun audit</span>
    </div>

    <div class="flex gap-2">
      <button class="btn-primary flex-1 justify-center" :disabled="busy" @click="emit('audit', repo.id)">
        <span v-if="busy">…</span>
        <span v-else>Auditer</span>
      </button>
      <button v-if="last" class="btn-ghost justify-center" @click="open">Rapport</button>
    </div>
  </div>
</template>
