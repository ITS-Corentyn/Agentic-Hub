<script setup lang="ts">
import { computed, onMounted, onUnmounted, nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';

const router = useRouter();
const open = ref(false);
const query = ref('');
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);

interface Cmd {
  label: string;
  hint?: string;
  run: () => void;
}

const baseCmds: Cmd[] = [
  { label: 'Tableau de bord', hint: 'accueil', run: () => router.push({ name: 'dashboard' }) },
  { label: 'Recherche globale', hint: 'findings', run: () => router.push({ name: 'search' }) },
  { label: 'Réglages', hint: 'politique, notifications', run: () => router.push({ name: 'settings' }) },
];
const repoCmds = ref<Cmd[]>([]);

const items = computed(() => {
  const all = [...baseCmds, ...repoCmds.value];
  const q = query.value.trim().toLowerCase();
  if (!q) return all.slice(0, 8);
  return all.filter((c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q)).slice(0, 12);
});

async function show() {
  open.value = true;
  query.value = '';
  active.value = 0;
  await nextTick();
  input.value?.focus();
  if (!repoCmds.value.length) {
    try {
      const repos = await api.listRepos();
      repoCmds.value = repos.map((r) => ({
        label: r.fullName,
        hint: 'repo',
        run: () => router.push({ name: 'repo', params: { id: r.id } }),
      }));
    } catch {
      /* ignore */
    }
  }
}
function hide() {
  open.value = false;
}
function choose(i: number) {
  const it = items.value[i];
  if (it) {
    hide();
    it.run();
  }
}

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    open.value ? hide() : show();
    return;
  }
  if (!open.value) return;
  if (e.key === 'Escape') hide();
  else if (e.key === 'ArrowDown') {
    e.preventDefault();
    active.value = Math.min(active.value + 1, items.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = Math.max(active.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(active.value);
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
defineExpose({ show });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-28" @click.self="hide">
      <div class="card w-full max-w-lg overflow-hidden">
        <input
          ref="input"
          v-model="query"
          placeholder="Tape une commande ou un repo… (Échap pour fermer)"
          class="w-full bg-transparent px-4 py-3 text-sm outline-none"
          @keydown.stop
        />
        <ul class="max-h-80 overflow-auto border-t border-white/5">
          <li
            v-for="(it, i) in items"
            :key="i"
            :class="['flex cursor-pointer items-center justify-between px-4 py-2 text-sm', i === active ? 'bg-brand-500/15' : '']"
            @mouseenter="active = i"
            @click="choose(i)"
          >
            <span class="truncate">{{ it.label }}</span>
            <span class="ml-3 text-[11px] text-slate-500">{{ it.hint }}</span>
          </li>
          <li v-if="!items.length" class="px-4 py-3 text-sm text-slate-500">Aucun résultat</li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>
