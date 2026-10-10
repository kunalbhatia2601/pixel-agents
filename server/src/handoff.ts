/** Web links for a branch on its git host, built from the repo's remote URL. Nothing is called. */
export interface RepoLinks {
  repoUrl?: string;
  branchUrl?: string;
  createPrUrl?: string;
}

const enc = encodeURIComponent;

/** Strips `user:token@` from an https remote, so a PAT never reaches the UI. */
export function stripCredentials(remote: string): string {
  return remote.replace(/^(https?:\/\/)[^@/]+@/, '$1');
}

/**
 * Azure DevOps (dev.azure.com, *.visualstudio.com, ssh), GitHub and GitLab remotes → repo, branch and
 * "new pull request" pages. Unknown hosts get no links (the owner still has the push command).
 */
export function repoLinks(remote: string, branch: string, base: string): RepoLinks {
  const url = stripCredentials(remote.trim()).replace(/\.git$/, '');
  let m: RegExpMatchArray | null;

  // Azure DevOps: https://dev.azure.com/{org}/{project}/_git/{repo}
  //               https://{org}.visualstudio.com/{project}/_git/{repo}
  //               git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  let azure: string | undefined;
  if ((m = url.match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/))) {
    azure = `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3]}`;
  } else if ((m = url.match(/^https?:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/?#]+)/))) {
    azure = `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3]}`;
  } else if ((m = url.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)$/))) {
    azure = `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3]}`;
  }
  if (azure) {
    return {
      repoUrl: azure,
      branchUrl: `${azure}?version=GB${enc(branch)}`,
      createPrUrl: `${azure}/pullrequestcreate?sourceRef=${enc(branch)}&targetRef=${enc(base)}`,
    };
  }

  // GitHub / GitLab: https://host/owner/repo or git@host:owner/repo
  m =
    url.match(/^https?:\/\/(github\.com|gitlab\.com)\/(.+)$/) ??
    url.match(/^git@(github\.com|gitlab\.com):(.+)$/);
  if (m) {
    const web = `https://${m[1]}/${m[2]}`;
    if (m[1] === 'github.com') {
      return {
        repoUrl: web,
        branchUrl: `${web}/tree/${branch}`,
        createPrUrl: `${web}/compare/${base}...${branch}?expand=1`,
      };
    }
    return {
      repoUrl: web,
      branchUrl: `${web}/-/tree/${branch}`,
      createPrUrl: `${web}/-/merge_requests/new?merge_request[source_branch]=${enc(branch)}&merge_request[target_branch]=${enc(base)}`,
    };
  }
  return {};
}
