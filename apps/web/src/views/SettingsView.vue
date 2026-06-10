<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type Dimension } from '../api';
import { DIMENSION_LABELS } from '../lib/ui';

const DIMS: Dimension[] = [
  'security',
  'dependencies',
  'quality',
  'architecture',
  'backend',
  'frontend',
  'performance',
];

const weights = ref<Record<string, number>>({});
const locBaseline = ref(2000);
const saved = ref(false);
const error = ref('');

async function load() {
  try {
    const { scoring } = await api.getSettings();
    weights.value = { ...scoring.weights };
    locBaseline.value = scoring.locBaseline ?? 2000;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function save() {
  saved.value = false;
  error.value = '';
  try {
    await api.saveSettings({ weights: weights.value, locBaseline: Number(locBaseline.value) });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(load);
</script>

<template>
  <section class="mx-auto max-w-2xl">
    <h1 class="text-2xl font-bold">Réglages</h1>
    <p class="mb-6 text-sm text-slate-400">Pondération des dimensions dans le score global (relatif).</p>

    <div class="card space-y-4 p-6">
      <div v-for="d in DIMS" :key="d" class="flex items-center gap-4">
        <label class="w-32 text-sm">{{ DIMENSION_LABELS[d] }}</label>
        <input
          v-model.number="weights[d]"
          type="range"
          min="0"
          max="40"
          class="flex-1 accent-brand-500"
        />
        <span class="w-10 text-right text-sm tabular-nums">{{ weights[d] }}</span>
      </div>

      <div class="flex items-center gap-4 border-t border-white/5 pt-4">
        <label class="w-32 text-sm">Baseline LOC</label>
        <input
          v-model.number="locBaseline"
          type="number"
          class="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button class="btn-primary" @click="save">Enregistrer</button>
        <span v-if="saved" class="text-sm text-emerald-400">✔ Enregistré</span>
        <span v-if="error" class="text-sm text-red-400">{{ error }}</span>
      </div>
    </div>

    <p class="mt-4 text-xs text-slate-500">
      Le scoring est déterministe : <code>score = 100 − pénalités pondérées par sévérité</code>,
      normalisé par la taille du code (baseline LOC). Aucune clé API requise.
    </p>
  </section>
</template>
