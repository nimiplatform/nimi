import { desktopBridge } from '@renderer/bridge';

const CODEX_OAUTH_ISSUER = 'https://auth.openai.com';
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_DEVICE_AUTH_USERCODE_URL = `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`;
const CODEX_DEVICE_AUTH_TOKEN_URL = `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`;
const CODEX_OAUTH_TOKEN_URL = `${CODEX_OAUTH_ISSUER}/oauth/token`;
const CODEX_DEVICE_AUTH_REDIRECT_URI = `${CODEX_OAUTH_ISSUER}/deviceauth/callback`;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const MIN_POLL_INTERVAL_SECONDS = 3;
const DEFAULT_EXPIRES_IN_SECONDS = 15 * 60;

type CodexOAuthBridge = Pick<
  typeof desktopBridge,
  'proxyHttp' | 'openExternalUrl' | 'oauthTokenExchange'
>;

type DeviceCodeResponse = {
  user_code: string;
  device_auth_id: string;
  interval?: number | string;
  expires_in?: number | string;
  verification_uri_complete?: string;
};

type DevicePollResponse = {
  authorization_code: string;
  code_verifier: string;
};

export type CodexOAuthPendingState = {
  userCode: string;
  verificationUrl: string;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
};

export type CodexManagedCredentialAcquisition = {
  accessToken: string;
  credentialJson: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string;
  accountId?: string;
};

type AcquireCodexManagedCredentialOptions = {
  bridge?: CodexOAuthBridge;
  onPending?: (state: CodexOAuthPendingState) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toPositiveInt(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number'
    ? value
    : Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function parseJsonObject(body: string, errorLabel: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(body || ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${errorLabel} returned a non-object JSON payload`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown parse error');
    throw new Error(`${errorLabel} returned invalid JSON: ${message}`, { cause: error });
  }
}

async function postJson(
  bridge: CodexOAuthBridge,
  url: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; ok: boolean; body: string }> {
  return bridge.proxyHttp({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

function decodeJwtClaims(accessToken: string): Record<string, unknown> | null {
  const parts = String(accessToken || '').trim().split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const base64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const jsonText = atob(base64);
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function codexAccountIdFromAccessToken(accessToken: string): string {
  const claims = decodeJwtClaims(accessToken);
  if (!claims) {
    return '';
  }
  const authClaims = claims['https://api.openai.com/auth'];
  if (!authClaims || typeof authClaims !== 'object' || Array.isArray(authClaims)) {
    return '';
  }
  return toTrimmedString((authClaims as Record<string, unknown>).chatgpt_account_id);
}

export function buildCodexManagedCredentialJson(input: {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  now?: number;
}): string {
  const accessToken = toTrimmedString(input.accessToken);
  if (!accessToken) {
    throw new Error('Codex credential payload requires an access token');
  }
  const refreshToken = toTrimmedString(input.refreshToken);
  const tokenType = toTrimmedString(input.tokenType);
  const scope = toTrimmedString(input.scope);
  const accountId = codexAccountIdFromAccessToken(accessToken);
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const expiresIn = Number.isFinite(input.expiresIn) && Number(input.expiresIn) > 0
    ? Math.trunc(Number(input.expiresIn))
    : undefined;
  const expiresAt = typeof expiresIn === 'number'
    ? new Date(now + expiresIn * 1000).toISOString()
    : undefined;

  return JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken || undefined,
    token_type: tokenType || undefined,
    scope: scope || undefined,
    expires_in: expiresIn,
    expires_at: expiresAt,
    account_id: accountId || undefined,
    auth_mode: 'chatgpt',
    source: 'device-code',
    issuer: CODEX_OAUTH_ISSUER,
    obtained_at: new Date(now).toISOString(),
  });
}

export async function acquireCodexManagedCredential(
  options: AcquireCodexManagedCredentialOptions = {},
): Promise<CodexManagedCredentialAcquisition> {
  const bridge = options.bridge || desktopBridge;
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  }));
  const now = options.now || (() => Date.now());

  const deviceCodeResponse = await postJson(bridge, CODEX_DEVICE_AUTH_USERCODE_URL, {
    client_id: CODEX_OAUTH_CLIENT_ID,
  });
  if (!deviceCodeResponse.ok) {
    throw new Error(`Codex device code request failed with HTTP ${deviceCodeResponse.status}`);
  }
  const deviceData = parseJsonObject(deviceCodeResponse.body, 'Codex device code request') as DeviceCodeResponse;
  const userCode = toTrimmedString(deviceData.user_code);
  const deviceAuthId = toTrimmedString(deviceData.device_auth_id);
  const pollIntervalSeconds = Math.max(
    MIN_POLL_INTERVAL_SECONDS,
    toPositiveInt(deviceData.interval, DEFAULT_POLL_INTERVAL_SECONDS),
  );
  const expiresInSeconds = toPositiveInt(deviceData.expires_in, DEFAULT_EXPIRES_IN_SECONDS);
  const verificationUrl = toTrimmedString(deviceData.verification_uri_complete) || `${CODEX_OAUTH_ISSUER}/codex/device`;

  if (!userCode || !deviceAuthId) {
    throw new Error('Codex device code response is missing user_code or device_auth_id');
  }

  options.onPending?.({
    userCode,
    verificationUrl,
    expiresInSeconds,
    pollIntervalSeconds,
  });

  const launchResult = await bridge.openExternalUrl(verificationUrl);
  if (!launchResult.opened) {
    throw new Error('Unable to open the browser for Codex sign-in');
  }

  const deadlineMs = now() + expiresInSeconds * 1000;
  let codeResponse: DevicePollResponse | null = null;
  while (now() < deadlineMs) {
    await sleep(pollIntervalSeconds * 1000);
    const pollResponse = await postJson(bridge, CODEX_DEVICE_AUTH_TOKEN_URL, {
      device_auth_id: deviceAuthId,
      user_code: userCode,
    });
    if (pollResponse.status === 200) {
      codeResponse = parseJsonObject(pollResponse.body, 'Codex device auth poll') as DevicePollResponse;
      break;
    }
    if (pollResponse.status === 403 || pollResponse.status === 404) {
      continue;
    }
    throw new Error(`Codex device auth polling failed with HTTP ${pollResponse.status}`);
  }

  if (!codeResponse) {
    throw new Error('Codex sign-in timed out before authorization completed');
  }

  const authorizationCode = toTrimmedString(codeResponse.authorization_code);
  const codeVerifier = toTrimmedString(codeResponse.code_verifier);
  if (!authorizationCode || !codeVerifier) {
    throw new Error('Codex device auth response is missing authorization_code or code_verifier');
  }

  const exchange = await bridge.oauthTokenExchange({
    tokenUrl: CODEX_OAUTH_TOKEN_URL,
    clientId: CODEX_OAUTH_CLIENT_ID,
    code: authorizationCode,
    codeVerifier,
    redirectUri: CODEX_DEVICE_AUTH_REDIRECT_URI,
  });
  const accessToken = toTrimmedString(exchange.accessToken);
  if (!accessToken) {
    throw new Error('Codex token exchange did not return an access token');
  }

  const refreshToken = toTrimmedString(exchange.refreshToken);
  const tokenType = toTrimmedString(exchange.tokenType);
  const scope = toTrimmedString(exchange.scope);
  const expiresIn = Number.isFinite(exchange.expiresIn) ? Number(exchange.expiresIn) : undefined;
  const expiresAt = typeof expiresIn === 'number'
    ? new Date(now() + expiresIn * 1000).toISOString()
    : undefined;
  const accountId = codexAccountIdFromAccessToken(accessToken) || undefined;

  return {
    accessToken,
    refreshToken: refreshToken || undefined,
    tokenType: tokenType || undefined,
    scope: scope || undefined,
    expiresAt,
    accountId,
    credentialJson: buildCodexManagedCredentialJson({
      accessToken,
      refreshToken,
      tokenType,
      scope,
      expiresIn,
      now: now(),
    }),
  };
}
