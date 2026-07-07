import { NextResponse } from 'next/server';
import { completeGitHubOAuthCallback } from '../../../_lib/actions';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (!state) return redirectTo(request, '/plainwrite?github_oauth=missing_state');
  if (error) return redirectTo(request, '/plainwrite?github_oauth=denied');
  if (!code) return redirectTo(request, '/plainwrite?github_oauth=missing_code');

  try {
    const projectId = await completeGitHubOAuthCallback({ code, state });
    return redirectTo(request, `/plainwrite/${projectId}/settings?github_oauth=connected`);
  } catch {
    return redirectTo(request, '/plainwrite?github_oauth=failed');
  }
}

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}
