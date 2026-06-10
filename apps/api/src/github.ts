import { Octokit } from '@octokit/rest';
import { config } from './config.js';

let octokit: Octokit | null = null;
function client(): Octokit {
  if (!config.github.token) throw new Error('GITHUB_TOKEN non configuré');
  octokit ??= new Octokit({ auth: config.github.token });
  return octokit;
}

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

/** Liste les repositories d'un user ou d'une org via l'API GitHub. */
export async function listRepositories(
  owner = config.github.owner,
  ownerType = config.github.ownerType,
): Promise<RemoteRepo[]> {
  const gh = client();
  const repos =
    ownerType === 'org'
      ? await gh.paginate(gh.repos.listForOrg, { org: owner, per_page: 100, type: 'all' })
      : await gh.paginate(gh.repos.listForUser, { username: owner, per_page: 100, type: 'owner' });

  return repos.map((r) => ({
    githubId: r.id,
    fullName: r.full_name,
    name: r.name,
    owner: r.owner?.login ?? owner,
    url: r.html_url,
    defaultBranch: r.default_branch ?? 'main',
    language: r.language ?? null,
    private: r.private ?? false,
    description: r.description ?? null,
  }));
}

/**
 * Déclenche le workflow d'audit (mode hybride) via workflow_dispatch.
 * Transmet l'identifiant d'audit et le repo cible en inputs.
 */
export async function dispatchAuditWorkflow(params: {
  auditId: string;
  targetRepo: string; // owner/repo à auditer
  ref?: string;
}): Promise<void> {
  const gh = client();
  const [owner, repo] = config.github.workflowRepo.split('/');
  if (!owner || !repo) throw new Error('AUDIT_WORKFLOW_REPO invalide (attendu owner/repo)');
  await gh.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: config.github.workflowFile,
    ref: params.ref ?? 'main',
    inputs: {
      audit_id: params.auditId,
      target_repo: params.targetRepo,
    },
  });
}

/** Récupère le SHA HEAD de la branche par défaut d'un repo. */
export async function getHeadSha(fullName: string, branch: string): Promise<string | null> {
  try {
    const gh = client();
    const [owner, repo] = fullName.split('/');
    const { data } = await gh.repos.getBranch({ owner: owner!, repo: repo!, branch });
    return data.commit.sha;
  } catch {
    return null;
  }
}
