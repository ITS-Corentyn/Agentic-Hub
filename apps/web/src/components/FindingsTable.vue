<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CircleCheck, ExternalLink, ChevronsDownUp, ChevronsUpDown } from '@lucide/vue';
import type { Finding, Severity } from '../api';
import { SEVERITY_LABELS } from '../lib/ui';
import { auth } from '../lib/auth';
import SeverityBadge from './SeverityBadge.vue';

const props = defineProps<{ findings: Finding[]; repoUrl?: string | null; commitSha?: string | null }>();
const emit = defineEmits<{ triage: [id: string, status: string]; issue: [id: string] }>();
const expanded = ref<Set<string>>(new Set());
const sevFilter = ref<Severity | 'all'>('all');
const busyId = ref<string | null>(null);
const PAGE = 50;
const visibleCount = ref(PAGE);

/** Lien profond vers le fichier:ligne sur GitHub (si dispo). */
function ghLink(f: Finding): string | null {
  if (!props.repoUrl || !f.filePath) return null;
  const ref = props.commitSha || 'HEAD';
  return `${props.repoUrl}/blob/${ref}/${f.filePath}${f.line ? `#L${f.line}` : ''}`;
}

async function onIssue(f: Finding) {
  // Action sortante : crée une issue publique sur GitHub → on confirme d'abord.
  if (!window.confirm(`Créer une issue GitHub pour « ${f.title} » ?`)) return;
  busyId.value = f.id;
  emit('issue', f.id);
  // le parent remet busy a null via re-render ; on libere par securite
  setTimeout(() => (busyId.value === f.id ? (busyId.value = null) : null), 4000);
}

const ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const filtered = computed(() => {
  const list =
    sevFilter.value === 'all' ? props.findings : props.findings.filter((f) => f.severity === sevFilter.value);
  return [...list].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
});
// Pagination côté client (évite de rendre des centaines de findings d'un coup).
const visible = computed(() => filtered.value.slice(0, visibleCount.value));
watch([sevFilter, () => props.findings], () => (visibleCount.value = PAGE));

function toggle(id: string) {
  const s = new Set(expanded.value);
  s.has(id) ? s.delete(id) : s.add(id);
  expanded.value = s;
}
// Déplie / replie tous les findings actuellement rendus (triage de masse).
function expandAll() {
  expanded.value = new Set(visible.value.map((f) => f.id));
}
function collapseAll() {
  expanded.value = new Set();
}
const allExpanded = computed(
  () => visible.value.length > 0 && visible.value.every((f) => expanded.value.has(f.id)),
);
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        :aria-pressed="sevFilter === 'all'"
        :class="['rounded-full border px-3 py-1 text-xs', sevFilter === 'all' ? 'border-brand-500 text-white' : 'border-white/10 text-slate-400']"
        @click="sevFilter = 'all'"
      >
        Tout ({{ findings.length }})
      </button>
      <button
        v-for="s in ORDER"
        :key="s"
        type="button"
        :aria-pressed="sevFilter === s"
        :class="['rounded-full border px-3 py-1 text-xs', sevFilter === s ? 'border-brand-500 text-white' : 'border-white/10 text-slate-400']"
        @click="sevFilter = s"
      >
        {{ SEVERITY_LABELS[s] }} ({{ findings.filter((f) => f.severity === s).length }})
      </button>

      <!-- Déplier / replier en masse (utile pour trier beaucoup de findings). -->
      <button
        v-if="visible.length"
        type="button"
        class="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5"
        @click="allExpanded ? collapseAll() : expandAll()"
      >
        <component :is="allExpanded ? ChevronsDownUp : ChevronsUpDown" class="h-3.5 w-3.5" />
        {{ allExpanded ? 'Tout replier' : 'Tout déplier' }}
      </button>
    </div>

    <p v-if="!filtered.length" class="rounded-lg border border-white/5 bg-white/5 p-4 text-sm text-slate-400">
      Aucun problème pour ce filtre. 🎉
    </p>

    <ul class="space-y-2">
      <li v-for="f in visible" :key="f.id" class="card overflow-hidden">
        <button
          type="button"
          :aria-expanded="expanded.has(f.id)"
          :aria-controls="`finding-${f.id}`"
          class="flex w-full items-center gap-3 p-3 text-left"
          :class="f.status === 'ignored' ? 'opacity-50' : ''"
          @click="toggle(f.id)"
        >
          <SeverityBadge :severity="f.severity" />
          <span v-if="f.status === 'ignored'" class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">ignoré</span>
          <span class="min-w-0 flex-1 truncate text-sm">{{ f.title }}</span>
          <code v-if="f.filePath" class="hidden max-w-[40%] truncate text-[11px] text-slate-400 sm:block">
            {{ f.filePath }}{{ f.line ? `:${f.line}` : '' }}
          </code>
          <span class="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{{ f.tool }}</span>
        </button>

        <div v-if="expanded.has(f.id)" :id="`finding-${f.id}`" class="border-t border-white/5 bg-black/20 p-4 text-sm">
          <p v-if="f.description" class="mb-2 text-slate-300">{{ f.description }}</p>
          <p v-if="f.ruleId" class="mb-2 text-xs text-slate-500">Règle : <code>{{ f.ruleId }}</code></p>
          <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p class="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-300"><CircleCheck class="h-3.5 w-3.5" /> Correctif recommandé</p>
            <p class="text-sm text-slate-200">{{ f.remediation || 'Voir la référence.' }}</p>
          </div>
          <div class="mt-2 flex flex-wrap gap-3">
            <a v-if="ghLink(f)" :href="ghLink(f)!" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline">
              Voir sur GitHub <ExternalLink class="h-3 w-3" /> <code class="text-slate-400">{{ f.filePath }}{{ f.line ? `:${f.line}` : '' }}</code>
            </a>
            <a v-if="f.reference" :href="f.reference" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline">
              Référence <ExternalLink class="h-3 w-3" />
            </a>
          </div>

          <div v-if="auth.canWrite" class="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
            <button
              v-if="f.status !== 'ignored'"
              class="rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/5"
              @click="emit('triage', f.id, 'ignored')"
            >
              Ignorer (faux positif)
            </button>
            <button
              v-else
              class="rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/5"
              @click="emit('triage', f.id, 'open')"
            >
              Rouvrir
            </button>
            <button
              type="button"
              class="rounded-md border border-brand-500/40 px-2.5 py-1 text-xs text-brand-300 hover:bg-brand-500/10 disabled:opacity-50"
              :disabled="busyId === f.id"
              @click="onIssue(f)"
            >
              {{ busyId === f.id ? '...' : 'Créer une issue GitHub' }}
            </button>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="visibleCount < filtered.length" class="mt-3 text-center">
      <button class="btn-ghost" @click="visibleCount += PAGE">
        Voir plus ({{ filtered.length - visibleCount }} restant·s)
      </button>
    </div>
  </div>
</template>
