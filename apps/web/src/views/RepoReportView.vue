<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  RotateCw, Download, ChevronDown, Tag, Bot, GitPullRequest, Clock,
  Lightbulb, Compass, Map as MapIcon, TrendingUp, ShieldCheck, ShieldAlert,
} from '@lucide/vue';
import { api, type AuditDetail, type Dimension, type Finding, type RepoSummary } from '../api';
import { DIMENSION_LABELS } from '../lib/ui';
import { auth } from '../lib/auth';
import { toast } from '../lib/toast';
import ScoreGauge from '../components/ScoreGauge.vue';
import FindingsTable from '../components/FindingsTable.vue';
import TrendChart from '../components/TrendChart.vue';
import Skeleton from '../components/Skeleton.vue';

const props = defineProps<{ id: string }>();
const router = useRouter();

const audit = ref<AuditDetail | null>(null);
const findings = ref<Finding[]>([]);
const trend = ref<{ date: string; score: number }[]>([]);
const diff = ref<Awaited<ReturnType<typeof api.getDiff>> | null>(null);
const auditList = ref<RepoSummary['audits']>([]);
const selectedAuditId = ref('');
const compareId = ref('');
const loading = ref(true);
const error = ref('');
const activeDim = ref<Dimension | 'all'>('all');
const depBusy = ref(false);
const prBusy = ref(false);
const reauditing = ref(false);
const switching = ref(false); // chargement d'un autre audit de l'historique
const schedule = ref('off');
const lhUrl = ref('');

/** Confirmation avant toute action qui crée un artefact public sur GitHub. */
function confirmAction(message: string): boolean {
  return window.confirm(message);
}

/** Relance un audit du repo et bascule sur l'écran de progression live. */
async function reaudit() {
  if (!audit.value) return;
  reauditing.value = true;
  try {
    const { auditId } = await api.startAudit(audit.value.repository.id);
    flash('Audit relancé', 'success');
    router.push({ name: 'audit', params: { id: auditId } });
  } catch (e) {
    flash((e as Error).message, 'error');
  } finally {
    reauditing.value = false;
  }
}

async function onPrCheck() {
  if (!audit.value) return;
  if (!confirmAction(`Créer une pull request « check de PR » sur ${audit.value.repository.fullName} ?`)) return;
  prBusy.value = true;
  try {
    const { url } = await api.createPrCheck(audit.value.repository.id);
    flash('Pull request créée', 'success');
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (e) {
    flash((e as Error).message, 'error');
  } finally {
    prBusy.value = false;
  }
}

async function saveLighthouse() {
  if (!audit.value) return;
  try {
    await api.setLighthouse(audit.value.repository.id, lhUrl.value || null);
    flash(
      lhUrl.value
        ? 'URL Lighthouse enregistrée — prise en compte au prochain audit'
        : 'Lighthouse désactivé',
      'success',
    );
  } catch (e) {
    flash((e as Error).message, 'error');
  }
}

function flash(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  toast(msg, type);
}

async function onSchedule(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  schedule.value = v;
  try {
    await api.setSchedule(props.id, v);
    flash(v === 'off' ? 'Planification désactivée' : `Audit planifié : ${v}`, 'success');
  } catch (err) {
    flash((err as Error).message, 'error');
  }
}

async function onTriage(findingId: string, status: string) {
  try {
    await api.patchFinding(findingId, { status });
    const f = findings.value.find((x) => x.id === findingId);
    if (f) f.status = status as Finding['status'];
  } catch (e) {
    flash((e as Error).message, 'error');
  }
}

async function onIssue(findingId: string) {
  try {
    const { url } = await api.createIssue(findingId);
    flash('Issue créée', 'success');
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (e) {
    flash((e as Error).message, 'error');
  }
}

async function copyBadge() {
  if (!audit.value) return;
  const url = api.badgeUrl(audit.value.repository.id);
  const snippet = `![Agentic-Hub](${url})`;
  try {
    await navigator.clipboard.writeText(snippet);
    flash('Markdown du badge copié dans le presse-papier', 'success');
  } catch {
    flash(snippet, 'info');
  }
}

async function onDependabotPr() {
  if (!audit.value) return;
  if (!confirmAction(`Ouvrir une pull request Dependabot sur ${audit.value.repository.fullName} ?`)) return;
  depBusy.value = true;
  try {
    const { url } = await api.createDependabotPr(audit.value.repository.id);
    flash('Pull request Dependabot créée', 'success');
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (e) {
    flash((e as Error).message, 'error');
  } finally {
    depBusy.value = false;
  }
}

const dims = computed(() => audit.value?.dimensions ?? []);
const visibleFindings = computed(() =>
  activeDim.value === 'all' ? findings.value : findings.value.filter((f) => f.dimension === activeDim.value),
);

// Libellé de la cible de comparaison (reflète le sélecteur « Comparer à »).
const compareLabel = computed(() => {
  if (!compareId.value) return "l'audit précédent";
  const a = auditList.value.find((x) => x.id === compareId.value);
  return a ? `l'audit du ${fmtAudit(a)}` : "l'audit choisi";
});

// Charge le détail d'un audit précis (+ findings + diff).
async function loadAudit(auditId: string) {
  switching.value = true;
  try {
    audit.value = await api.getAudit(auditId);
    selectedAuditId.value = auditId;
    schedule.value = audit.value.repository.auditSchedule ?? 'off';
    lhUrl.value = audit.value.repository.lighthouseUrl ?? '';
    findings.value = await api.getFindings(auditId);
    try {
      diff.value = await api.getDiff(auditId, compareId.value || undefined);
    } catch {
      diff.value = null;
    }
  } finally {
    switching.value = false;
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const repo = await api.getRepo(props.id);
    auditList.value = repo.audits;
    const target = repo.audits.find((a) => a.status === 'done') ?? repo.audits[0];
    if (!target) {
      error.value = 'Aucun audit disponible pour ce repository.';
      return;
    }
    await loadAudit(target.id);
    try {
      trend.value = (await api.getTrend(props.id)).map((p) => ({ date: p.date, score: p.score }));
    } catch {
      trend.value = [];
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function onSelectAudit(e: Event) {
  await loadAudit((e.target as HTMLSelectElement).value);
}
async function onCompare(e: Event) {
  compareId.value = (e.target as HTMLSelectElement).value;
  if (audit.value) {
    try {
      diff.value = await api.getDiff(audit.value.id, compareId.value || undefined);
    } catch {
      diff.value = null;
    }
  }
}
function fmtAudit(a: RepoSummary['audits'][number]): string {
  const d = new Date(a.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  return `${d} · ${a.globalScore ?? '—'}/100${a.status !== 'done' ? ` (${a.status})` : ''}`;
}

onMounted(load);
</script>

<template>
  <section v-if="loading" class="space-y-4">
    <div class="card p-6"><Skeleton height="2rem" /><div class="mt-3"><Skeleton height="1rem" /></div></div>
    <div class="card p-6"><Skeleton height="120px" /></div>
    <div class="space-y-2">
      <Skeleton v-for="i in 5" :key="i" height="3rem" />
    </div>
  </section>
  <section v-else-if="error" class="card p-8 text-center text-slate-400">{{ error }}</section>

  <section v-else-if="audit" class="space-y-8">
    <RouterLink to="/" class="text-sm text-slate-400 hover:text-white">← Dashboard</RouterLink>

    <!-- En-tête -->
    <div class="card flex flex-wrap items-center justify-between gap-6 p-6">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-bold">{{ audit.repository.fullName }}</h1>
          <span
            v-if="audit.gatePassed === true"
            class="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300"
          ><ShieldCheck class="h-3.5 w-3.5" /> Gate OK</span>
          <span
            v-else-if="audit.gatePassed === false"
            class="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-300"
          ><ShieldAlert class="h-3.5 w-3.5" /> Gate KO</span>
        </div>
        <p class="text-sm text-slate-400">
          {{ audit.loc.toLocaleString('fr-FR') }} lignes · {{ audit.files }} fichiers ·
          {{ audit.languages.join(', ') || '—' }}
        </p>
        <p class="mt-1 text-xs text-slate-500">
          Outils : {{ audit.toolsRun.join(', ') }}
          <span v-if="audit.toolsSkipped.length">· ignorés : {{ audit.toolsSkipped.join(', ') }}</span>
        </p>

        <!-- Raisons d'échec de la gate, affichées en clair (et non plus seulement au survol). -->
        <div
          v-if="audit.gatePassed === false && (audit.gateReasons || []).length"
          class="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200"
          role="alert"
        >
          <p class="mb-1 font-semibold">Pourquoi la gate échoue :</p>
          <ul class="list-disc space-y-0.5 pl-4">
            <li v-for="(r, i) in audit.gateReasons" :key="i">{{ r }}</li>
          </ul>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            v-if="auth.canWrite"
            class="btn-primary"
            :disabled="reauditing"
            @click="reaudit"
          >
            <RotateCw class="h-4 w-4" :class="reauditing ? 'animate-spin' : ''" />
            {{ reauditing ? 'Lancement…' : "Relancer l'audit" }}
          </button>

          <!-- Exports regroupés (menu natif, accessible au clavier). -->
          <details class="relative">
            <summary class="btn-ghost cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <Download class="h-4 w-4" /> Exporter <ChevronDown class="h-3.5 w-3.5 opacity-70" />
            </summary>
            <div class="absolute left-0 z-10 mt-1 w-44 overflow-hidden rounded-lg border border-white/10 bg-ink-800 py-1 shadow-xl">
              <a :href="api.reportUrl(audit.id)" target="_blank" rel="noopener noreferrer" class="block px-3 py-2 text-sm text-slate-200 hover:bg-white/5">Markdown (.md)</a>
              <a :href="api.pdfUrl(audit.id)" target="_blank" rel="noopener noreferrer" class="block px-3 py-2 text-sm text-slate-200 hover:bg-white/5">PDF</a>
              <a :href="api.csvUrl(audit.id)" class="block px-3 py-2 text-sm text-slate-200 hover:bg-white/5">Findings (.csv)</a>
            </div>
          </details>

          <button class="btn-ghost" @click="copyBadge"><Tag class="h-4 w-4" /> Badge</button>
          <button v-if="auth.canWrite" class="btn-ghost" :disabled="depBusy" @click="onDependabotPr">
            <Bot class="h-4 w-4" /> {{ depBusy ? 'Création…' : 'Activer Dependabot' }}
          </button>
          <button v-if="auth.canWrite" class="btn-ghost" :disabled="prBusy" @click="onPrCheck">
            <GitPullRequest class="h-4 w-4" /> {{ prBusy ? 'Création…' : 'Ajouter le check de PR' }}
          </button>
          <select
            v-if="auth.canWrite"
            :value="schedule"
            aria-label="Planifier des audits automatiques"
            class="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 outline-none focus:border-brand-500"
            @change="onSchedule"
          >
            <option value="off">Pas de planification</option>
            <option value="daily">Audit quotidien</option>
            <option value="weekly">Audit hebdomadaire</option>
          </select>
        </div>

        <div v-if="auth.canWrite" class="mt-2 flex items-center gap-2">
          <input
            v-model="lhUrl"
            type="url"
            aria-label="URL Lighthouse de l'application déployée"
            placeholder="URL Lighthouse (app déployée) — perf/a11y/SEO"
            class="w-72 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none focus:border-brand-500"
          />
          <button class="btn-ghost px-3 py-1.5 text-xs" @click="saveLighthouse">
            <Lightbulb class="h-3.5 w-3.5" /> Enregistrer
          </button>
        </div>
        <p v-if="auth.canWrite" class="mt-1 text-[11px] text-slate-500">
          L'URL Lighthouse est prise en compte au <strong>prochain audit</strong> (mesure perf/a11y/SEO de l'app en ligne).
        </p>
      </div>
      <ScoreGauge :score="audit.globalScore ?? 0" :size="150" label="score global" />
    </div>

    <!-- Historique : choisir l'audit affiché + comparer -->
    <div v-if="auditList.length > 1" class="card flex flex-wrap items-center gap-3 p-4 text-sm">
      <label for="audit-select" class="text-slate-400">Audit :</label>
      <select
        id="audit-select"
        :value="selectedAuditId"
        :disabled="switching"
        class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 outline-none focus:border-brand-500 disabled:opacity-50"
        @change="onSelectAudit"
      >
        <option v-for="a in auditList" :key="a.id" :value="a.id">{{ fmtAudit(a) }}</option>
      </select>
      <label for="compare-select" class="ml-2 text-slate-400">Comparer à :</label>
      <select
        id="compare-select"
        :value="compareId"
        :disabled="switching"
        class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 outline-none focus:border-brand-500 disabled:opacity-50"
        @change="onCompare"
      >
        <option value="">Audit précédent (auto)</option>
        <option v-for="a in auditList.filter((x) => x.id !== selectedAuditId)" :key="a.id" :value="a.id">
          {{ fmtAudit(a) }}
        </option>
      </select>
      <span v-if="switching" class="inline-flex items-center gap-1.5 text-xs text-slate-400" role="status">
        <RotateCw class="h-3.5 w-3.5 animate-spin" /> Chargement…
      </span>
    </div>

    <!-- Tendance + diff vs la cible de comparaison -->
    <div class="grid gap-4 lg:grid-cols-3" :class="switching ? 'pointer-events-none opacity-60 transition' : ''">
      <div class="card p-5 lg:col-span-2">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="flex items-center gap-1.5 text-sm font-semibold text-slate-300"><TrendingUp class="h-4 w-4" /> Évolution du score</h2>
          <span v-if="diff?.deltaScore != null" :class="diff.deltaScore >= 0 ? 'text-emerald-400' : 'text-red-400'" class="text-xs font-medium">
            {{ diff.deltaScore >= 0 ? '+' : '' }}{{ diff.deltaScore }} vs {{ compareLabel }}
          </span>
        </div>
        <TrendChart :points="trend" />
      </div>
      <div class="card flex flex-col justify-center gap-3 p-5">
        <h2 class="text-sm font-semibold text-slate-300">Depuis {{ compareLabel }}</h2>
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
      <h2 class="mb-2 flex items-center gap-2 text-lg font-semibold"><Compass class="h-5 w-5 text-brand-400" /> Synthèse exécutive</h2>
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
          <p class="mb-1 flex items-center gap-1.5 text-sm font-semibold"><MapIcon class="h-4 w-4 text-brand-400" /> Roadmap 7 jours</p>
          <ul class="space-y-1 text-sm text-slate-300">
            <li v-for="(r, i) in audit.synthesis.roadmap7d" :key="i">☐ {{ r.title }}</li>
          </ul>
        </div>
        <div>
          <p class="mb-1 flex items-center gap-1.5 text-sm font-semibold"><MapIcon class="h-4 w-4 text-brand-400" /> Roadmap 30 jours</p>
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
          type="button"
          :aria-pressed="activeDim === d.dimension"
          :aria-label="`Filtrer sur la dimension ${DIMENSION_LABELS[d.dimension]} (score ${Math.round(d.score)}/100)`"
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
      <FindingsTable
        :findings="visibleFindings"
        :repo-url="audit.repository.url"
        :commit-sha="audit.commitSha"
        @triage="onTriage"
        @issue="onIssue"
      />
    </div>

  </section>
</template>
