<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import gsap from 'gsap';
import { scoreColor } from '../lib/ui';

const props = withDefaults(defineProps<{ score: number; size?: number; label?: string }>(), {
  size: 140,
  label: '',
});

const display = ref(0); // valeur animée
const radius = computed(() => props.size / 2 - 10);
const circumference = computed(() => 2 * Math.PI * radius.value);
const dash = computed(() => (display.value / 100) * circumference.value);
const color = computed(() => scoreColor(display.value));

function animate(to: number) {
  gsap.to(display, { value: to, duration: 1.1, ease: 'power2.out' });
}

onMounted(() => animate(props.score));
watch(
  () => props.score,
  (v) => animate(v),
);
</script>

<template>
  <div class="relative grid place-items-center" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" class="-rotate-90">
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        stroke-width="10"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        :stroke="color"
        stroke-width="10"
        stroke-linecap="round"
        :stroke-dasharray="`${dash} ${circumference}`"
        :style="{ transition: 'stroke 0.3s' }"
      />
    </svg>
    <div class="absolute text-center">
      <div class="text-2xl font-bold tabular-nums" :style="{ color }">{{ Math.round(display) }}</div>
      <div class="text-[10px] uppercase tracking-wide text-slate-400">{{ label || '/ 100' }}</div>
    </div>
  </div>
</template>
