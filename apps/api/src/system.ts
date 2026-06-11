import type { FastifyInstance } from 'fastify';
import { getHeadSha } from './github.js';

// Repo source de l'outil (pour détecter une mise à jour). Surchageable.
const SELF_REPO = process.env.AH_SELF_REPO ?? 'ITS-Corentyn/Agentic-Hub';

export async function registerSystemRoutes(app: FastifyInstance) {
  // Version courante (SHA de build) vs dernier `main` du dépôt → mise à jour dispo ?
  app.get('/api/system/version', async () => {
    const current = process.env.AH_BUILD_SHA ?? '';
    let latest = '';
    try {
      latest = (await getHeadSha(SELF_REPO, 'main')) ?? '';
    } catch {
      /* pas de token / repo injoignable */
    }
    const updateAvailable = Boolean(current && latest && current !== latest);
    return {
      current: current ? current.slice(0, 8) : null,
      latest: latest ? latest.slice(0, 8) : null,
      updateAvailable,
    };
  });
}
