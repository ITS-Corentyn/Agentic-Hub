/** Configuration centralisée, dérivée des variables d'environnement. */
export const config = {
  port: Number(process.env.API_PORT ?? 3000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? '',
  ingestToken: process.env.INGEST_TOKEN ?? 'change-me-ingest-token',
  github: {
    token: process.env.GITHUB_TOKEN ?? '',
    owner: process.env.GITHUB_OWNER ?? '',
    ownerType: (process.env.GITHUB_OWNER_TYPE ?? 'user') as 'user' | 'org',
    /** Repo hébergeant le workflow d'audit (owner/repo). Vide ⇒ mode local. */
    workflowRepo: process.env.AUDIT_WORKFLOW_REPO ?? '',
    workflowFile: process.env.AUDIT_WORKFLOW_FILE ?? 'audit.yml',
  },
  ollama: {
    url: process.env.OLLAMA_URL ?? 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b',
    enabled: (process.env.OLLAMA_ENABLED ?? 'true') !== 'false',
  },
  /** true ⇒ déclenche GitHub Actions ; false ⇒ exécution locale (clone + scan). */
  get hybridMode(): boolean {
    return Boolean(this.github.workflowRepo && this.github.token);
  },
};
