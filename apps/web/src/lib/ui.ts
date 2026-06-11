import type { Dimension, Severity } from '../api';

export const DIMENSION_LABELS: Record<Dimension, string> = {
  security: 'Sécurité',
  dependencies: 'Dépendances',
  quality: 'Qualité',
  architecture: 'Architecture',
  backend: 'Backend',
  frontend: 'Frontend',
  performance: 'Performance',
};

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  member: 'Membre',
  viewer: 'Lecture seule',
  pending: 'En attente',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critique',
  high: 'Élevé',
  medium: 'Moyen',
  low: 'Faible',
  info: 'Info',
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  medium: 'bg-yellow-500/15 text-yellow-200 border-yellow-500/30',
  low: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  info: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

/** Couleur de score (vert→rouge). */
export function scoreColor(score: number): string {
  if (score >= 90) return '#34d399';
  if (score >= 75) return '#a3e635';
  if (score >= 50) return '#fbbf24';
  if (score >= 30) return '#fb923c';
  return '#f87171';
}

export function statusLabel(status: string): string {
  return (
    {
      queued: 'En file',
      running: 'Scan en cours',
      analyzing: 'Analyse',
      done: 'Terminé',
      failed: 'Échec',
    }[status] ?? status
  );
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'jamais';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}
