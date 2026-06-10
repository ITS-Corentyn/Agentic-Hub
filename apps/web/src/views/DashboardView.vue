<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import gsap from 'gsap';
import { api, type RepoSummary } from '../api';
import RepoCard from '../components/RepoCard.vue';

const router = useRouter();
const repos = ref<RepoSummary[]>([]);
const loading = ref(true);
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
        <button class="btn-primary" :disabled="syncing" @click="sync">
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

    <p v-if="error" class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
      {{ error }}
    </p>

    <p v-if="loading" class="text-sm text-slate-400">Chargement…</p>
    <p v-else-if="!repos.length" class="card p-8 text-center text-slate-400">
      Aucun repository. Configure <code>GITHUB_TOKEN</code> + <code>GITHUB_OWNER</code> puis clique « Synchroniser GitHub ».
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
