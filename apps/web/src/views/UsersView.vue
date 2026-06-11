<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { ROLE_LABELS } from '../lib/ui';

const users = ref<Awaited<ReturnType<typeof api.listUsers>>>([]);
const error = ref('');
const ROLES = ['admin', 'member', 'viewer', 'pending'];

async function load() {
  error.value = '';
  try {
    users.value = await api.listUsers();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function changeRole(id: string, role: string) {
  try {
    await api.patchUser(id, { role });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
    await load();
  }
}
async function toggleDisabled(id: string, disabled: boolean) {
  try {
    await api.patchUser(id, { disabled });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
    await load();
  }
}

onMounted(load);
</script>

<template>
  <section class="mx-auto max-w-3xl space-y-4">
    <div>
      <h1 class="text-2xl font-bold">Utilisateurs</h1>
      <p class="text-sm text-slate-400">Gère les rôles et l'accès. Les comptes « en attente » n'ont aucun accès.</p>
    </div>

    <p v-if="error" class="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{{ error }}</p>

    <div class="card divide-y divide-white/5">
      <div v-for="u in users" :key="u.id" class="flex items-center gap-3 p-3" :class="u.disabled ? 'opacity-50' : ''">
        <img v-if="u.avatarUrl" :src="u.avatarUrl" class="h-8 w-8 rounded-full" alt="" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ u.login }}</p>
          <p class="truncate text-[11px] text-slate-400">{{ u.name || '—' }}</p>
        </div>
        <select
          :value="u.role"
          class="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs"
          @change="changeRole(u.id, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
        </select>
        <button
          class="rounded-md border border-white/10 px-2 py-1 text-xs hover:bg-white/5"
          @click="toggleDisabled(u.id, !u.disabled)"
        >
          {{ u.disabled ? 'Réactiver' : 'Désactiver' }}
        </button>
      </div>
      <p v-if="!users.length" class="p-4 text-sm text-slate-400">Aucun utilisateur.</p>
    </div>
  </section>
</template>
