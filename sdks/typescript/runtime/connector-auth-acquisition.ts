import {
  CONNECTOR_AUTH_ACQUISITION_PROFILES,
  type ConnectorAuthAcquisitionProfileSpec,
} from './connector-auth-acquisition-profiles.generated.js';
export { CONNECTOR_AUTH_ACQUISITION_PROFILES };
export type { ConnectorAuthAcquisitionProfileSpec };
import {
  ConnectorAuthKind,
  ConnectorStatus,
  type RuntimeTypedCallOptions,
  type RuntimeTypedClient,
} from '../core-generated/runtime-typed-client';
import type { JsonObject } from '../types';
import type {
  NimiConnectorAuthAcquisitionPendingState,
  NimiManagedConnectorCredentialAcquisitionRequest,
  NimiManagedConnectorCredentialAcquisitionResult,
} from './connector-auth-acquisition-client';

export type NimiConnectorAuthAcquisitionHttpRequest = {
  profileId: string;
  purpose: 'device_authorization' | 'device_token';
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
};

export type NimiConnectorAuthAcquisitionHttpResponse = {
  status: number;
  ok: boolean;
  body: string;
  headers?: Record<string, string>;
};

export type NimiConnectorAuthAcquisitionTokenExchangeInput = {
  provider: string;
  clientId: string;
  code: string;
  codeVerifier?: string;
  redirectUri?: string;
};

export type NimiConnectorAuthAcquisitionTokenExchangeResult = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
};

export type NimiConnectorAuthAcquisitionNativeHost = {
  proxyHttp(
    request: NimiConnectorAuthAcquisitionHttpRequest,
    signal?: AbortSignal,
  ): Promise<NimiConnectorAuthAcquisitionHttpResponse>;
  openExternalUrl(url: string, signal?: AbortSignal): Promise<{ opened: boolean }>;
  oauthTokenExchange(
    input: NimiConnectorAuthAcquisitionTokenExchangeInput,
    signal?: AbortSignal,
  ): Promise<NimiConnectorAuthAcquisitionTokenExchangeResult>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
  log?: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    details: JsonObject,
  ) => void;
};

export type NimiManagedConnectorCredentialRuntime = Pick<RuntimeTypedClient, 'createConnector' | 'updateConnector'>;

export type NimiAcquireManagedConnectorCredentialInHostOptions =
  NimiManagedConnectorCredentialAcquisitionRequest & {
    host: NimiConnectorAuthAcquisitionNativeHost;
    runtime: NimiManagedConnectorCredentialRuntime;
    callOptions?: RuntimeTypedCallOptions;
    onPending?: (state: NimiConnectorAuthAcquisitionPendingState) => void;
    signal?: AbortSignal;
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

// The Electron/Node host cannot represent larger timeout delays safely. This is
// a runtime representation limit, not a product policy for OAuth lifetimes.
const MAX_RUNTIME_TIMER_DELAY_MS = 2_147_483_647;
const MAX_RUNTIME_TIMER_DELAY_SECONDS = Math.floor(MAX_RUNTIME_TIMER_DELAY_MS / 1000);

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toTimerRepresentableProviderPositiveInt(
  value: unknown,
  fallback: number,
  field: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/u.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  if (numeric > MAX_RUNTIME_TIMER_DELAY_SECONDS) {
    throw new Error(`${field} exceeds the runtime timer capacity`);
  }
  return numeric;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Managed OAuth acquisition was canceled', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function awaitWithCancellation<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function createAcquisitionSignal(
  signals: readonly (AbortSignal | undefined)[],
  timeoutMs?: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  const listeners = new Map<AbortSignal, () => void>();
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(abortReason(signal));
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = () => abortFrom(signal);
    listeners.set(signal, listener);
    signal.addEventListener('abort', listener, { once: true });
  }
  const timer = timeoutMs === undefined
    ? undefined
    : setTimeout(() => {
        if (!controller.signal.aborted) {
          controller.abort(new DOMException('Managed OAuth acquisition timed out', 'TimeoutError'));
        }
      }, timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const [signal, listener] of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

async function runWithBoundedAcquisitionSignal<T>(
  signals: readonly (AbortSignal | undefined)[],
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const lifecycle = createAcquisitionSignal(signals, timeoutMs);
  try {
    return await operation(lifecycle.signal);
  } finally {
    lifecycle.dispose();
  }
}

function acquisitionNow(host: NimiConnectorAuthAcquisitionNativeHost): number {
  const value = host.now();
  if (!Number.isSafeInteger(value)) {
    throw new Error('Managed OAuth acquisition clock returned an invalid value');
  }
  return value;
}

function parseJsonObject(body: string, errorLabel: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(body || '')) as unknown;
  } catch {
    throw new Error(`${errorLabel} returned invalid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${errorLabel} returned a non-object JSON payload`);
  }
  return parsed as JsonObject;
}

function toIsoTimestamp(value: number, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} exceeds the runtime date capacity`);
  }
  return date.toISOString();
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
  host: NimiConnectorAuthAcquisitionNativeHost,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  details: JsonObject,
): void {
  host.log?.(level, message, details);
}

async function postJson(
  host: NimiConnectorAuthAcquisitionNativeHost,
  profile: ConnectorAuthAcquisitionProfileSpec,
  purpose: NimiConnectorAuthAcquisitionHttpRequest['purpose'],
  url: string,
  payload: JsonObject,
  signal?: AbortSignal,
): Promise<NimiConnectorAuthAcquisitionHttpResponse> {
  return awaitWithCancellation(host.proxyHttp({
    profileId: profile.profileId,
    purpose,
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  }, signal), signal);
}

function buildManagedCredentialJson(input: {
  profile: ConnectorAuthAcquisitionProfileSpec;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  now: number;
}): { credentialJson: string; expiresAt?: string } {
  const accessToken = toTrimmedString(input.accessToken);
  if (!accessToken) {
    throw new Error('Managed OAuth credential payload requires an access token');
  }
  const refreshToken = toTrimmedString(input.refreshToken);
  const tokenType = toTrimmedString(input.tokenType);
  const scope = toTrimmedString(input.scope);
  const expiresIn = input.expiresIn;
  if (expiresIn !== undefined && (!Number.isSafeInteger(expiresIn) || expiresIn <= 0)) {
    throw new Error('Managed OAuth token exchange expires_in must be a positive integer');
  }
  const expiresAt = typeof expiresIn === 'number'
    ? toIsoTimestamp(input.now + expiresIn * 1000, 'Managed OAuth token exchange expires_in')
    : undefined;

  return {
    expiresAt,
    credentialJson: JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken || undefined,
      token_type: tokenType || undefined,
      scope: scope || undefined,
      expires_in: expiresIn,
      expires_at: expiresAt,
      issuer: input.profile.issuer,
      obtained_at: toIsoTimestamp(input.now, 'Managed OAuth acquisition clock'),
    }),
  };
}

function profileForId(profileId: string): ConnectorAuthAcquisitionProfileSpec {
  const normalized = String(profileId || '').trim().toLowerCase();
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES[normalized];
  if (!profile) {
    throw new Error(`Connector auth acquisition profile "${profileId}" is not admitted`);
  }
  return profile;
}

async function persistManagedConnectorCredentialThroughRuntime(input: {
  options: NimiAcquireManagedConnectorCredentialInHostOptions;
  profile: ConnectorAuthAcquisitionProfileSpec;
  credentialJson: string;
  signal: AbortSignal;
}): Promise<string> {
  throwIfAborted(input.signal);
  const finalWriteCallOptions = withoutAcquisitionCancellation(input.options.callOptions);
  const provider = toTrimmedString(input.options.provider) || input.profile.providerAuthProfile;
  const endpoint = toTrimmedString(input.options.endpoint);
  const label = toTrimmedString(input.options.label) || `${input.profile.providerAuthProfile} managed OAuth`;
  const connectorId = toTrimmedString(input.options.connectorId);
  if (connectorId) {
    const response = await input.options.runtime.updateConnector({
      connectorId,
      endpoint: endpoint || undefined,
      label: input.options.label === undefined ? undefined : label,
      status: ConnectorStatus.UNSPECIFIED,
      authKind: ConnectorAuthKind.OAUTH_MANAGED,
      providerAuthProfile: input.profile.providerAuthProfile,
      credentialJson: input.credentialJson,
    }, finalWriteCallOptions);
    return response.connector?.connectorId || connectorId;
  }
  const response = await input.options.runtime.createConnector({
    provider,
    endpoint,
    label,
    apiKey: '',
    authKind: ConnectorAuthKind.OAUTH_MANAGED,
    providerAuthProfile: input.profile.providerAuthProfile,
    credentialJson: input.credentialJson,
  }, finalWriteCallOptions);
  const createdConnectorId = toTrimmedString(response.connector?.connectorId);
  if (!createdConnectorId) {
    throw new Error('Managed OAuth connector creation did not return a connector ID');
  }
  return createdConnectorId;
}

function withoutAcquisitionCancellation(
  options: RuntimeTypedCallOptions | undefined,
): RuntimeTypedCallOptions {
  return {
    metadata: options?.metadata,
    timeoutMs: options?.timeoutMs,
    responseMetadataObserver: options?.responseMetadataObserver,
  };
}

// @nimi-authority: definition.nimi.sdks.feature-clients.connector-auth-plane
// @nimi-authority: rule.nimi.sdks.feature-clients.r060
// @nimi-authority: rule.nimi.sdks.feature-clients.r061
export async function acquireNimiManagedConnectorCredentialInHost(
  options: NimiAcquireManagedConnectorCredentialInHostOptions,
): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  const profile = profileForId(options.profileId);
  const lifecycle = createAcquisitionSignal([options.signal, options.callOptions?.signal]);
  try {
    return await acquireManagedConnectorCredentialWithProfile(options, profile, lifecycle.signal);
  } finally {
    lifecycle.dispose();
  }
}

async function acquireManagedConnectorCredentialWithProfile(
  options: NimiAcquireManagedConnectorCredentialInHostOptions,
  profile: ConnectorAuthAcquisitionProfileSpec,
  signal: AbortSignal,
): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  const host = options.host;
  throwIfAborted(signal);

  logAcquisition(host, 'info', 'managed-oauth:device-code-request:start', {
    profileId: profile.profileId,
  });

  const deviceCodeResponse = await postJson(host, profile, 'device_authorization', profile.deviceAuthorizationUrl, {
    client_id: profile.clientId,
  }, signal);
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
  const providerPollIntervalSeconds = toTimerRepresentableProviderPositiveInt(
    deviceData.interval,
    profile.defaultPollIntervalSeconds,
    'Managed OAuth device code interval',
  );
  if (providerPollIntervalSeconds > profile.maxPollIntervalSeconds) {
    throw new Error(`Managed OAuth device code interval must not exceed ${profile.maxPollIntervalSeconds}`);
  }
  const pollIntervalSeconds = Math.max(profile.minPollIntervalSeconds, providerPollIntervalSeconds);
  const expiresInSeconds = toTimerRepresentableProviderPositiveInt(
    deviceData.expires_in,
    profile.defaultExpiresInSeconds,
    'Managed OAuth device code expires_in',
  );
  if (expiresInSeconds > profile.maxExpiresInSeconds) {
    throw new Error(`Managed OAuth device code expires_in must not exceed ${profile.maxExpiresInSeconds}`);
  }
  const verificationUrl = toTrimmedString(deviceData.verification_uri_complete) || profile.fallbackVerificationUrl;

  return runWithBoundedAcquisitionSignal(
    [signal],
    expiresInSeconds * 1000,
    async (boundedSignal) => completeManagedConnectorCredentialFromDeviceCode({
      options,
      profile,
      host,
      deviceData,
      userCode,
      deviceAuthId,
      pollIntervalSeconds,
      expiresInSeconds,
      verificationUrl,
      signal: boundedSignal,
    }),
  );
}

async function completeManagedConnectorCredentialFromDeviceCode(input: {
  options: NimiAcquireManagedConnectorCredentialInHostOptions;
  profile: ConnectorAuthAcquisitionProfileSpec;
  host: NimiConnectorAuthAcquisitionNativeHost;
  deviceData: DeviceCodeResponse;
  userCode: string;
  deviceAuthId: string;
  pollIntervalSeconds: number;
  expiresInSeconds: number;
  verificationUrl: string;
  signal: AbortSignal;
}): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  const {
    options,
    profile,
    host,
    deviceData,
    userCode,
    deviceAuthId,
    pollIntervalSeconds,
    expiresInSeconds,
    verificationUrl,
    signal,
  } = input;
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

  throwIfAborted(signal);
  options.onPending?.({
    userCode,
    verificationUrl,
    expiresInSeconds,
    pollIntervalSeconds,
  });
  throwIfAborted(signal);

  logAcquisition(host, 'info', 'managed-oauth:browser-open:start', {
    profileId: profile.profileId,
    verificationUrl,
  });
  const launchResult = await awaitWithCancellation(host.openExternalUrl(verificationUrl, signal), signal);
  if (!launchResult.opened) {
    logAcquisition(host, 'error', 'managed-oauth:browser-open:failed', {
      profileId: profile.profileId,
      verificationUrl,
    });
    throw new Error('Unable to open the browser for managed OAuth sign-in');
  }

  const deadlineMs = acquisitionNow(host) + expiresInSeconds * 1000;
  const maxPollAttempts = Math.ceil(expiresInSeconds / profile.minPollIntervalSeconds);
  let codeResponse: DevicePollResponse | null = null;
  let pollAttempt = 0;
  let lastPollStatus: number | null = null;
  while (acquisitionNow(host) < deadlineMs && pollAttempt < maxPollAttempts) {
    throwIfAborted(signal);
    const remainingMs = Math.max(0, deadlineMs - acquisitionNow(host));
    const sleepMs = Math.min(pollIntervalSeconds * 1000, remainingMs);
    if (sleepMs <= 0) break;
    await awaitWithCancellation(host.sleep(sleepMs, signal), signal);
    throwIfAborted(signal);
    if (acquisitionNow(host) >= deadlineMs) break;
    pollAttempt += 1;
    const pollResponse = await postJson(host, profile, 'device_token', profile.deviceTokenUrl, {
      device_auth_id: deviceAuthId,
      user_code: userCode,
    }, signal);
    lastPollStatus = pollResponse.status;
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
      });
      continue;
    }
    logAcquisition(host, 'error', 'managed-oauth:poll:failed', {
      profileId: profile.profileId,
      attempt: pollAttempt,
      status: pollResponse.status,
    });
    throw new Error(`Managed OAuth device auth polling failed with HTTP ${pollResponse.status}`);
  }

  if (!codeResponse) {
    logAcquisition(host, 'warn', 'managed-oauth:poll:timeout', {
      profileId: profile.profileId,
      attempts: pollAttempt,
      lastStatus: lastPollStatus,
    });
    const timeoutDetails = [
      `attempts=${pollAttempt}`,
      `lastStatus=${lastPollStatus ?? 'none'}`,
    ];
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
  throwIfAborted(signal);
  const exchange = await awaitWithCancellation(host.oauthTokenExchange({
    provider: profile.tokenExchangeProvider,
    clientId: profile.clientId,
    code: authorizationCode,
    codeVerifier,
    redirectUri: profile.redirectUri,
  }, signal), signal);
  const accessToken = toTrimmedString(exchange.accessToken);
  if (!accessToken) {
    throw new Error('Managed OAuth token exchange did not return an access token');
  }

  const nowMs = acquisitionNow(host);
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
  });

  throwIfAborted(signal);
  const connectorId = await persistManagedConnectorCredentialThroughRuntime({
    options,
    profile,
    credentialJson: credential.credentialJson,
    signal,
  });

  return {
    profileId: profile.profileId,
    providerAuthProfile: profile.providerAuthProfile,
    connectorId,
    expiresAt: credential.expiresAt,
  };
}
