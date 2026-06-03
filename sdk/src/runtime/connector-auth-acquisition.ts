import {
  CONNECTOR_AUTH_ACQUISITION_PROFILES,
  type ConnectorAuthAcquisitionProfileSpec,
} from './connector-auth-acquisition-profiles.generated.js';

export type ConnectorAuthAcquisitionPendingState = {
  userCode: string;
  verificationUrl: string;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
};

export type ConnectorAuthAcquisitionHttpRequest = {
  profileId: string;
  purpose: 'device_authorization' | 'device_token';
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
};

export type ConnectorAuthAcquisitionHttpResponse = {
  status: number;
  ok: boolean;
  body: string;
  headers?: Record<string, string>;
};

export type ConnectorAuthAcquisitionTokenExchangeInput = {
  provider: string;
  clientId: string;
  code: string;
  codeVerifier?: string;
  redirectUri?: string;
};

export type ConnectorAuthAcquisitionTokenExchangeResult = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  raw?: unknown;
};

export type ConnectorAuthAcquisitionHost = {
  proxyHttp(request: ConnectorAuthAcquisitionHttpRequest): Promise<ConnectorAuthAcquisitionHttpResponse>;
  openExternalUrl(url: string): Promise<{ opened: boolean }>;
  oauthTokenExchange(input: ConnectorAuthAcquisitionTokenExchangeInput): Promise<ConnectorAuthAcquisitionTokenExchangeResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log?: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    details: Record<string, unknown>,
  ) => void;
};

export type PersistManagedConnectorCredentialInput = {
  profileId: string;
  providerAuthProfile: string;
  credentialJson: string;
  accountId?: string;
  expiresAt?: string;
};

export type PersistManagedConnectorCredentialResult = {
  connectorId?: string;
};

export type AcquireManagedConnectorCredentialOptions = {
  profileId: string;
  host: ConnectorAuthAcquisitionHost;
  persistCredential(input: PersistManagedConnectorCredentialInput): Promise<PersistManagedConnectorCredentialResult>;
  onPending?: (state: ConnectorAuthAcquisitionPendingState) => void;
};

export type ManagedConnectorCredentialAcquisitionResult = {
  profileId: string;
  providerAuthProfile: string;
  connectorId?: string;
  accountId?: string;
  expiresAt?: string;
};

type DeviceCodeResponse = {
  user_code?: unknown;
  device_auth_id?: unknown;
  interval?: unknown;
  expires_in?: unknown;
  verification_uri_complete?: unknown;
};

type DevicePollResponse = {
  authorization_code?: unknown;
  code_verifier?: unknown;
};

type DevicePollErrorSummary = {
  errorCode?: string;
  errorDescription?: string;
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

function tryParseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(String(body || ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function summarizePollError(body: string): DevicePollErrorSummary {
  const parsed = tryParseJsonObject(body);
  if (!parsed) {
    return {};
  }
  return {
    errorCode: toTrimmedString(parsed.error),
    errorDescription:
      toTrimmedString(parsed.error_description)
      || toTrimmedString(parsed.message)
      || toTrimmedString(parsed.detail),
  };
}

function maskUserCode(userCode: string): string {
  const normalized = String(userCode || '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= 4) {
    return normalized;
  }
  return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
}

function logAcquisition(
  host: ConnectorAuthAcquisitionHost,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  details: Record<string, unknown>,
): void {
  host.log?.(level, message, details);
}

async function postJson(
  host: ConnectorAuthAcquisitionHost,
  profile: ConnectorAuthAcquisitionProfileSpec,
  purpose: ConnectorAuthAcquisitionHttpRequest['purpose'],
  url: string,
  payload: Record<string, unknown>,
): Promise<ConnectorAuthAcquisitionHttpResponse> {
  return host.proxyHttp({
    profileId: profile.profileId,
    purpose,
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  const base64 = String(segment || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(segment.length / 4) * 4, '=');
  try {
    let jsonText = '';
    if (typeof globalThis.atob === 'function') {
      jsonText = globalThis.atob(base64);
    } else {
      const maybeBuffer = (globalThis as unknown as {
        Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } };
      }).Buffer;
      if (!maybeBuffer) {
        return null;
      }
      jsonText = maybeBuffer.from(base64, 'base64').toString('utf8');
    }
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function accountIdFromAccessToken(accessToken: string): string {
  const parts = String(accessToken || '').trim().split('.');
  if (parts.length < 2 || !parts[1]) {
    return '';
  }
  const claims = decodeBase64UrlJson(parts[1]);
  if (!claims) {
    return '';
  }
  const authClaims = claims['https://api.openai.com/auth'];
  if (!authClaims || typeof authClaims !== 'object' || Array.isArray(authClaims)) {
    return '';
  }
  return toTrimmedString((authClaims as Record<string, unknown>).chatgpt_account_id);
}

function buildManagedCredentialJson(input: {
  profile: ConnectorAuthAcquisitionProfileSpec;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  now: number;
}): { credentialJson: string; accountId?: string; expiresAt?: string } {
  const accessToken = toTrimmedString(input.accessToken);
  if (!accessToken) {
    throw new Error('Managed OAuth credential payload requires an access token');
  }
  const refreshToken = toTrimmedString(input.refreshToken);
  const tokenType = toTrimmedString(input.tokenType);
  const scope = toTrimmedString(input.scope);
  const accountId = accountIdFromAccessToken(accessToken);
  const expiresIn = Number.isFinite(input.expiresIn) && Number(input.expiresIn) > 0
    ? Math.trunc(Number(input.expiresIn))
    : undefined;
  const expiresAt = typeof expiresIn === 'number'
    ? new Date(input.now + expiresIn * 1000).toISOString()
    : undefined;

  return {
    accountId: accountId || undefined,
    expiresAt,
    credentialJson: JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken || undefined,
      token_type: tokenType || undefined,
      scope: scope || undefined,
      expires_in: expiresIn,
      expires_at: expiresAt,
      account_id: accountId || undefined,
      auth_mode: 'chatgpt',
      source: 'device-code',
      issuer: input.profile.issuer,
      obtained_at: new Date(input.now).toISOString(),
    }),
  };
}

function profileForID(profileId: string): ConnectorAuthAcquisitionProfileSpec {
  const normalized = String(profileId || '').trim().toLowerCase();
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES[normalized];
  if (!profile) {
    throw new Error(`Connector auth acquisition profile "${profileId}" is not admitted`);
  }
  return profile;
}

export async function acquireManagedConnectorCredential(
  options: AcquireManagedConnectorCredentialOptions,
): Promise<ManagedConnectorCredentialAcquisitionResult> {
  const profile = profileForID(options.profileId);
  const host = options.host;
  const sleep = host.sleep;
  const now = host.now;

  logAcquisition(host, 'info', 'managed-oauth:device-code-request:start', {
    profileId: profile.profileId,
  });

  const deviceCodeResponse = await postJson(host, profile, 'device_authorization', profile.deviceAuthorizationUrl, {
    client_id: profile.clientId,
  });
  if (!deviceCodeResponse.ok) {
    logAcquisition(host, 'error', 'managed-oauth:device-code-request:failed', {
      profileId: profile.profileId,
      status: deviceCodeResponse.status,
    });
    throw new Error(`Managed OAuth device code request failed with HTTP ${deviceCodeResponse.status}`);
  }
  const deviceData = parseJsonObject(deviceCodeResponse.body, 'Managed OAuth device code request') as DeviceCodeResponse;
  const userCode = toTrimmedString(deviceData.user_code);
  const deviceAuthId = toTrimmedString(deviceData.device_auth_id);
  const pollIntervalSeconds = Math.max(
    profile.minPollIntervalSeconds,
    toPositiveInt(deviceData.interval, profile.defaultPollIntervalSeconds),
  );
  const expiresInSeconds = toPositiveInt(deviceData.expires_in, profile.defaultExpiresInSeconds);
  const verificationUrl = toTrimmedString(deviceData.verification_uri_complete) || profile.fallbackVerificationUrl;

  if (!userCode || !deviceAuthId) {
    throw new Error('Managed OAuth device code response is missing user_code or device_auth_id');
  }

  logAcquisition(host, 'info', 'managed-oauth:device-code-request:success', {
    profileId: profile.profileId,
    pollIntervalSeconds,
    expiresInSeconds,
    userCode: maskUserCode(userCode),
    hasVerificationUriComplete: Boolean(toTrimmedString(deviceData.verification_uri_complete)),
  });

  options.onPending?.({
    userCode,
    verificationUrl,
    expiresInSeconds,
    pollIntervalSeconds,
  });

  logAcquisition(host, 'info', 'managed-oauth:browser-open:start', {
    profileId: profile.profileId,
    verificationUrl,
  });
  const launchResult = await host.openExternalUrl(verificationUrl);
  if (!launchResult.opened) {
    logAcquisition(host, 'error', 'managed-oauth:browser-open:failed', {
      profileId: profile.profileId,
      verificationUrl,
    });
    throw new Error('Unable to open the browser for managed OAuth sign-in');
  }

  const deadlineMs = now() + expiresInSeconds * 1000;
  let codeResponse: DevicePollResponse | null = null;
  let pollAttempt = 0;
  let lastPollStatus: number | null = null;
  let lastPollError: DevicePollErrorSummary = {};
  while (now() < deadlineMs) {
    await sleep(pollIntervalSeconds * 1000);
    pollAttempt += 1;
    const pollResponse = await postJson(host, profile, 'device_token', profile.deviceTokenUrl, {
      device_auth_id: deviceAuthId,
      user_code: userCode,
    });
    lastPollStatus = pollResponse.status;
    lastPollError = summarizePollError(pollResponse.body);
    if (pollResponse.status === 200) {
      logAcquisition(host, 'info', 'managed-oauth:poll:authorized', {
        profileId: profile.profileId,
        attempt: pollAttempt,
        status: pollResponse.status,
      });
      codeResponse = parseJsonObject(pollResponse.body, 'Managed OAuth device auth poll') as DevicePollResponse;
      break;
    }
    if (pollResponse.status === 403 || pollResponse.status === 404) {
      logAcquisition(host, 'debug', 'managed-oauth:poll:pending', {
        profileId: profile.profileId,
        attempt: pollAttempt,
        status: pollResponse.status,
        errorCode: lastPollError.errorCode || null,
        errorDescription: lastPollError.errorDescription || null,
      });
      continue;
    }
    logAcquisition(host, 'error', 'managed-oauth:poll:failed', {
      profileId: profile.profileId,
      attempt: pollAttempt,
      status: pollResponse.status,
      errorCode: lastPollError.errorCode || null,
      errorDescription: lastPollError.errorDescription || null,
    });
    throw new Error(`Managed OAuth device auth polling failed with HTTP ${pollResponse.status}`);
  }

  if (!codeResponse) {
    logAcquisition(host, 'warn', 'managed-oauth:poll:timeout', {
      profileId: profile.profileId,
      attempts: pollAttempt,
      lastStatus: lastPollStatus,
      lastErrorCode: lastPollError.errorCode || null,
      lastErrorDescription: lastPollError.errorDescription || null,
    });
    const timeoutDetails = [
      `attempts=${pollAttempt}`,
      `lastStatus=${lastPollStatus ?? 'none'}`,
    ];
    if (lastPollError.errorCode) {
      timeoutDetails.push(`lastError=${lastPollError.errorCode}`);
    }
    if (lastPollError.errorDescription) {
      timeoutDetails.push(`detail=${lastPollError.errorDescription}`);
    }
    throw new Error(`Managed OAuth sign-in timed out before authorization completed (${timeoutDetails.join(', ')})`);
  }

  const authorizationCode = toTrimmedString(codeResponse.authorization_code);
  const codeVerifier = toTrimmedString(codeResponse.code_verifier);
  if (!authorizationCode || !codeVerifier) {
    throw new Error('Managed OAuth device auth response is missing authorization_code or code_verifier');
  }

  logAcquisition(host, 'info', 'managed-oauth:token-exchange:start', {
    profileId: profile.profileId,
    attemptCount: pollAttempt,
    redirectUri: profile.redirectUri,
  });
  const exchange = await host.oauthTokenExchange({
    provider: profile.tokenExchangeProvider,
    clientId: profile.clientId,
    code: authorizationCode,
    codeVerifier,
    redirectUri: profile.redirectUri,
  });
  const accessToken = toTrimmedString(exchange.accessToken);
  if (!accessToken) {
    throw new Error('Managed OAuth token exchange did not return an access token');
  }

  const nowMs = now();
  const credential = buildManagedCredentialJson({
    profile,
    accessToken,
    refreshToken: exchange.refreshToken,
    tokenType: exchange.tokenType,
    scope: exchange.scope,
    expiresIn: exchange.expiresIn,
    now: nowMs,
  });

  logAcquisition(host, 'info', 'managed-oauth:token-exchange:success', {
    profileId: profile.profileId,
    hasRefreshToken: Boolean(toTrimmedString(exchange.refreshToken)),
    expiresIn: Number.isFinite(exchange.expiresIn) ? exchange.expiresIn : null,
    accountId: credential.accountId || null,
  });

  const persisted = await options.persistCredential({
    profileId: profile.profileId,
    providerAuthProfile: profile.providerAuthProfile,
    credentialJson: credential.credentialJson,
    accountId: credential.accountId,
    expiresAt: credential.expiresAt,
  });

  return {
    profileId: profile.profileId,
    providerAuthProfile: profile.providerAuthProfile,
    connectorId: persisted.connectorId,
    accountId: credential.accountId,
    expiresAt: credential.expiresAt,
  };
}
