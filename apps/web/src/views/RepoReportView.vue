<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type AuditDetail, type Dimension, type Finding } from '../api';
import { DIMENSION_LABELS, scoreColor } from '../lib/ui';
import { auth } from '../lib/auth';
import ScoreGauge from '../components/ScoreGauge.vue';
import FindingsTable from '../components/FindingsTable.vue';
import TrendChart from '../components/TrendChart.vue';

const props = defineProps<{ id: string }>();

const audit = ref<AuditDetail | null>(null);
const findings = ref<Finding[]>([]);
const trend = ref<{ date: string; score: number }[]>([]);
const diff = ref<Awaited<ReturnType<typeof api.getDiff>> | null>(null);
const loading = ref(true);
const error = ref('');
const activeDim = ref<Dimension | 'all'>('all');
const toast = ref('');
const depBusy = ref(false);
const prBusy = ref(false);
const schedule = ref('off');
const lhUrl = ref('');

async function onPrCheck() {
  if (!audit.value) return;
  prBusy.value = true;
  try {
    const { url } = await api.createPrCheck(audit.value.repository.id);
    flash('PR « check de PR » ouverte');
    window.open(url, '_blank');
  } catch (e) {
    flash(`Échec : ${(e as Error).message}`);
  } finally {
    prBusy.value = false;
  }
}

async function saveLighthouse() {
  if (!audit.value) return;
  try {
    await api.setLighthouse(audit.value.repository.id, lhUrl.value || null);
    flash(lhUrl.value ? 'URL Lighthouse enregistrée' : 'Lighthouse désactivé');
  } catch (e) {
    flash((e as Error).message);
  }
}

function flash(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ''), 5000);
}

async function onSchedule(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  schedule.value = v;
  try {
    await api.setSchedule(props.id, v);
    flash(v === 'off' ? 'Planification désactivée' : `Audit planifié : ${v}`);
  } catch (err) {
    flash((err as Error).message);
  }
}

async function onTriage(findingId: string, status: string) {
  try {
    await api.patchFinding(findingId, { status });
    const f = findings.value.find((x) => x.id === findingId);
    if (f) f.status = status as Finding['status'];
  } catch (e) {
    flash((e as Error).message);
  }
}

async function onIssue(findingId: string) {
  try {
    const { url } = await api.createIssue(findingId);
    flash('Issue créée');
    window.open(url, '_blank');
  } catch (e) {
    flash(`Échec : ${(e as Error).message}`);
  }
}

async function copyBadge() {
  if (!audit.value) return;
  const url = api.badgeUrl(audit.value.repository.id);
  const snippet = `![Agentic-Hub](${url})`;
  try {
    await navigator.clipboard.writeText(snippet);
    flash('Markdown du badge copié dans le presse-papier');
  } catch {
    flash(snippet);
  }
}

async function onDependabotPr() {
  if (!audit.value) return;
  depBusy.value = true;
  try {
    const { url } = await api.createDependabotPr(audit.value.repository.id);
    flash('PR Dependabot ouverte');
    window.open(url, '_blank');
  } catch (e) {
    flash(`Échec : ${(e as Error).message}`);
  } finally {
    depBusy.value = false;
  }
}

const dims = computed(() => audit.value?.dimensions ?? []);
const visibleFindings = computed(() =>
  activeDim.value === 'all' ? findings.value : findings.value.filter((f) => f.dimension === activeDim.value),
);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const repo = await api.getRepo(props.id);
    const lastAudit = repo.audits.find((a) => a.status === 'done') ?? repo.audits[0];
    if (!lastAudit) {
      error.value = 'Aucun audit disponible pour ce repository.';
      return;
    }
    audit.value = await api.getAudit(lastAudit.id);
    schedule.value = audit.value.repository.auditSchedule ?? 'off';
    lhUrl.value = audit.value.repository.lighthouseUrl ?? '';
    findings.value = await api.getFindings(lastAudit.id);
    try {
      trend.value = (await api.getTrend(props.id)).map((p) => ({ date: p.date, score: p.score }));
    } catch {
      trend.value = [];
    }
    try {
      diff.value = await api.getDiff(lastAudit.id);
    } catch {
      diff.value = null;
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section v-if="loading" class="text-sm text-slate-400">Chargement du rapport…</section>
  <section v-else-if="error" class="card p-8 text-center text-slate-400">{{ error }}</section>

  <section v-else-if="audit" class="space-y-8">
    <RouterLink to="/" class="text-sm text-slate-400 hover:text-white">← Dashboard</RouterLink>

    <!-- En-tête -->
    <div class="card flex flex-wrap items-center justify-between gap-6 p-6">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-bold">{{ audit.repository.fullName }}</h1>
          <span
            v-if="audit.gatePassed === true"
            class="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300"
          >🚦 Gate OK</span>
          <span
            v-else-if="audit.gatePassed === false"
            class="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-300"
            :title="(audit.gateReasons || []).join(' ; ')"
          >🚦 Gate KO</span>
        </div>
        <p class="text-sm text-slate-400">
          {{ audit.loc.toLocaleString('fr-FR') }} lignes · {{ audit.files }} fichiers ·
          {{ audit.languages.join(', ') || '—' }}
        </p>
        <p class="mt-1 text-xs text-slate-500">
          Outils : {{ audit.toolsRun.join(', ') }}
          <span v-if="audit.toolsSkipped.length">· ignorés : {{ audit.toolsSkipped.join(', ') }}</span>
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <a :href="api.reportUrl(audit.id)" target="_blank" class="btn-ghost">⬇ MD</a>
          <a :href="api.pdfUrl(audit.id)" target="_blank" class="btn-ghost">⬇ PDF</a>
          <a :href="api.csvUrl(audit.id)" class="btn-ghost">⬇ CSV</a>
          <button class="btn-ghost" @click="copyBadge">🏷️ Badge</button>
          <button v-if="auth.canWrite" class="btn-ghost" :disabled="depBusy" @click="onDependabotPr">
            {{ depBusy ? '…' : '🤖 Dependabot (PR)' }}
          </button>
          <button v-if="auth.canWrite" class="btn-ghost" :disabled="prBusy" @click="onPrCheck">
            {{ prBusy ? '…' : '🔁 Check de PR (PR)' }}
          </button>
          <select
            v-if="auth.canWrite"
            :value="schedule"
            class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 outline-none focus:border-brand-500"
            title="Planifier des audits automatiques"
            @change="onSchedule"
          >
            <option value="off">⏱ Pas de planification</option>
            <option value="daily">⏱ Audit quotidien</option>
            <option value="weekly">⏱ Audit hebdomadaire</option>
          </select>
        </div>
        <div v-if="auth.canWrite" class="mt-2 flex items-center gap-2">
          <input
            v-model="lhUrl"
            type="url"
            placeholder="URL Lighthouse (app déployée) — perf/a11y/SEO"
            class="w-72 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none focus:border-brand-500"
          />
          <button class="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/5" @click="saveLighthouse">
            💡 Enregistrer
          </button>
        </div>
      </div>
      <ScoreGauge :score="audit.globalScore ?? 0" :size="150" label="score global" />
    </div>

    <!-- Tendance + diff depuis le dernier audit -->
    <div class="grid gap-4 lg:grid-cols-3">
      <div class="card p-5 lg:col-span-2">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-300">📈 Évolution du score</h2>
          <span v-if="diff?.deltaScore != null" :class="diff.deltaScore >= 0 ? 'text-emerald-400' : 'text-red-400'" class="text-xs font-medium">
            {{ diff.deltaScore >= 0 ? '+' : '' }}{{ diff.deltaScore }} vs précédent
          </span>
        </div>
        <TrendChart :points="trend" />
      </div>
      <div class="card flex flex-col justify-center gap-3 p-5">
        <h2 class="text-sm font-semibold text-slate-300">Depuis le dernier audit</h2>
        <template v-if="diff && diff.previousAuditId">
          <div class="flex items-center gap-2 text-sm">
            <span class="inline-block w-16 text-emerald-400">✓ {{ diff.counts.fixed }}</span> corrigé(s)
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span class="inline-block w-16 text-red-400">+ {{ diff.counts.added }}</span> nouveau(x)
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span class="inline-block w-16 text-slate-400">= {{ diff.counts.persistent }}</span> persistant(s)
          </div>
        </template>
        <p v-else class="text-xs text-slate-500">Premier audit : pas de comparaison disponible.</p>
      </div>
    </div>

    <!-- Synthèse -->
    <div v-if="audit.synthesis" class="card p-6">
      <h2 class="mb-2 text-lg font-semibold">🧭 Synthèse exécutive</h2>
      <p class="text-sm leading-relaxed text-slate-300">{{ audit.synthesis.executiveSummary }}</p>
      <p class="mt-2 text-[11px] text-slate-500">
        {{ audit.synthesis.llmGenerated ? `Narration : modèle local ${audit.synthesis.model}` : 'Narration : gabarit statique (LLM désactivé)' }}
      </p>

      <div v-if="audit.synthesis.top10.length" class="mt-4 overflow-hidden rounded-lg border border-white/5">
        <table class="w-full text-left text-sm">
          <thead class="bg-white/5 text-xs text-slate-400">
            <tr><th class="p-2">#</th><th class="p-2">Problème</th><th class="p-2">Dimension</th><th class="p-2">Correctif</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in audit.synthesis.top10" :key="t.rank" class="border-t border-white/5">
              <td class="p-2 tabular-nums text-slate-400">{{ t.rank }}</td>
              <td class="p-2">{{ t.title }}</td>
              <td class="p-2 text-slate-400">{{ DIMENSION_LABELS[t.dimension] }}</td>
              <td class="p-2 text-slate-300">{{ t.remediation }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p class="mb-1 text-sm font-semibold">🗺️ Roadmap 7 jours</p>
          <ul class="space-y-1 text-sm text-slate-300">
            <li v-for="(r, i) in audit.synthesis.roadmap7d" :key="i">☐ {{ r.title }}</li>
          </ul>
        </div>
        <div>
          <p class="mb-1 text-sm font-semibold">🗺️ Roadmap 30 jours</p>
          <ul class="space-y-1 text-sm text-slate-300">
            <li v-for="(r, i) in audit.synthesis.roadmap30d" :key="i">☐ {{ r.title }}</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Scores par dimension -->
    <div>
      <h2 class="mb-3 text-lg font-semibold">Scores par dimension</h2>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <button
          v-for="d in dims"
          :key="d.dimension"
          class="card flex flex-col items-center gap-2 p-4 transition hover:border-brand-500/40"
          :class="activeDim === d.dimension ? 'border-brand-500/60' : ''"
          @click="activeDim = activeDim === d.dimension ? 'all' : d.dimension"
        >
          <ScoreGauge :score="d.score" :size="72" />
          <span class="text-center text-xs text-slate-300">{{ DIMENSION_LABELS[d.dimension] }}</span>
        </button>
      </div>
    </div>

    <!-- Findings -->
    <div>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-lg font-semibold">
          Problèmes détaillés
          <span class="text-sm text-slate-400">({{ visibleFindings.length }})</span>
        </h2>
        <button v-if="activeDim !== 'all'" class="text-xs text-brand-400 hover:underline" @click="activeDim = 'all'">
          Voir toutes les dimensions
        </button>
      </div>
      <FindingsTable :findings="visibleFindings" @triage="onTriage" @issue="onIssue" />
    </div>

    <!-- Toast -->
    <Transition name="fade">
      <div
        v-if="toast"
        class="fixed bottom-6 right-6 z-30 rounded-lg border border-white/10 bg-ink-800 px-4 py-3 text-sm text-slate-100 shadow-xl"
      >
        {{ toast }}
      </div>
    </Transition>
  </section>
</template>
