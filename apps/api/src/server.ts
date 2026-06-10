import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { registerRoutes } from './routes.js';
import { startQueue } from './queue.js';

async function main() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 64 * 1024 * 1024, // payloads d'ingestion volumineux
  });

  await app.register(cors, {
    origin: [config.webOrigin],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  await registerRoutes(app);

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
