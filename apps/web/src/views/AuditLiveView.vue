<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useSse, type SseMessage } from '../composables/useSse';
import { statusLabel } from '../lib/ui';
import { toast } from '../lib/toast';

const props = defineProps<{ id: string }>();
const router = useRouter();

const progress = ref(0);
const status = ref('queued');
const logs = ref<string[]>([]);
const failed = ref(false);
const errorMsg = ref('');
const cancelling = ref(false);

async function cancel() {
  cancelling.value = true;
  try {
    await api.cancelAudit(props.id);
    toast('Audit annulé', 'info');
  } catch (e) {
    toast((e as Error).message, 'error');
    cancelling.value = false;
  }
}

function push(msg: string) {
  logs.value = [...logs.value.slice(-40), msg];
}

async function finish() {
  // Récupère le repo pour rediriger vers le rapport.
  try {
    const audit = await api.getAudit(props.id);
    router.replace({ name: 'repo', params: { id: audit.repository.id } });
  } catch {
    /* reste sur la page */
  }
}

function handle(msg: SseMessage) {
  if (typeof msg.progress === 'number') progress.value = Math.max(progress.value, msg.progress);
  if (msg.status) status.value = msg.status;
  if (msg.message) push(msg.message);
  if (msg.type === 'done') {
    progress.value = 100;
    setTimeout(finish, 800);
  }
  if (msg.type === 'error') {
    failed.value = true;
    errorMsg.value = msg.message ?? 'Échec';
  }
}

onMounted(async () => {
  // État initial (au cas où l'audit avance vite avant l'abonnement).
  try {
    const audit = await api.getAudit(props.id);
    status.value = audit.status;
    if (audit.status === 'done') return finish();
    if (audit.status === 'failed') {
      failed.value = true;
      errorMsg.value = audit.error ?? 'Échec';
    }
  } catch {
    /* ignore */
  }
  useSse(api.streamUrl(props.id), handle);
});
</script>

<template>
  <section class="mx-auto max-w-2xl">
    <RouterLink to="/" class="text-sm text-slate-400 hover:text-white">← Dashboard</RouterLink>
    <div class="card mt-4 p-8">
      <h1 class="text-xl font-bold">Audit en cours</h1>
      <p class="mt-1 text-sm text-slate-400">Statut : {{ statusLabel(status) }}</p>

      <div class="mt-6 h-3 w-full overflow-hidden rounded-full bg-white/5">
        <div
          class="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-700"
          :style="{ width: `${progress}%` }"
        />
      </div>
      <div class="mt-2 flex items-center justify-between">
        <button
          v-if="!failed && status !== 'done'"
          class="rounded-md border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          :disabled="cancelling"
          @click="cancel"
        >
          {{ cancelling ? 'Annulation…' : 'Annuler' }}
        </button>
        <span v-else></span>
        <span class="text-xs tabular-nums text-slate-400">{{ Math.round(progress) }}%</span>
      </div>

      <div v-if="failed" class="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        {{ errorMsg }}
      </div>

      <div class="mt-6 max-h-60 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-xs text-slate-400">
        <p v-for="(l, i) in logs" :key="i">› {{ l }}</p>
        <p v-if="!logs.length" class="text-slate-600">En attente des scanners…</p>
      </div>
    </div>
  </section>
</template>
