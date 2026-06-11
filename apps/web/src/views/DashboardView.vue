<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import gsap from 'gsap';
import { api, type RepoSummary } from '../api';
import { scoreColor } from '../lib/ui';
import { auth } from '../lib/auth';
import RepoCard from '../components/RepoCard.vue';
import Skeleton from '../components/Skeleton.vue';

const router = useRouter();
const repos = ref<RepoSummary[]>([]);
const overview = ref<Awaited<ReturnType<typeof api.getOverview>> | null>(null);
const loading = ref(true);

const SEVS = ['critical', 'high', 'medium', 'low', 'info'] as const;
const SEV_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-400',
  low: 'bg-sky-500',
  info: 'bg-slate-500',
};
const syncing = ref(false);
const busyId = ref<string | null>(null);
const error = ref('');
const search = ref('');
const grid = ref<HTMLElement | null>(null);

const filtered = computed(() =>
  repos.value.filter((r) => r.fullName.toLowerCase().includes(search.value.toLowerCase())),
);

const stats = computed(() => {
  const audited = repos.value.filter((r) => r.audits[0]?.globalScore != null);
  const avg = audited.length
    ? Math.round(audited.reduce((s, r) => s + (r.audits[0]!.globalScore ?? 0), 0) / audited.length)
    : 0;
  return { total: repos.value.length, audited: audited.length, avg };
});

async function load() {
  loading.value = true;
  try {
    repos.value = await api.listRepos();
    overview.value = await api.getOverview().catch(() => null);
    await nextTick();
    if (grid.value) {
      gsap.from(grid.value.children, {
        opacity: 0,
        y: 24,
        duration: 0.5,
        stagger: 0.05,
        ease: 'power2.out',
      });
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function sync() {
  syncing.value = true;
  error.value = '';
  try {
    await api.syncRepos();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    syncing.value = false;
  }
}

async function startAudit(repoId: string) {
  busyId.value = repoId;
  error.value = '';
  try {
    const { auditId } = await api.startAudit(repoId);
    router.push({ name: 'audit', params: { id: auditId } });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busyId.value = null;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Repositories</h1>
        <p class="text-sm text-slate-400">Audit complet : sécurité, dépendances, qualité, architecture, perf.</p>
      </div>
      <div class="flex gap-2">
        <input
          v-model="search"
          placeholder="Rechercher…"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <button v-if="auth.canWrite" class="btn-primary" :disabled="syncing" @click="sync">
          {{ syncing ? 'Synchronisation…' : 'Synchroniser GitHub' }}
        </button>
      </div>
    </div>

    <div class="mb-8 grid grid-cols-3 gap-4">
      <div class="card p-5">
        <p class="text-xs text-slate-400">Repositories</p>
        <p class="text-3xl font-bold">{{ stats.total }}</p>
      </div>
      <div class="card p-5">
        <p class="text-xs text-slate-400">Audités</p>
        <p class="text-3xl font-bold">{{ stats.audited }}</p>
      </div>
      <div class="card p-5">
        <p class="text-xs text-slate-400">Score moyen</p>
        <p class="text-3xl font-bold">{{ stats.avg }}<span class="text-base text-slate-500">/100</span></p>
      </div>
    </div>

    <!-- Vue d'ensemble (organisation) -->
    <div v-if="overview && overview.auditedCount > 0" class="mb-8 grid gap-4 lg:grid-cols-3">
      <div class="card p-5">
        <p class="mb-3 text-xs font-semibold text-slate-300">Problèmes par sévérité</p>
        <div class="space-y-1.5">
          <div v-for="s in SEVS" :key="s" class="flex items-center gap-2 text-sm">
            <span :class="['h-2.5 w-2.5 rounded-full', SEV_DOT[s]]" />
            <span class="w-16 capitalize text-slate-400">{{ s }}</span>
            <span class="font-medium tabular-nums">{{ overview.severityTotals[s] ?? 0 }}</span>
          </div>
        </div>
      </div>
      <div class="card p-5">
        <p class="mb-3 text-xs font-semibold text-slate-300">Repos à risque</p>
        <ul class="space-y-1.5 text-sm">
          <li
            v-for="r in overview.worstRepos"
            :key="r.id"
            class="flex cursor-pointer items-center justify-between hover:text-white"
            @click="router.push({ name: 'repo', params: { id: r.id } })"
          >
            <span class="truncate text-slate-300">{{ r.fullName }}</span>
            <span class="ml-2 font-semibold" :style="{ color: scoreColor(r.score) }">{{ r.score }}</span>
          </li>
        </ul>
      </div>
      <div class="card p-5">
        <p class="mb-3 text-xs font-semibold text-slate-300">Règles les plus fréquentes</p>
        <ul class="space-y-1.5 text-sm">
          <li v-for="t in overview.topRules.slice(0, 6)" :key="t.rule" class="flex items-center justify-between">
            <code class="truncate text-xs text-slate-400">{{ t.rule }}</code>
            <span class="ml-2 rounded bg-white/5 px-1.5 text-xs tabular-nums">{{ t.count }}</span>
          </li>
        </ul>
      </div>
    </div>

    <p v-if="error" class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
      {{ error }}
    </p>

    <div v-if="loading" class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="i in 6" :key="i" class="card space-y-4 p-5">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 space-y-2"><Skeleton height="1rem" /><Skeleton height="0.75rem" /></div>
          <Skeleton height="84px" rounded="9999px" :style="{ width: '84px' }" />
        </div>
        <Skeleton height="2.5rem" />
        <Skeleton height="2.25rem" />
      </div>
    </div>
    <p v-else-if="!repos.length" class="card p-8 text-center text-slate-400">
      Aucun repository. Clique « <strong>Se connecter</strong> » (en haut à droite) pour lier ton compte GitHub,
      puis « Synchroniser GitHub » pour importer tes repos et ceux de tes organisations.
      <br />
      <span class="text-xs">Alternative sans OAuth : définir <code>GITHUB_TOKEN</code> dans <code>.env</code>.</span>
    </p>

    <div v-else ref="grid" class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      <RepoCard
        v-for="repo in filtered"
        :key="repo.id"
        :repo="repo"
        :busy="busyId === repo.id"
        @audit="startAudit"
      />
    </div>
  </section>
</template>
