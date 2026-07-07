import { describe, expect, it } from 'vitest';
import {
  buildGitHubOAuthUrl,
  exchangeGitHubOAuthCode,
  normalizeGitHubScopes,
} from '../oauth-rules';
import type { ProviderConfig } from '@sovereignfs/sdk';

const config: ProviderConfig = {
  provider: 'git.github',
  label: 'GitHub',
  configured: true,
  source: 'env',
  publicValues: { clientId: 'client-id' },
  secretValues: { clientSecret: 'client-secret' },
  callbackUrl: 'https://example.test/plainwrite/oauth/github/callback',
  scopes: ['repo'],
  missingRequired: [],
};

describe('OAuth rules', () => {
  it('builds a GitHub authorization URL from provider config and state', () => {
    const url = new URL(buildGitHubOAuthUrl(config, 'state-token'));

    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://example.test/plainwrite/oauth/github/callback',
    );
    expect(url.searchParams.get('state')).toBe('state-token');
    expect(url.searchParams.get('scope')).toBe('repo read:user');
  });

  it('normalizes GitHub scopes for repo publishing and user lookup', () => {
    expect(normalizeGitHubScopes([])).toEqual(['repo', 'read:user']);
    expect(normalizeGitHubScopes(['repo', 'read:user', 'repo'])).toEqual(['repo', 'read:user']);
  });

  it('exchanges OAuth code without exposing provider error details', async () => {
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        client_id: 'client-id',
        client_secret: 'client-secret',
        code: 'oauth-code',
        redirect_uri: 'https://example.test/plainwrite/oauth/github/callback',
      });
      return {
        ok: true,
        json: async () => ({ access_token: 'access-token', expires_in: 3600 }),
      } as Response;
    }) as typeof fetch;

    await expect(exchangeGitHubOAuthCode(config, 'oauth-code', fetcher)).resolves.toMatchObject({
      accessToken: 'access-token',
    });
  });

  it('rejects unconfigured provider config', async () => {
    const unconfigured = { ...config, configured: false };

    expect(() => buildGitHubOAuthUrl(unconfigured, 'state-token')).toThrow(
      'GitHub OAuth is not configured for this instance.',
    );
    await expect(exchangeGitHubOAuthCode(unconfigured, 'oauth-code')).rejects.toThrow(
      'GitHub OAuth is not configured for this instance.',
    );
  });
});
