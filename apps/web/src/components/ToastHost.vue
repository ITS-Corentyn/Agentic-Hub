<script setup lang="ts">
import { toasts } from '../lib/toast';

const COLOR = {
  info: 'border-white/10 bg-ink-800 text-slate-100',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  error: 'border-red-500/30 bg-red-500/10 text-red-200',
};
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-2" aria-live="polite">
      <TransitionGroup name="fade">
        <div
          v-for="t in toasts"
          :key="t.id"
          :class="['pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-xl', COLOR[t.type]]"
          role="status"
        >
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
