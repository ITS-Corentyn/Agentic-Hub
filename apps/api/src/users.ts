import type { FastifyInstance } from 'fastify';
import { prisma } from '@agentic-hub/db';
import { RoleSchema } from '@agentic-hub/shared';
import type { SessionUser } from './auth-mw.js';

export async function registerUserRoutes(app: FastifyInstance) {
  // Liste des utilisateurs (admin). L'autorisation est assurée par le hook.
  app.get('/api/users', async () => {
    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        login: true,
        name: true,
        avatarUrl: true,
        role: true,
        disabled: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    return users;
  });

  // Modifie le rôle / l'état d'un utilisateur (admin).
  app.patch('/api/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = (req as any).user as SessionUser | null;
    const body = (req.body ?? {}) as { role?: string; disabled?: boolean };

    if (me && me.id === id && (body.role && body.role !== 'admin')) {
      return reply.code(400).send({ error: 'Impossible de retirer son propre rôle administrateur.' });
    }
    if (me && me.id === id && body.disabled === true) {
      return reply.code(400).send({ error: 'Impossible de désactiver son propre compte.' });
    }

    const data: Record<string, unknown> = {};
    if (body.role !== undefined) {
      const r = RoleSchema.safeParse(body.role);
      if (!r.success) return reply.code(400).send({ error: 'Rôle invalide' });
      data.role = r.data;
    }
    if (body.disabled !== undefined) data.disabled = Boolean(body.disabled);

    // Garde-fou : ne pas retirer le dernier admin.
    if (data.role && data.role !== 'admin') {
      const target = await prisma.user.findUnique({ where: { id } });
      if (target?.role === 'admin') {
        const admins = await prisma.user.count({ where: { role: 'admin', disabled: false } });
        if (admins <= 1) return reply.code(400).send({ error: 'Au moins un administrateur est requis.' });
      }
    }

    try {
      const updated = await prisma.user.update({ where: { id }, data });
      // Révoque les sessions si le compte est désactivé.
      if (data.disabled === true) await prisma.session.deleteMany({ where: { userId: id } });
      return {
        id: updated.id,
        login: updated.login,
        role: updated.role,
        disabled: updated.disabled,
      };
    } catch {
      return reply.code(404).send({ error: 'Utilisateur introuvable' });
    }
  });
}
