import type { ProviderConfig } from '@sovereignfs/sdk';

export interface GitHubOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

type Fetcher = typeof fetch;

export function buildGitHubOAuthUrl(config: ProviderConfig, state: string): string {
  const clientId = config.publicValues.clientId;
  if (!config.configured || !clientId || !config.callbackUrl) {
    throw new Error('GitHub OAuth is not configured for this instance.');
  }

  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', normalizeGitHubScopes(config.scopes).join(' '));
  return url.toString();
}

export async function exchangeGitHubOAuthCode(
  config: ProviderConfig,
  code: string,
  fetcher: Fetcher = fetch,
): Promise<GitHubOAuthTokens> {
  const clientId = config.publicValues.clientId;
  const clientSecret = config.secretValues.clientSecret;
  if (!config.configured || !clientId || !clientSecret || !config.callbackUrl) {
    throw new Error('GitHub OAuth is not configured for this instance.');
  }

  const response = await fetcher('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }),
  });
  if (!response.ok) {
    throw new Error('GitHub OAuth token exchange failed.');
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (body.error) {
    throw new Error(sanitizeGitHubOAuthError(body.error_description ?? body.error));
  }
  if (!body.access_token) {
    throw new Error('GitHub OAuth token response did not include an access token.');
  }

  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    ...(body.expires_in ? { expiresAt: Math.floor(Date.now() / 1000) + body.expires_in } : {}),
  };
}

export function normalizeGitHubScopes(scopes: readonly string[]): string[] {
  const normalized = scopes.length > 0 ? [...scopes] : ['repo', 'read:user'];
  if (!normalized.includes('read:user')) normalized.push('read:user');
  return [...new Set(normalized)];
}

function sanitizeGitHubOAuthError(message: string): string {
  if (/bad_verification_code/i.test(message)) return 'GitHub OAuth code is invalid or expired.';
  if (/redirect_uri/i.test(message)) return 'GitHub OAuth redirect URI does not match provider config.';
  return 'GitHub OAuth token exchange failed.';
}
