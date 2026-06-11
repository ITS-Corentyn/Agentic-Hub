<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ShieldCheck, Bell, Mail, Scale, CircleCheck } from '@lucide/vue';
import { api, type Dimension } from '../api';
import { DIMENSION_LABELS } from '../lib/ui';

const DIMS: Dimension[] = [
  'security',
  'dependencies',
  'quality',
  'architecture',
  'backend',
  'frontend',
  'performance',
];

const weights = ref<Record<string, number>>({});
const locBaseline = ref(2000);
const policy = ref<{ minScore: number | null; maxCritical: number | null; maxHigh: number | null }>({
  minScore: null,
  maxCritical: 0,
  maxHigh: null,
});
const notify = ref<{ webhookUrl: string; mode: string }>({ webhookUrl: '', mode: 'off' });
const email = ref({ enabled: false, host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '' });
const saved = ref(false);
const error = ref('');
const digestMsg = ref('');

async function load() {
  try {
    const s = await api.getSettings();
    weights.value = { ...s.scoring.weights };
    locBaseline.value = s.scoring.locBaseline ?? 2000;
    if (s.policy) policy.value = { minScore: s.policy.minScore ?? null, maxCritical: s.policy.maxCritical ?? 0, maxHigh: s.policy.maxHigh ?? null };
    if (s.notify) notify.value = { webhookUrl: s.notify.webhookUrl ?? '', mode: s.notify.mode ?? 'off' };
    if (s.email) email.value = { ...email.value, ...s.email };
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function testDigest() {
  digestMsg.value = 'Envoi…';
  try {
    const r = await api.sendDigestTest();
    digestMsg.value = r.message;
  } catch (e) {
    digestMsg.value = (e as Error).message;
  }
}

async function save() {
  saved.value = false;
  error.value = '';
  try {
    await api.saveSettings({
      scoring: { weights: weights.value, locBaseline: Number(locBaseline.value) },
      policy: policy.value,
      notify: notify.value,
      email: { ...email.value, port: Number(email.value.port) },
    });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(load);
</script>

<template>
  <section class="mx-auto max-w-2xl space-y-6">
    <h1 class="text-2xl font-bold">Réglages</h1>

    <!-- Politique qualité (gate par défaut) -->
    <div class="card space-y-4 p-6">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-semibold"><ShieldCheck class="h-4 w-4 text-brand-400" /> Politique qualité (gate par défaut)</h2>
        <p class="text-xs text-slate-400">Seuils qui font passer un audit en « KO » (surchargés par repo).</p>
      </div>
      <div class="flex items-center gap-4">
        <label for="pol-min" class="w-40 text-sm">Score minimum</label>
        <input id="pol-min" v-model.number="policy.minScore" type="number" min="0" max="100" placeholder="aucun"
          class="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
      </div>
      <div class="flex items-center gap-4">
        <label for="pol-crit" class="w-40 text-sm">Max. critiques</label>
        <input id="pol-crit" v-model.number="policy.maxCritical" type="number" min="0"
          class="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
      </div>
      <div class="flex items-center gap-4">
        <label for="pol-high" class="w-40 text-sm">Max. élevés</label>
        <input id="pol-high" v-model.number="policy.maxHigh" type="number" min="0" placeholder="aucun"
          class="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
      </div>
    </div>

    <!-- Notifications -->
    <div class="card space-y-4 p-6">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-semibold"><Bell class="h-4 w-4 text-brand-400" /> Notifications</h2>
        <p class="text-xs text-slate-400">Webhook compatible Slack / Mattermost / Discord.</p>
      </div>
      <div class="flex items-center gap-4">
        <label for="notify-mode" class="w-40 text-sm">Déclencheur</label>
        <select id="notify-mode" v-model="notify.mode"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500">
          <option value="off">Désactivé</option>
          <option value="always">À chaque audit</option>
          <option value="critical">Si critique ou gate KO</option>
          <option value="score-drop">Si le score baisse ou gate KO</option>
        </select>
      </div>
      <div class="flex items-center gap-4">
        <label for="notify-url" class="w-40 text-sm">URL du webhook</label>
        <input id="notify-url" v-model="notify.webhookUrl" type="url" placeholder="https://hooks.slack.com/…"
          class="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
      </div>
    </div>

    <!-- Digest e-mail hebdomadaire -->
    <div class="card space-y-4 p-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="flex items-center gap-2 text-sm font-semibold"><Mail class="h-4 w-4 text-brand-400" /> Digest e-mail (hebdomadaire)</h2>
          <p class="text-xs text-slate-400">Récap des scores de tous les repos, chaque lundi.</p>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="email.enabled" type="checkbox" class="accent-brand-500" /> Activé
        </label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <input v-model="email.host" aria-label="Hôte SMTP" placeholder="Hôte SMTP" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
        <input v-model.number="email.port" type="number" aria-label="Port SMTP" placeholder="Port (587)" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
        <input v-model="email.user" aria-label="Utilisateur SMTP" placeholder="Utilisateur" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
        <input v-model="email.pass" type="password" aria-label="Mot de passe SMTP" placeholder="Mot de passe" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
        <input v-model="email.from" aria-label="Adresse expéditeur" placeholder="Expéditeur (from)" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
        <input v-model="email.to" aria-label="Adresse(s) destinataire(s)" placeholder="Destinataire(s)" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
      </div>
      <label class="flex items-center gap-2 text-xs text-slate-400">
        <input v-model="email.secure" type="checkbox" class="accent-brand-500" /> TLS (port 465)
      </label>
      <div class="flex items-center gap-3">
        <button class="btn-ghost" @click="testDigest">Envoyer un test</button>
        <span v-if="digestMsg" class="text-xs text-slate-400">{{ digestMsg }}</span>
      </div>
    </div>

    <!-- Pondérations de scoring -->
    <div class="card space-y-4 p-6">
      <h2 class="flex items-center gap-2 text-sm font-semibold"><Scale class="h-4 w-4 text-brand-400" /> Pondération des dimensions</h2>
      <div v-for="d in DIMS" :key="d" class="flex items-center gap-4">
        <label :for="`w-${d}`" class="w-32 text-sm">{{ DIMENSION_LABELS[d] }}</label>
        <input :id="`w-${d}`" v-model.number="weights[d]" type="range" min="0" max="40" :aria-label="`Pondération ${DIMENSION_LABELS[d]}`" class="flex-1 accent-brand-500" />
        <span class="w-10 text-right text-sm tabular-nums">{{ weights[d] }}</span>
      </div>
      <div class="flex items-center gap-4 border-t border-white/5 pt-4">
        <label for="loc-baseline" class="w-32 text-sm">Baseline LOC</label>
        <input id="loc-baseline" v-model.number="locBaseline" type="number"
          class="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-500" />
      </div>
    </div>

    <div class="flex items-center gap-3">
      <button class="btn-primary" @click="save">Enregistrer</button>
      <span v-if="saved" class="inline-flex items-center gap-1 text-sm text-emerald-400"><CircleCheck class="h-4 w-4" /> Enregistré</span>
      <span v-if="error" class="text-sm text-red-400">{{ error }}</span>
    </div>
  </section>
</template>
