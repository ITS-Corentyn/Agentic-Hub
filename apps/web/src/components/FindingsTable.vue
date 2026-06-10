<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Finding, Severity } from '../api';
import { SEVERITY_LABELS } from '../lib/ui';
import SeverityBadge from './SeverityBadge.vue';

const props = defineProps<{ findings: Finding[] }>();
const expanded = ref<Set<string>>(new Set());
const sevFilter = ref<Severity | 'all'>('all');

const ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const filtered = computed(() => {
  const list =
    sevFilter.value === 'all' ? props.findings : props.findings.filter((f) => f.severity === sevFilter.value);
  return [...list].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
});

function toggle(id: string) {
  const s = new Set(expanded.value);
  s.has(id) ? s.delete(id) : s.add(id);
  expanded.value = s;
}
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap gap-2">
      <button
        :class="['rounded-full border px-3 py-1 text-xs', sevFilter === 'all' ? 'border-brand-500 text-white' : 'border-white/10 text-slate-400']"
        @click="sevFilter = 'all'"
      >
        Tout ({{ findings.length }})
      </button>
      <button
        v-for="s in ORDER"
        :key="s"
        :class="['rounded-full border px-3 py-1 text-xs', sevFilter === s ? 'border-brand-500 text-white' : 'border-white/10 text-slate-400']"
        @click="sevFilter = s"
      >
        {{ SEVERITY_LABELS[s] }} ({{ findings.filter((f) => f.severity === s).length }})
      </button>
    </div>

    <p v-if="!filtered.length" class="rounded-lg border border-white/5 bg-white/5 p-4 text-sm text-slate-400">
      Aucun problème pour ce filtre. 🎉
    </p>

    <ul class="space-y-2">
      <li v-for="f in filtered" :key="f.id" class="card overflow-hidden">
        <button class="flex w-full items-center gap-3 p-3 text-left" @click="toggle(f.id)">
          <SeverityBadge :severity="f.severity" />
          <span class="min-w-0 flex-1 truncate text-sm">{{ f.title }}</span>
          <code v-if="f.filePath" class="hidden max-w-[40%] truncate text-[11px] text-slate-400 sm:block">
            {{ f.filePath }}{{ f.line ? `:${f.line}` : '' }}
          </code>
          <span class="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{{ f.tool }}</span>
        </button>

        <div v-if="expanded.has(f.id)" class="border-t border-white/5 bg-black/20 p-4 text-sm">
          <p v-if="f.description" class="mb-2 text-slate-300">{{ f.description }}</p>
          <p v-if="f.ruleId" class="mb-2 text-xs text-slate-500">Règle : <code>{{ f.ruleId }}</code></p>
          <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p class="mb-1 text-xs font-semibold text-emerald-300">✅ Correctif recommandé</p>
            <p class="text-sm text-slate-200">{{ f.remediation || 'Voir la référence.' }}</p>
          </div>
          <a v-if="f.reference" :href="f.reference" target="_blank" class="mt-2 inline-block text-xs text-brand-400 hover:underline">
            Référence ↗
          </a>
        </div>
      </li>
    </ul>
  </div>
</template>
