<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { RefreshCw } from '@lucide/vue';
import { api, type GithubStatus } from './api';
import { auth, loadAuth } from './lib/auth';
import { ROLE_LABELS } from './lib/ui';
import CommandPalette from './components/CommandPalette.vue';
import ToastHost from './components/ToastHost.vue';

const health = ref<{ hybridMode: boolean; ollama: boolean } | null>(null);
const gh = ref<GithubStatus | null>(null);
const updateAvailable = ref(false);
const palette = ref<InstanceType<typeof CommandPalette> | null>(null);

function login() {
  window.location.href = api.githubLoginUrl();
}
async function logout() {
  await api.logoutSession().catch(() => {});
  await loadAuth();
  window.location.href = '/';
}
async function disconnectData() {
  await api.githubLogout().catch(() => {});
  location.reload();
}

onMounted(async () => {
  await loadAuth();
  try {
    health.value = await api.health();
  } catch {
    health.value = null;
  }
  try {
    gh.value = await api.githubStatus();
  } catch {
    gh.value = null;
  }
  try {
    const v = await api.systemVersion();
    updateAvailable.value = v.updateAvailable;
  } catch {
    updateAvailable.value = false;
  }
});
</script>

<template>
  <!-- Écran de connexion -->
  <div v-if="auth.loaded && auth.needsLogin" class="grid min-h-full place-items-center px-6">
    <div class="card w-full max-w-sm p-8 text-center">
      <div class="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-brand-500 text-xl font-black text-white">A</div>
      <h1 class="text-xl font-bold">Agentic-Hub</h1>
      <p class="mt-1 mb-6 text-sm text-slate-400">Connecte-toi pour accéder à la plateforme.</p>
      <button class="btn-primary w-full justify-center" @click="login">Se connecter avec GitHub</button>
    </div>
  </div>

  <!-- Compte en attente -->
  <div v-else-if="auth.loaded && auth.isPending" class="grid min-h-full place-items-center px-6">
    <div class="card w-full max-w-sm p-8 text-center">
      <h1 class="text-lg font-bold">Compte en attente</h1>
      <p class="mt-2 text-sm text-slate-400">
        Ton compte (<b>{{ auth.user?.login }}</b>) doit être approuvé par un administrateur.
      </p>
      <button class="btn-ghost mt-5" @click="logout">Se déconnecter</button>
    </div>
  </div>

  <!-- Application -->
  <div v-else class="min-h-full">
    <header class="sticky top-0 z-20 border-b border-white/5 bg-ink-950/70 backdrop-blur">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <RouterLink to="/" class="flex items-center gap-3">
          <div class="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 font-black text-white shadow-lg shadow-brand-500/30">A</div>
          <div>
            <p class="text-sm font-semibold leading-tight">Agentic-Hub</p>
            <p class="text-[11px] leading-tight text-slate-400">Audit Platform · open-source</p>
          </div>
        </RouterLink>

        <nav class="flex items-center gap-1 text-sm">
          <RouterLink to="/" class="rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5" active-class="text-white">Dashboard</RouterLink>
          <RouterLink to="/search" class="rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5" active-class="text-white">Recherche</RouterLink>
          <RouterLink v-if="auth.isAdmin" to="/settings" class="rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5" active-class="text-white">Réglages</RouterLink>
          <RouterLink v-if="auth.isAdmin" to="/users" class="rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5" active-class="text-white">Utilisateurs</RouterLink>
          <button class="hidden rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 sm:block" title="Palette de commandes (Ctrl/Cmd+K)" aria-label="Ouvrir la palette de commandes (Ctrl ou Cmd + K)" @click="palette?.show()">⌘K</button>

          <span v-if="health" class="ml-2 hidden rounded-full border border-white/10 px-3 py-1 text-[11px] text-slate-400 md:inline">
            {{ health.hybridMode ? 'Hybride' : 'Local' }} · LLM {{ health.ollama ? 'on' : 'off' }}
          </span>

          <!-- Utilisateur connecté (RBAC) -->
          <div v-if="auth.authActive && auth.user" class="ml-2 flex items-center gap-2">
            <span class="flex items-center gap-2 rounded-full border border-white/10 py-1 pl-1 pr-3">
              <img v-if="auth.user.avatarUrl" :src="auth.user.avatarUrl" class="h-6 w-6 rounded-full" alt="" />
              <span class="text-[12px] text-slate-200">{{ auth.user.login }}</span>
              <span class="rounded bg-white/10 px-1.5 text-[10px] text-slate-300">{{ ROLE_LABELS[auth.user.role] ?? auth.user.role }}</span>
            </span>
            <button class="text-[11px] text-slate-400 hover:text-white" @click="logout">Déconnexion</button>
          </div>

          <!-- Mode mono-poste : connexion du compte de données -->
          <div v-else class="ml-2 flex items-center gap-2">
            <template v-if="gh?.connected && gh.source === 'oauth'">
              <span class="flex items-center gap-2 rounded-full border border-white/10 py-1 pl-1 pr-3">
                <img v-if="gh.avatarUrl" :src="gh.avatarUrl" class="h-6 w-6 rounded-full" alt="" />
                <span class="text-[12px] text-slate-200">{{ gh.login }}</span>
              </span>
              <button class="text-[11px] text-slate-400 hover:text-white" @click="disconnectData">Déconnexion</button>
            </template>
            <span v-else-if="gh?.connected && gh.source === 'pat'" class="rounded-full border border-emerald-500/30 px-3 py-1 text-[11px] text-emerald-300">GitHub (token)</span>
            <button v-else class="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-white/15" @click="login">Se connecter</button>
          </div>
        </nav>
      </div>
    </header>

    <div v-if="updateAvailable" class="flex items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-6 py-2 text-center text-sm text-amber-200" role="status">
      <RefreshCw class="h-4 w-4" /> Une mise à jour est disponible — lance <code>Update-Windows.cmd</code> / <code>Update-macOS.command</code>.
    </div>

    <main class="mx-auto max-w-7xl px-6 py-8">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <CommandPalette ref="palette" />
  </div>

  <ToastHost />
</template>
