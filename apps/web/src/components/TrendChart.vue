<script setup lang="ts">
import { computed } from 'vue';
import { scoreColor } from '../lib/ui';

const props = withDefaults(
  defineProps<{ points: { date: string; score: number }[]; width?: number; height?: number }>(),
  { width: 520, height: 120 },
);

const pad = 8;
const W = computed(() => props.width);
const H = computed(() => props.height);

const coords = computed(() => {
  const pts = props.points;
  if (!pts.length) return [];
  const n = pts.length;
  const xStep = n > 1 ? (W.value - pad * 2) / (n - 1) : 0;
  return pts.map((p, i) => {
    const x = pad + i * xStep;
    const y = pad + (1 - Math.max(0, Math.min(100, p.score)) / 100) * (H.value - pad * 2);
    return { x, y, score: p.score };
  });
});

const linePath = computed(() => coords.value.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' '));
const areaPath = computed(() => {
  if (!coords.value.length) return '';
  const first = coords.value[0]!;
  const last = coords.value[coords.value.length - 1]!;
  return `${linePath.value} L ${last.x.toFixed(1)} ${H.value - pad} L ${first.x.toFixed(1)} ${H.value - pad} Z`;
});
const lastColor = computed(() => scoreColor(props.points.at(-1)?.score ?? 0));

// Description textuelle pour lecteurs d'écran (le SVG seul est inaccessible).
const ariaLabel = computed(() => {
  const pts = props.points;
  if (pts.length < 2) return 'Graphique de tendance du score (données insuffisantes)';
  const first = Math.round(pts[0]!.score);
  const last = Math.round(pts.at(-1)!.score);
  const trend = last > first ? 'en hausse' : last < first ? 'en baisse' : 'stable';
  return `Évolution du score sur ${pts.length} audits : de ${first} à ${last} sur 100 (${trend}).`;
});
</script>

<template>
  <div>
    <svg v-if="coords.length > 1" :viewBox="`0 0 ${W} ${H}`" class="w-full" :style="{ height: `${H}px` }" role="img" :aria-label="ariaLabel">
      <title>{{ ariaLabel }}</title>
      <defs>
        <linearGradient :id="'tg'" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="lastColor" stop-opacity="0.35" />
          <stop offset="100%" :stop-color="lastColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      <!-- lignes de reference 50 / 90 -->
      <line :x1="pad" :x2="W - pad" :y1="pad + 0.1 * (H - pad * 2)" :y2="pad + 0.1 * (H - pad * 2)" stroke="rgba(255,255,255,0.06)" />
      <line :x1="pad" :x2="W - pad" :y1="pad + 0.5 * (H - pad * 2)" :y2="pad + 0.5 * (H - pad * 2)" stroke="rgba(255,255,255,0.06)" />
      <path :d="areaPath" :fill="`url(#tg)`" />
      <path :d="linePath" fill="none" :stroke="lastColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      <circle v-for="(c, i) in coords" :key="i" :cx="c.x" :cy="c.y" r="3" :fill="lastColor" />
    </svg>
    <p v-else class="py-6 text-center text-xs text-slate-500">
      Pas assez d'audits pour une tendance (il en faut au moins 2).
    </p>
  </div>
</template>
