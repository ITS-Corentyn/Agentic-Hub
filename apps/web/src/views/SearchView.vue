<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, type Dimension, type Severity } from '../api';
import { DIMENSION_LABELS, SEVERITY_LABELS } from '../lib/ui';
import SeverityBadge from '../components/SeverityBadge.vue';

const router = useRouter();
const q = ref('');
const severity = ref<Severity | ''>('');
const dimension = ref<Dimension | ''>('');
const results = ref<Awaited<ReturnType<typeof api.searchFindings>>>([]);
const loading = ref(false);

const DIMS: Dimension[] = ['security', 'dependencies', 'quality', 'architecture', 'backend', 'frontend', 'performance'];
const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

let timer: ReturnType<typeof setTimeout> | null = null;
async function run() {
  loading.value = true;
  try {
    results.value = await api.searchFindings({
      q: q.value || undefined,
      severity: severity.value || undefined,
      dimension: dimension.value || undefined,
    });
  } finally {
    loading.value = false;
  }
}
function debounced() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, 250);
}

watch([severity, dimension], run);
onMounted(run);
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-2xl font-bold">Recherche globale</h1>
      <p class="text-sm text-slate-400">Tous les findings du dernier audit de chaque repo.</p>
    </div>

    <div class="flex flex-wrap gap-2">
      <input
        v-model="q"
        aria-label="Rechercher dans les findings (titre, fichier, règle)"
        placeholder="Titre, fichier, règle…"
        class="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500"
        @input="debounced"
      />
      <select v-model="severity" aria-label="Filtrer par sévérité" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
        <option value="">Toutes sévérités</option>
        <option v-for="s in SEVS" :key="s" :value="s">{{ SEVERITY_LABELS[s] }}</option>
      </select>
      <select v-model="dimension" aria-label="Filtrer par dimension" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
        <option value="">Toutes dimensions</option>
        <option v-for="d in DIMS" :key="d" :value="d">{{ DIMENSION_LABELS[d] }}</option>
      </select>
    </div>

    <p class="text-xs text-slate-400">{{ loading ? 'Recherche…' : `${results.length} résultat(s)` }}</p>

    <ul class="space-y-2">
      <li
        v-for="f in results"
        :key="f.id"
        role="link"
        tabindex="0"
        :aria-label="`Voir le rapport de ${f.repo?.fullName ?? 'ce repo'} : ${f.title}`"
        class="card flex cursor-pointer items-center gap-3 p-3 hover:border-brand-500/40"
        @click="f.repo && router.push({ name: 'repo', params: { id: f.repo.repoId } })"
        @keydown.enter="f.repo && router.push({ name: 'repo', params: { id: f.repo.repoId } })"
      >
        <SeverityBadge :severity="f.severity" />
        <span class="min-w-0 flex-1 truncate text-sm">{{ f.title }}</span>
        <code v-if="f.filePath" class="hidden max-w-[30%] truncate text-[11px] text-slate-400 md:block">
          {{ f.filePath }}{{ f.line ? `:${f.line}` : '' }}
        </code>
        <span class="truncate text-[11px] text-brand-300">{{ f.repo?.fullName }}</span>
        <span class="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{{ f.tool }}</span>
      </li>
    </ul>
  </section>
</template>
