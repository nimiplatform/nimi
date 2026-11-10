import { isRuntimeClientRedirectUri } from '@nimiplatform/sdk/realm/runtime-client';

export type RuntimeConnectRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  state: string;
};

export function readRuntimeConnectRequest(search: string): RuntimeConnectRequest | null {
  const params = new URLSearchParams(search);
  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const state = params.get('state') || '';
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(clientId) || clientId.length > 120
    || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
    || !/^[A-Za-z0-9_-]{32,128}$/.test(state) || redirectUri.length > 2048) return null;
  if (!isRuntimeClientRedirectUri(redirectUri)) return null;
  return { clientId, redirectUri, codeChallenge, codeChallengeMethod: 'S256', state };
}

export function runtimeConnectSearch(request: RuntimeConnectRequest): string {
  return new URLSearchParams({ client_id: request.clientId, redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge, code_challenge_method: request.codeChallengeMethod, state: request.state }).toString();
}
