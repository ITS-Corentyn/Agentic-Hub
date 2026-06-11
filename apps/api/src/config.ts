/** Configuration centralisée, dérivée des variables d'environnement. */
export const config = {
  port: Number(process.env.API_PORT ?? 3000),
  /** Environnement d'exécution ('production' active les garde-fous stricts). */
  nodeEnv: process.env.NODE_ENV ?? 'development',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? '',
  ingestToken: process.env.INGEST_TOKEN ?? 'change-me-ingest-token',
  /**
   * Secret de chiffrement au repos (tokens GitHub, mots de passe SMTP).
   * OBLIGATOIRE en production : le démarrage échoue s'il est absent (voir server.ts).
   * En dev, un repli est toléré (cf. crypto.ts) pour ne pas bloquer le local.
   */
  secretKey: process.env.AH_SECRET_KEY ?? '',
  github: {
    token: process.env.GITHUB_TOKEN ?? '',
    owner: process.env.GITHUB_OWNER ?? '',
    ownerType: (process.env.GITHUB_OWNER_TYPE ?? 'user') as 'user' | 'org',
    /** Repo hébergeant le workflow d'audit (owner/repo). Vide ⇒ mode local. */
    workflowRepo: process.env.AUDIT_WORKFLOW_REPO ?? '',
    workflowFile: process.env.AUDIT_WORKFLOW_FILE ?? 'audit.yml',
    /** Secret de vérification des webhooks GitHub (push → audit auto). */
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
    // GitHub App (alternative à l'OAuth : quotas élevés, permissions fines).
    app: {
      appId: process.env.GITHUB_APP_ID ?? '',
      // Clé privée PEM (ou base64 du PEM).
      privateKey: (() => {
        const raw = process.env.GITHUB_APP_PRIVATE_KEY ?? '';
        if (!raw) return '';
        return raw.includes('BEGIN') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8');
      })(),
      installationId: process.env.GITHUB_APP_INSTALLATION_ID ?? '',
    },
    oauth: {
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? '',
      /** URL de callback enregistrée dans l'OAuth App GitHub. */
      callbackUrl:
        process.env.GITHUB_OAUTH_CALLBACK_URL ??
        `http://localhost:${process.env.API_HOST_PORT ?? 3000}/api/auth/github/callback`,
      /** Scopes demandés : `repo` (repos privés) + `read:org` (organisations). */
      scope: process.env.GITHUB_OAUTH_SCOPE ?? 'repo read:org',
    },
  },
  ollama: {
    url: process.env.OLLAMA_URL ?? 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b',
    enabled: (process.env.OLLAMA_ENABLED ?? 'true') !== 'false',
  },
  // RBAC / multi-utilisateur.
  auth: {
    /** Activé par défaut ; ne s'applique réellement que si l'OAuth est configuré. */
    enabled: (process.env.AUTH_ENABLED ?? 'true') !== 'false',
    /** Rôle attribué aux nouveaux comptes (hors 1er = admin). */
    defaultRole: (process.env.AUTH_DEFAULT_ROLE ?? 'pending') as 'pending' | 'viewer' | 'member',
    /** Durée de session (jours). */
    sessionDays: Number(process.env.AUTH_SESSION_DAYS ?? 30),
    cookieName: 'ah_session',
    /** Cookie Secure (mettre true si servi en HTTPS). */
    cookieSecure: process.env.AUTH_COOKIE_SECURE === 'true',
  },
  /** true ⇒ déclenche GitHub Actions ; false ⇒ exécution locale (clone + scan). */
  get hybridMode(): boolean {
    return Boolean(this.github.workflowRepo && this.github.token);
  },
  /** L'auth ne s'applique que si activée ET OAuth configuré (sinon login impossible). */
  get authActive(): boolean {
    return this.auth.enabled && Boolean(this.github.oauth.clientId && this.github.oauth.clientSecret);
  },
};
