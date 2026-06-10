<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { api } from './api';

const health = ref<{ hybridMode: boolean; ollama: boolean } | null>(null);
onMounted(async () => {
  try {
    health.value = await api.health();
  } catch {
    health.value = null;
  }
});
</script>

<template>
  <div class="min-h-full">
    <header class="sticky top-0 z-20 border-b border-white/5 bg-ink-950/70 backdrop-blur">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <RouterLink to="/" class="flex items-center gap-3">
          <div class="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 font-black text-white shadow-lg shadow-brand-500/30">
            A
          </div>
          <div>
            <p class="text-sm font-semibold leading-tight">Agentic-Hub</p>
            <p class="text-[11px] leading-tight text-slate-400">Audit Platform · open-source</p>
          </div>
        </RouterLink>

        <nav class="flex items-center gap-1 text-sm">
          <RouterLink to="/" class="rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5" active-class="text-white">
            Dashboard
          </RouterLink>
          <RouterLink to="/settings" class="rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5" active-class="text-white">
            Réglages
          </RouterLink>
          <span
            v-if="health"
            class="ml-2 rounded-full border border-white/10 px-3 py-1 text-[11px] text-slate-400"
          >
            {{ health.hybridMode ? 'Mode hybride' : 'Mode local' }}
            · LLM {{ health.ollama ? 'on' : 'off' }}
          </span>
        </nav>
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-6 py-8">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
  </div>
</template>
