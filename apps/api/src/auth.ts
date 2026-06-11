import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@agentic-hub/db';
import { config } from './config.js';
import { loadSessionUser } from './auth-mw.js';

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
        id: number;
        login: string;
        name?: string;
        avatar_url?: string;
      };

      // RBAC : crée/maj le compte utilisateur (1er = admin) + session.
      if (config.authActive && user.id) {
        const isFirst = (await prisma.user.count()) === 0;
        const account = await prisma.user.upsert({
          where: { githubId: BigInt(user.id) },
          update: {
            login: user.login,
            name: user.name ?? null,
            avatarUrl: user.avatar_url ?? null,
            accessToken: tokenData.access_token,
            lastLoginAt: new Date(),
          },
          create: {
            githubId: BigInt(user.id),
            login: user.login,
            name: user.name ?? null,
            avatarUrl: user.avatar_url ?? null,
            accessToken: tokenData.access_token,
            role: isFirst ? 'admin' : config.auth.defaultRole,
            lastLoginAt: new Date(),
          },
        });
        const expiresAt = new Date(Date.now() + config.auth.sessionDays * 86_400_000);
        const session = await prisma.session.create({ data: { userId: account.id, expiresAt } });
        reply.setCookie(config.auth.cookieName, session.id, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: config.auth.cookieSecure,
          maxAge: config.auth.sessionDays * 86_400,
        });
      }

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

  // Utilisateur courant (pour l'UI : login requis ? rôle ?).
  app.get('/api/auth/me', async (req) => {
    const u = await loadSessionUser(req);
    let full = null;
    if (u) {
      const acc = await prisma.user.findUnique({
        where: { id: u.id },
        select: { login: true, name: true, avatarUrl: true, role: true },
      });
      full = acc;
    }
    return { authActive: config.authActive, user: full };
  });

  // Déconnexion de session (utilisateur courant).
  app.post('/api/auth/logout', async (req, reply) => {
    const sid = (req as any).cookies?.[config.auth.cookieName];
    if (sid) await prisma.session.deleteMany({ where: { id: sid } });
    reply.clearCookie(config.auth.cookieName, { path: '/' });
    return { ok: true };
  });

  // Déconnexion du compte de DONNÉES GitHub (admin / mode mono-poste).
  app.post('/api/auth/github/logout', async () => {
    await prisma.githubAuth.deleteMany({ where: { id: 1 } });
    return { ok: true };
  });
}
