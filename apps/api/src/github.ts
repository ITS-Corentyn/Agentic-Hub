import { Octokit } from '@octokit/rest';
import { prisma } from '@agentic-hub/db';
import { config } from './config.js';

export interface RemoteRepo {
  githubId: number;
  fullName: string;
  name: string;
  owner: string;
  url: string;
  defaultBranch: string;
  language: string | null;
  private: boolean;
  description: string | null;
}

/**
 * Token GitHub actif : priorité au compte connecté via OAuth (table GithubAuth),
 * sinon le PAT d'environnement (GITHUB_TOKEN). Renvoie null si aucun.
 */
export async function getActiveToken(): Promise<string | null> {
  const auth = await prisma.githubAuth.findUnique({ where: { id: 1 } });
  if (auth?.accessToken) return auth.accessToken;
  return config.github.token || null;
}

async function client(): Promise<Octokit> {
  const token = await getActiveToken();
  if (!token) throw new Error('Aucune connexion GitHub : connecte un compte (OAuth) ou définis GITHUB_TOKEN.');
  return new Octokit({ auth: token });
}

function mapRepo(r: any, fallbackOwner: string): RemoteRepo {
  return {
    githubId: r.id,
    fullName: r.full_name,
    name: r.name,
    owner: r.owner?.login ?? fallbackOwner,
    url: r.html_url,
    defaultBranch: r.default_branch ?? 'main',
    language: r.language ?? null,
    private: r.private ?? false,
    description: r.description ?? null,
  };
}

/**
 * Liste les repositories accessibles.
 * - Compte connecté (OAuth) : tous les repos de l'utilisateur ET de ses organisations
 *   (affiliation owner + collaborateur + membre d'org).
 * - Sinon (PAT + owner explicite) : repos du user ou de l'org indiqué.
 */
export async function listRepositories(owner?: string, ownerType?: 'user' | 'org'): Promise<RemoteRepo[]> {
  const gh = await client();
  const connected = await prisma.githubAuth.findUnique({ where: { id: 1 } });

  // Si un owner explicite est demandé, on le respecte (filtrage ciblé).
  if (owner) {
    const repos =
      ownerType === 'org'
        ? await gh.paginate(gh.repos.listForOrg, { org: owner, per_page: 100, type: 'all' })
        : await gh.paginate(gh.repos.listForUser, { username: owner, per_page: 100, type: 'owner' });
    return repos.map((r) => mapRepo(r, owner));
  }

  // Compte connecté : uniquement les repos LIÉS au compte —
  // ceux qu'il possède + ceux de ses organisations (pas les repos externes
  // où il n'est que simple collaborateur).
  if (connected) {
    const repos = await gh.paginate(gh.repos.listForAuthenticatedUser, {
      per_page: 100,
      affiliation: 'owner,organization_member',
      visibility: 'all',
      sort: 'updated',
    });
    return repos.map((r) => mapRepo(r, connected.login));
  }

  // Fallback : owner d'environnement.
  if (config.github.owner) return listRepositories(config.github.owner, config.github.ownerType);
  return [];
}

/** Déclenche le workflow d'audit (mode hybride) via workflow_dispatch. */
export async function dispatchAuditWorkflow(params: {
  auditId: string;
  targetRepo: string;
  ref?: string;
}): Promise<void> {
  const gh = await client();
  const [owner, repo] = config.github.workflowRepo.split('/');
  if (!owner || !repo) throw new Error('AUDIT_WORKFLOW_REPO invalide (attendu owner/repo)');
  await gh.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: config.github.workflowFile,
    ref: params.ref ?? 'main',
    inputs: { audit_id: params.auditId, target_repo: params.targetRepo },
  });
}

/** SHA HEAD de la branche par défaut d'un repo. */
export async function getHeadSha(fullName: string, branch: string): Promise<string | null> {
  try {
    const gh = await client();
    const [owner, repo] = fullName.split('/');
    const { data } = await gh.repos.getBranch({ owner: owner!, repo: repo!, branch });
    return data.commit.sha;
  } catch {
    return null;
  }
}
