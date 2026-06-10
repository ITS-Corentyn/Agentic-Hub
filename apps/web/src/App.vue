<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { api, type GithubStatus } from './api';

const health = ref<{ hybridMode: boolean; ollama: boolean } | null>(null);
const gh = ref<GithubStatus | null>(null);

async function refreshGithub() {
  try {
    gh.value = await api.githubStatus();
  } catch {
    gh.value = null;
  }
}

function login() {
  window.location.href = api.githubLoginUrl();
}

async function logout() {
  await api.githubLogout();
  await refreshGithub();
}

onMounted(async () => {
  try {
    health.value = await api.health();
  } catch {
    health.value = null;
  }
  await refreshGithub();
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

          <!-- Connexion GitHub -->
          <div class="ml-2 flex items-center gap-2">
            <template v-if="gh?.connected && gh.source === 'oauth'">
              <span class="flex items-center gap-2 rounded-full border border-white/10 py-1 pl-1 pr-3">
                <img v-if="gh.avatarUrl" :src="gh.avatarUrl" class="h-6 w-6 rounded-full" alt="" />
                <span class="text-[12px] text-slate-200">{{ gh.login }}</span>
              </span>
              <button class="text-[11px] text-slate-400 hover:text-white" @click="logout">Déconnexion</button>
            </template>

            <span
              v-else-if="gh?.connected && gh.source === 'pat'"
              class="rounded-full border border-emerald-500/30 px-3 py-1 text-[11px] text-emerald-300"
            >
              GitHub (token)
            </span>

            <button
              v-else
              class="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-white/15"
              :title="gh && gh.oauthConfigured === false ? 'OAuth non configuré (voir .env)' : ''"
              @click="login"
            >
              <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              Se connecter
            </button>
          </div>
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
