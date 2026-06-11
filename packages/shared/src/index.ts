import { z } from 'zod';

/**
 * Contrats partagés entre le moteur d'audit (audit-engine), l'API et le frontend.
 * Source de vérité unique pour les findings, dimensions, scoring et ingestion.
 */

// ──────────────────────────────────────────────────────────────
// Sévérité & dimensions
// ──────────────────────────────────────────────────────────────

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

/** Poids de pénalité par occurrence d'un finding, par sévérité. */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 1.5,
  info: 0.2,
};

/** Ordre de tri (plus c'est haut, plus c'est prioritaire). */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export const DIMENSIONS = [
  'security',
  'dependencies',
  'quality',
  'architecture',
  'backend',
  'frontend',
  'performance',
] as const;
export const DimensionSchema = z.enum(DIMENSIONS);
export type Dimension = z.infer<typeof DimensionSchema>;

export const DIMENSION_LABELS: Record<Dimension, string> = {
  security: 'Sécurité',
  dependencies: 'Dépendances',
  quality: 'Qualité de code',
  architecture: 'Architecture',
  backend: 'Backend',
  frontend: 'Frontend',
  performance: 'Performance',
};

/** Outils open-source supportés (source des findings). */
export const TOOLS = [
  'semgrep',
  'gitleaks',
  'trivy',
  'osv-scanner',
  'codeql',
  'eslint',
  'jscpd',
  'dependency-cruiser',
  'madge',
  'lighthouse',
  'npm-audit',
  'depcheck',
  'ts-prune',
  'engine', // findings synthétiques produits par le moteur (ex: dependabot manquant)
] as const;
export const ToolSchema = z.enum(TOOLS);
export type ToolName = z.infer<typeof ToolSchema>;

// ──────────────────────────────────────────────────────────────
// Finding
// ──────────────────────────────────────────────────────────────

export const FindingSchema = z.object({
  dimension: DimensionSchema,
  tool: ToolSchema,
  severity: SeveritySchema,
  ruleId: z.string().default(''),
  title: z.string(),
  description: z.string().default(''),
  filePath: z.string().nullable().default(null),
  line: z.number().int().nonnegative().nullable().default(null),
  /** Action de remédiation concrète et actionnable. */
  remediation: z.string().default(''),
  /** Lien de référence (CVE, doc règle, advisory). */
  reference: z.string().nullable().default(null),
  /** Empreinte stable pour dédoublonnage entre audits. */
  fingerprint: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

// ──────────────────────────────────────────────────────────────
// Métriques & résultat par dimension
// ──────────────────────────────────────────────────────────────

export const RepoMetricsSchema = z.object({
  /** Lignes de code analysées (normalisation du score). */
  loc: z.number().int().nonnegative().default(0),
  files: z.number().int().nonnegative().default(0),
  languages: z.array(z.string()).default([]),
});
export type RepoMetrics = z.infer<typeof RepoMetricsSchema>;

export const DimensionResultSchema = z.object({
  dimension: DimensionSchema,
  score: z.number().min(0).max(100),
  summary: z.string().default(''),
  counts: z.record(SeveritySchema, z.number().int().nonnegative()),
});
export type DimensionResult = z.infer<typeof DimensionResultSchema>;

// ──────────────────────────────────────────────────────────────
// Configuration de scoring
// ──────────────────────────────────────────────────────────────

export const ScoringConfigSchema = z.object({
  /** Pondération de chaque dimension dans le score global (somme normalisée). */
  weights: z.record(DimensionSchema, z.number().nonnegative()),
  /** Pénalité par sévérité (override des défauts). */
  penalty: z.record(SeveritySchema, z.number().nonnegative()).optional(),
  /** Échelle de normalisation : nombre de LOC pour lequel la pénalité est appliquée telle quelle. */
  locBaseline: z.number().int().positive().default(2000),
});
export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;

export const DEFAULT_SCORING: ScoringConfig = {
  weights: {
    security: 30,
    dependencies: 15,
    quality: 15,
    architecture: 15,
    backend: 10,
    frontend: 8,
    performance: 7,
  },
  locBaseline: 2000,
};

// ──────────────────────────────────────────────────────────────
// Payload d'ingestion (CI → API) & résultat unifié du moteur
// ──────────────────────────────────────────────────────────────

export const AuditResultSchema = z.object({
  /** Identifiant d'audit (créé par l'API avant le dispatch). Optionnel pour runs locaux. */
  auditId: z.string().nullable().default(null),
  repository: z.object({
    fullName: z.string(),
    url: z.string().nullable().default(null),
  }),
  commitSha: z.string().nullable().default(null),
  metrics: RepoMetricsSchema,
  findings: z.array(FindingSchema),
  dimensions: z.array(DimensionResultSchema),
  globalScore: z.number().min(0).max(100),
  /** Outils réellement exécutés (présents dans l'environnement). */
  toolsRun: z.array(ToolSchema).default([]),
  /** Outils ignorés (non installés) — transparence sur la couverture. */
  toolsSkipped: z.array(ToolSchema).default([]),
  generatedAt: z.string(), // ISO
});
export type AuditResult = z.infer<typeof AuditResultSchema>;

// ──────────────────────────────────────────────────────────────
// Statut d'audit & synthèse LLM
// ──────────────────────────────────────────────────────────────

export const AUDIT_STATUSES = ['queued', 'running', 'analyzing', 'done', 'failed'] as const;
export const AuditStatusSchema = z.enum(AUDIT_STATUSES);
export type AuditStatus = z.infer<typeof AuditStatusSchema>;

export const RoadmapItemSchema = z.object({
  title: z.string(),
  dimension: DimensionSchema.optional(),
  effort: z.enum(['S', 'M', 'L']).default('M'),
  impact: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});
export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;

export const SynthesisSchema = z.object({
  executiveSummary: z.string(),
  top10: z.array(
    z.object({
      rank: z.number().int().positive(),
      title: z.string(),
      severity: SeveritySchema,
      dimension: DimensionSchema,
      remediation: z.string(),
    }),
  ),
  roadmap7d: z.array(RoadmapItemSchema),
  roadmap30d: z.array(RoadmapItemSchema),
  model: z.string(),
  /** true si généré par Ollama, false si gabarit statique (fallback). */
  llmGenerated: z.boolean(),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

// ──────────────────────────────────────────────────────────────
// DTO API
// ──────────────────────────────────────────────────────────────

export const AuditTriggerSchema = z.enum(['manual', 'schedule', 'ci']);
export type AuditTrigger = z.infer<typeof AuditTriggerSchema>;

// ──────────────────────────────────────────────────────────────
// RBAC : rôles utilisateurs
// ──────────────────────────────────────────────────────────────
export const ROLES = ['admin', 'member', 'viewer', 'pending'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  member: 'Membre',
  viewer: 'Lecture seule',
  pending: 'En attente',
};

// ──────────────────────────────────────────────────────────────
// Gouvernance : politique de qualité (gate) & planning
// ──────────────────────────────────────────────────────────────

export const PolicySchema = z.object({
  /** Score global minimum requis (sinon gate KO). */
  minScore: z.number().min(0).max(100).nullable().default(null),
  /** Nombre max de findings critiques toléré. */
  maxCritical: z.number().int().nonnegative().nullable().default(0),
  /** Nombre max de findings élevés toléré. */
  maxHigh: z.number().int().nonnegative().nullable().default(null),
});
export type Policy = z.infer<typeof PolicySchema>;

export const DEFAULT_POLICY: Policy = { minScore: null, maxCritical: 0, maxHigh: null };

export interface GateResult {
  passed: boolean;
  reasons: string[];
}

export const AUDIT_SCHEDULES = ['off', 'daily', 'weekly'] as const;
export const AuditScheduleSchema = z.enum(AUDIT_SCHEDULES);
export type AuditSchedule = z.infer<typeof AuditScheduleSchema>;

// Notifications (webhook compatible Slack/Mattermost/Discord + déclencheur).
export const NOTIFY_MODES = ['off', 'always', 'critical', 'score-drop'] as const;
export const NotifyConfigSchema = z.object({
  webhookUrl: z.string().default(''),
  mode: z.enum(NOTIFY_MODES).default('off'),
});
export type NotifyConfig = z.infer<typeof NotifyConfigSchema>;

// Configuration SMTP du digest e-mail hebdomadaire.
export const EmailConfigSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default(''),
  port: z.number().int().positive().default(587),
  secure: z.boolean().default(false),
  user: z.string().default(''),
  pass: z.string().default(''),
  from: z.string().default(''),
  to: z.string().default(''),
});
export type EmailConfig = z.infer<typeof EmailConfigSchema>;

export interface SseEvent {
  type: 'status' | 'log' | 'done' | 'error';
  auditId: string;
  status?: AuditStatus;
  message?: string;
  progress?: number; // 0..100
}

export { z };
