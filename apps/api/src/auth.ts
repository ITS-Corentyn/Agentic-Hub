import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@agentic-hub/db';
import { config } from './config.js';

/** États OAuth en attente (anti-CSRF), en mémoire avec expiration courte. */
const pendingStates = new Map<string, number>();
const STATE_TTL = 10 * 60 * 1000;

function newState(): string {
  const state = randomUUID();
  pendingStates.set(state, Date.now() + STATE_TTL);
  return state;
}
function consumeState(state: string): boolean {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return !!exp && exp > Date.now();
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // Statut de connexion (compte OAuth, sinon PAT d'environnement).
  app.get('/api/auth/github/status', async () => {
    const auth = await prisma.githubAuth.findUnique({ where: { id: 1 } });
    if (auth) {
      return {
        connected: true,
        source: 'oauth' as const,
        login: auth.login,
        name: auth.name,
        avatarUrl: auth.avatarUrl,
      };
    }
    if (config.github.token) {
      return { connected: true, source: 'pat' as const, login: null, name: null, avatarUrl: null };
    }
    return {
      connected: false,
      source: 'none' as const,
      // Indique si le bouton « Se connecter » peut fonctionner.
      oauthConfigured: Boolean(config.github.oauth.clientId && config.github.oauth.clientSecret),
    };
  });

  // Démarre le flux OAuth : redirige vers GitHub.
  app.get('/api/auth/github/login', async (_req, reply) => {
    const { clientId, callbackUrl, scope } = config.github.oauth;
    if (!clientId) {
      return reply
        .code(400)
        .send({ error: 'OAuth GitHub non configuré (GITHUB_OAUTH_CLIENT_ID / SECRET manquants).' });
    }
    const state = newState();
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  });

  // Callback OAuth : échange le code, récupère l'utilisateur, stocke le token.
  app.get('/api/auth/github/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state || !consumeState(state)) {
      return reply.redirect(`${config.webOrigin}/?github=error`);
    }
    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: config.github.oauth.clientId,
          client_secret: config.github.oauth.clientSecret,
          code,
          redirect_uri: config.github.oauth.callbackUrl,
        }),
      });
      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        scope?: string;
        token_type?: string;
        error?: string;
      };
      if (!tokenData.access_token) {
        req.log.error({ err: tokenData.error }, 'Échange OAuth échoué');
        return reply.redirect(`${config.webOrigin}/?github=error`);
      }

      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'agentic-hub',
        },
      });
      const user = (await userRes.json()) as {
        login: string;
        name?: string;
        avatar_url?: string;
      };

      await prisma.githubAuth.upsert({
        where: { id: 1 },
        update: {
          login: user.login,
          name: user.name ?? null,
          avatarUrl: user.avatar_url ?? null,
          accessToken: tokenData.access_token,
          scope: tokenData.scope ?? null,
          tokenType: tokenData.token_type ?? null,
          connectedAt: new Date(),
        },
        create: {
          id: 1,
          login: user.login,
          name: user.name ?? null,
          avatarUrl: user.avatar_url ?? null,
          accessToken: tokenData.access_token,
          scope: tokenData.scope ?? null,
          tokenType: tokenData.token_type ?? null,
        },
      });

      return reply.redirect(`${config.webOrigin}/?github=connected`);
    } catch (err) {
      req.log.error({ err }, 'Callback OAuth en erreur');
      return reply.redirect(`${config.webOrigin}/?github=error`);
    }
  });

  // Déconnexion : supprime le token stocké.
  app.post('/api/auth/github/logout', async () => {
    await prisma.githubAuth.deleteMany({ where: { id: 1 } });
    return { ok: true };
  });
}
