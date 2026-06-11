import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { config } from './config.js';
import { authHook } from './auth-mw.js';
import { registerRoutes } from './routes.js';
import { registerAuthRoutes } from './auth.js';
import { registerInsightRoutes } from './insights.js';
import { registerRemediationRoutes } from './remediation.js';
import { registerReportingRoutes } from './reporting.js';
import { registerSystemRoutes } from './system.js';
import { registerUserRoutes } from './users.js';
import { startQueue } from './queue.js';

// Fastify sérialise via JSON.stringify, qui ne gère pas les BigInt
// (ex: Repository.githubId). On les sérialise en chaîne.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function main() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 64 * 1024 * 1024, // payloads d'ingestion volumineux
  });

  await app.register(cors, {
    origin: [config.webOrigin],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true, // cookies de session
  });
  await app.register(cookie);

  // RBAC : authentification + autorisation (no-op si auth inactive).
  app.addHook('onRequest', authHook);

  // Tolère un corps JSON vide (les POST « déclencheurs » n'ont pas de body) :
  // évite l'erreur Fastify FST_ERR_CTP_EMPTY_JSON_BODY (400 Bad Request).
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const text = (body as string).trim();
      if (!text) return done(null, {});
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  await registerAuthRoutes(app);
  await registerRoutes(app);
  await registerInsightRoutes(app);
  await registerRemediationRoutes(app);
  await registerReportingRoutes(app);
  await registerSystemRoutes(app);
  await registerUserRoutes(app);

  // Démarre la file pg-boss (workers audit local + synthèse).
  try {
    await startQueue();
    app.log.info('File pg-boss démarrée');
  } catch (err) {
    app.log.error({ err }, 'Impossible de démarrer pg-boss (DB injoignable ?)');
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(
    `API prête sur :${config.port} — mode ${config.hybridMode ? 'hybride (GitHub Actions)' : 'local (clone + scan)'}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
