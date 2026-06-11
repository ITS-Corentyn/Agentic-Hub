import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@agentic-hub/db';
import { config } from './config.js';

export interface SessionUser {
  id: string;
  login: string;
  role: string;
}

/** Chemins accessibles sans authentification. */
function isPublic(path: string): boolean {
  const p = path.split('?')[0]!;
  if (
    p === '/api/health' ||
    p === '/api/auth/me' ||
    p === '/api/auth/logout' ||
    p === '/api/auth/github/login' ||
    p === '/api/auth/github/callback' ||
    p === '/api/auth/github/status' ||
    p === '/api/system/version'
  ) {
    return true;
  }
  // Badges SVG (embarquables publiquement).
  if (p.startsWith('/api/badge/') || p.endsWith('.svg')) return true;
  return false;
}

/** Actions réservées aux administrateurs. */
function isAdminOnly(method: string, path: string): boolean {
  const p = path.split('?')[0]!;
  if (p.startsWith('/api/users')) return true;
  if (p === '/api/digest/test') return true;
  if (p === '/api/settings' && method !== 'GET') return true;
  return false;
}

/** Récupère l'utilisateur de session (cookie) si valide. */
export async function loadSessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const sid = (req as any).cookies?.[config.auth.cookieName];
  if (!sid) return null;
  const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || session.user.disabled) return null;
  return { id: session.user.id, login: session.user.login, role: session.user.role };
}

/**
 * Hook onRequest : authentification + autorisation par rôle.
 * Si l'auth n'est pas active (pas d'OAuth), tout est ouvert (mode mono-poste).
 */
export async function authHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!config.authActive) {
    (req as any).user = { id: 'local', login: 'local', role: 'admin' } satisfies SessionUser;
    return;
  }

  const user = await loadSessionUser(req);
  (req as any).user = user;

  const path = req.url;
  if (isPublic(path)) return;

  if (!user) {
    reply.code(401).send({ error: 'Authentification requise' });
    return;
  }

  // Comptes en attente d'approbation : aucun accès (hormis /auth/me, déjà public).
  if (user.role === 'pending') {
    reply.code(403).send({ error: 'Compte en attente d’approbation par un administrateur' });
    return;
  }

  const method = req.method.toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';

  if (isAdminOnly(method, path) && user.role !== 'admin') {
    reply.code(403).send({ error: 'Réservé aux administrateurs' });
    return;
  }
  // Mutations : interdites aux lecteurs.
  if (!isRead && user.role === 'viewer') {
    reply.code(403).send({ error: 'Action non autorisée (lecture seule)' });
    return;
  }
}
