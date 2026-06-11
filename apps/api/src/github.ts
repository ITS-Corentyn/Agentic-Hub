import { Octokit } from '@octokit/rest';
import { prisma } from '@agentic-hub/db';
import { buildDependabotYaml } from '@agentic-hub/audit-engine';
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

/**
 * Ouvre (ou met à jour) une PR ajoutant un fichier au repo. Générique :
 * réutilisé pour Dependabot et le workflow de PR-check.
 */
export async function createFilePr(params: {
  fullName: string;
  branch: string;
  path: string;
  content: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}): Promise<string> {
  const gh = await client();
  const [owner, repo] = params.fullName.split('/');
  if (!owner || !repo) throw new Error('Repository invalide');

  const { data: info } = await gh.repos.get({ owner, repo });
  const base = info.default_branch;
  const { data: baseRef } = await gh.git.getRef({ owner, repo, ref: `heads/${base}` });

  try {
    await gh.git.createRef({ owner, repo, ref: `refs/heads/${params.branch}`, sha: baseRef.object.sha });
  } catch {
    /* branche déjà présente */
  }

  let sha: string | undefined;
  try {
    const { data } = await gh.repos.getContent({ owner, repo, path: params.path, ref: params.branch });
    if (!Array.isArray(data) && 'sha' in data) sha = data.sha;
  } catch {
    /* fichier absent */
  }

  await gh.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: params.path,
    message: params.commitMessage,
    content: Buffer.from(params.content, 'utf8').toString('base64'),
    branch: params.branch,
    sha,
  });

  const { data: existing } = await gh.pulls.list({
    owner,
    repo,
    head: `${owner}:${params.branch}`,
    state: 'open',
  });
  if (existing.length) return existing[0]!.html_url;

  const { data: pr } = await gh.pulls.create({
    owner,
    repo,
    title: params.prTitle,
    head: params.branch,
    base,
    body: params.prBody,
  });
  return pr.html_url;
}

const DEPENDABOT_BRANCH = 'agentic-hub/add-dependabot';

/**
 * Ouvre une PR qui ajoute `.github/dependabot.yml` au repo (remediation 1-clic).
 * Renvoie l'URL de la PR (existante ou nouvelle).
 */
export async function createDependabotPr(fullName: string, ecosystems: string[]): Promise<string> {
  const gh = await client();
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) throw new Error('Repository invalide');

  const { data: info } = await gh.repos.get({ owner, repo });
  const base = info.default_branch;
  const { data: baseRef } = await gh.git.getRef({ owner, repo, ref: `heads/${base}` });

  // Cree la branche de travail (ignore l'erreur si elle existe deja).
  try {
    await gh.git.createRef({ owner, repo, ref: `refs/heads/${DEPENDABOT_BRANCH}`, sha: baseRef.object.sha });
  } catch {
    /* branche deja presente */
  }

  // SHA du fichier existant (pour un update) le cas echeant.
  let sha: string | undefined;
  try {
    const { data } = await gh.repos.getContent({
      owner,
      repo,
      path: '.github/dependabot.yml',
      ref: DEPENDABOT_BRANCH,
    });
    if (!Array.isArray(data) && 'sha' in data) sha = data.sha;
  } catch {
    /* fichier absent */
  }

  const yaml = buildDependabotYaml(ecosystems);
  await gh.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: '.github/dependabot.yml',
    message: 'chore: ajout de la configuration Dependabot (Agentic-Hub)',
    content: Buffer.from(yaml, 'utf8').toString('base64'),
    branch: DEPENDABOT_BRANCH,
    sha,
  });

  const { data: existing } = await gh.pulls.list({
    owner,
    repo,
    head: `${owner}:${DEPENDABOT_BRANCH}`,
    state: 'open',
  });
  if (existing.length) return existing[0]!.html_url;

  const { data: pr } = await gh.pulls.create({
    owner,
    repo,
    title: 'chore: activer Dependabot',
    head: DEPENDABOT_BRANCH,
    base,
    body: 'Active les mises a jour automatiques des dependances.\n\n_Genere par Agentic-Hub._',
  });
  return pr.html_url;
}

/** Cree une issue GitHub a partir d'un finding. Renvoie l'URL de l'issue. */
export async function createIssueFromFinding(
  fullName: string,
  finding: {
    severity: string;
    dimension: string;
    tool: string;
    ruleId: string;
    title: string;
    description: string;
    filePath: string | null;
    line: number | null;
    remediation: string;
    reference: string | null;
  },
): Promise<string> {
  const gh = await client();
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) throw new Error('Repository invalide');

  const loc = finding.filePath ? `\`${finding.filePath}${finding.line ? `:${finding.line}` : ''}\`` : '—';
  const body = [
    `**Severite** : ${finding.severity}`,
    `**Dimension** : ${finding.dimension}`,
    `**Outil** : ${finding.tool}${finding.ruleId ? ` (\`${finding.ruleId}\`)` : ''}`,
    `**Emplacement** : ${loc}`,
    '',
    finding.description || '',
    '',
    '### Correctif recommande',
    finding.remediation || '—',
    finding.reference ? `\n**Reference** : ${finding.reference}` : '',
    '',
    '_Issue creee par Agentic-Hub._',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const { data } = await gh.issues.create({
    owner,
    repo,
    title: `[${finding.severity}] ${finding.title}`.slice(0, 250),
    body,
  });
  return data.html_url;
}
