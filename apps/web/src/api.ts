// Client API typé (le backend partage les contrats via @agentic-hub/shared,
// mais le frontend reste découplé : on redéclare les vues nécessaires).

const BASE = import.meta.env.VITE_API_BASE ?? '';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Dimension =
  | 'security'
  | 'dependencies'
  | 'quality'
  | 'architecture'
  | 'backend'
  | 'frontend'
  | 'performance';
export type AuditStatus = 'queued' | 'running' | 'analyzing' | 'done' | 'failed';

export interface RepoSummary {
  id: string;
  fullName: string;
  name: string;
  owner: string;
  url: string | null;
  language: string | null;
  description: string | null;
  lastAuditAt: string | null;
  audits: { id: string; status: AuditStatus; globalScore: number | null; createdAt: string }[];
}

export interface DimensionResult {
  dimension: Dimension;
  score: number;
  summary: string;
  counts: Record<Severity, number>;
}

export interface Finding {
  id: string;
  dimension: Dimension;
  tool: string;
  severity: Severity;
  ruleId: string;
  title: string;
  description: string;
  filePath: string | null;
  line: number | null;
  remediation: string;
  reference: string | null;
}

export interface Synthesis {
  executiveSummary: string;
  top10: { rank: number; title: string; severity: Severity; dimension: Dimension; remediation: string }[];
  roadmap7d: { title: string; effort: string; impact: string }[];
  roadmap30d: { title: string; effort: string; impact: string }[];
  model: string;
  llmGenerated: boolean;
}

export interface AuditDetail {
  id: string;
  status: AuditStatus;
  globalScore: number | null;
  loc: number;
  files: number;
  languages: string[];
  toolsRun: string[];
  toolsSkipped: string[];
  commitSha: string | null;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  repository: RepoSummary;
  dimensions: DimensionResult[];
  synthesis: Synthesis | null;
  _count: { findings: number };
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  // N'ajoute Content-Type que s'il y a un corps : un POST sans body avec
  // Content-Type JSON est rejeté par Fastify (400 Bad Request).
  const headers: Record<string, string> = init?.body ? { 'Content-Type': 'application/json' } : {};
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface GithubStatus {
  connected: boolean;
  source: 'oauth' | 'pat' | 'none';
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  oauthConfigured?: boolean;
}

export const api = {
  health: () => http<{ ok: boolean; hybridMode: boolean; ollama: boolean }>('/api/health'),
  githubStatus: () => http<GithubStatus>('/api/auth/github/status'),
  githubLoginUrl: () => `${BASE}/api/auth/github/login`,
  githubLogout: () => http<{ ok: boolean }>('/api/auth/github/logout', { method: 'POST' }),
  listRepos: () => http<RepoSummary[]>('/api/repositories'),
  getRepo: (id: string) => http<RepoSummary>(`/api/repositories/${id}`),
  syncRepos: (owner?: string, ownerType?: 'user' | 'org') =>
    http<{ synced: number; created: number }>('/api/repositories/sync', {
      method: 'POST',
      body: JSON.stringify({ owner, ownerType }),
    }),
  startAudit: (repoId: string) =>
    http<{ auditId: string; mode: string }>(`/api/repositories/${repoId}/audits`, { method: 'POST' }),
  getAudit: (id: string) => http<AuditDetail>(`/api/audits/${id}`),
  getFindings: (id: string, params?: { dimension?: string; severity?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return http<Finding[]>(`/api/audits/${id}/findings${q ? `?${q}` : ''}`);
  },
  reportUrl: (id: string) => `${BASE}/api/audits/${id}/report.md`,
  getReportMarkdown: async (id: string) => {
    const res = await fetch(`${BASE}/api/audits/${id}/report.md`);
    return res.text();
  },
  getSettings: () => http<{ scoring: any }>('/api/settings'),
  saveSettings: (scoring: any) =>
    http<{ scoring: any }>('/api/settings', { method: 'PUT', body: JSON.stringify({ scoring }) }),
  getDependabot: (repoId: string) => http<{ yaml: string }>(`/api/repositories/${repoId}/dependabot`),
  streamUrl: (id: string) => `${BASE}/api/audits/${id}/stream`,
};
