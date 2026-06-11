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
  auditSchedule?: 'off' | 'daily' | 'weekly';
  lighthouseUrl?: string | null;
  audits: {
    id: string;
    status: AuditStatus;
    globalScore: number | null;
    gatePassed?: boolean | null;
    createdAt: string;
  }[];
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
  status?: 'open' | 'fixed' | 'ignored';
  note?: string | null;
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
  gatePassed?: boolean | null;
  gateReasons?: string[];
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
  pdfUrl: (id: string) => `${BASE}/api/audits/${id}/report.pdf`,
  csvUrl: (id: string) => `${BASE}/api/audits/${id}/findings.csv`,
  badgeUrl: (repoId: string) => `${BASE}/api/repositories/${repoId}/badge.svg`,
  getReportMarkdown: async (id: string) => {
    const res = await fetch(`${BASE}/api/audits/${id}/report.md`);
    return res.text();
  },
  // -- Tendances / diff / stats --
  getTrend: (repoId: string) =>
    http<{ auditId: string; date: string; score: number; findings: number; commit: string | null }[]>(
      `/api/repositories/${repoId}/trend`,
    ),
  getDiff: (auditId: string) =>
    http<{
      previousAuditId: string | null;
      deltaScore: number | null;
      counts: { added: number; fixed: number; persistent: number };
      added: { id: string; severity: Severity; dimension: Dimension; title: string; filePath: string | null }[];
      fixed: { id: string; severity: Severity; dimension: Dimension; title: string; filePath: string | null }[];
    }>(`/api/audits/${auditId}/diff`),
  searchFindings: (params: { q?: string; severity?: string; dimension?: string }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>,
    ).toString();
    return http<
      {
        id: string;
        severity: Severity;
        dimension: Dimension;
        tool: string;
        title: string;
        filePath: string | null;
        line: number | null;
        repo: { repoId: string; fullName: string } | null;
      }[]
    >(`/api/findings/search${qs ? `?${qs}` : ''}`);
  },
  systemVersion: () =>
    http<{ current: string | null; latest: string | null; updateAvailable: boolean }>(
      '/api/system/version',
    ),
  getOverview: () =>
    http<{
      repoCount: number;
      auditedCount: number;
      avgScore: number;
      severityTotals: Record<Severity, number>;
      worstRepos: { id: string; fullName: string; score: number }[];
      topRules: { rule: string; count: number }[];
    }>('/api/stats/overview'),

  // -- Remediation --
  patchFinding: (id: string, data: { status?: string; note?: string }) =>
    http<Finding>(`/api/findings/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createDependabotPr: (repoId: string) =>
    http<{ url: string }>(`/api/repositories/${repoId}/dependabot-pr`, { method: 'POST', body: '{}' }),
  createIssue: (findingId: string) =>
    http<{ url: string }>(`/api/findings/${findingId}/issue`, { method: 'POST', body: '{}' }),
  createPrCheck: (repoId: string) =>
    http<{ url: string }>(`/api/repositories/${repoId}/pr-check`, { method: 'POST', body: '{}' }),
  setLighthouse: (repoId: string, url: string | null) =>
    http<{ lighthouseUrl: string | null }>(`/api/repositories/${repoId}/lighthouse`, {
      method: 'PUT',
      body: JSON.stringify({ url }),
    }),

  getSettings: () =>
    http<{ scoring: any; policy: any; notify: { webhookUrl: string; mode: string }; email: any }>(
      '/api/settings',
    ),
  saveSettings: (data: { scoring?: any; policy?: any; notify?: any; email?: any }) =>
    http<{ scoring: any; policy: any; notify: any; email: any }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  sendDigestTest: () =>
    http<{ sent: boolean; message: string }>('/api/digest/test', { method: 'POST', body: '{}' }),
  setSchedule: (repoId: string, schedule: string) =>
    http<{ auditSchedule: string }>(`/api/repositories/${repoId}/schedule`, {
      method: 'PUT',
      body: JSON.stringify({ schedule }),
    }),
  setPolicy: (repoId: string, policy: any) =>
    http<{ policy: any }>(`/api/repositories/${repoId}/policy`, {
      method: 'PUT',
      body: JSON.stringify({ policy }),
    }),
  getDependabot: (repoId: string) => http<{ yaml: string }>(`/api/repositories/${repoId}/dependabot`),
  streamUrl: (id: string) => `${BASE}/api/audits/${id}/stream`,
};
