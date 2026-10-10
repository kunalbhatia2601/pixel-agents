import { describe, expect, it } from 'vitest';

import { repoLinks, stripCredentials } from '../src/handoff.js';

describe('repoLinks', () => {
  it('Azure DevOps https remote with a PAT: credentials stripped, encoded project kept', () => {
    const links = repoLinks(
      'https://user:secret@dev.azure.com/vidalhealth/Vidal%20Domestic/_git/vh-medcare-fe',
      'agent/fix-x-1a2b',
      'develop',
    );
    expect(links.repoUrl).toBe(
      'https://dev.azure.com/vidalhealth/Vidal%20Domestic/_git/vh-medcare-fe',
    );
    expect(links.branchUrl).toBe(`${links.repoUrl}?version=GBagent%2Ffix-x-1a2b`);
    expect(links.createPrUrl).toBe(
      `${links.repoUrl}/pullrequestcreate?sourceRef=agent%2Ffix-x-1a2b&targetRef=develop`,
    );
    expect(JSON.stringify(links)).not.toContain('secret');
  });

  it('Azure DevOps visualstudio.com and ssh remotes map to dev.azure.com', () => {
    expect(repoLinks('https://acme.visualstudio.com/Proj/_git/api', 'b', 'main').repoUrl).toBe(
      'https://dev.azure.com/acme/Proj/_git/api',
    );
    expect(repoLinks('git@ssh.dev.azure.com:v3/acme/Proj/api', 'b', 'main').repoUrl).toBe(
      'https://dev.azure.com/acme/Proj/_git/api',
    );
  });

  it('GitHub https and ssh remotes', () => {
    const https = repoLinks('https://github.com/me/pixel-agents.git', 'agent/x', 'main');
    expect(https).toEqual({
      repoUrl: 'https://github.com/me/pixel-agents',
      branchUrl: 'https://github.com/me/pixel-agents/tree/agent/x',
      createPrUrl: 'https://github.com/me/pixel-agents/compare/main...agent/x?expand=1',
    });
    expect(repoLinks('git@github.com:me/pixel-agents.git', 'b', 'main').repoUrl).toBe(
      'https://github.com/me/pixel-agents',
    );
  });

  it('unknown hosts get no links', () => {
    expect(repoLinks('ssh://git@example.internal/repo.git', 'b', 'main')).toEqual({});
  });

  it('stripCredentials leaves credential-free remotes alone', () => {
    expect(stripCredentials('https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(stripCredentials('https://tok@host/x')).toBe('https://host/x');
  });
});
