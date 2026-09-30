import {
  CONNECTOR_AUTH_ACQUISITION_PROFILES,
  type ConnectorAuthAcquisitionProfileSpec,
} from './connector-auth-acquisition-profiles.generated.js';
export { CONNECTOR_AUTH_ACQUISITION_PROFILES };
export type { ConnectorAuthAcquisitionProfileSpec };
import {
  ConnectorAuthKind,
  ConnectorKind,
  ConnectorStatus,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import type { JsonObject } from '../types';
import type { DesktopAccountProductRuntimeMethods } from './first-party-protected-runtime-profiles.generated.js';
import type {
  NimiConnectorAuthAcquisitionPendingState,
  NimiManagedConnectorCredentialAcquisitionRequest,
  NimiManagedConnectorCredentialAcquisitionResult,
} from './connector-auth-acquisition-client';

export type NimiConnectorAuthAcquisitionHttpRequest = {
  profileId: string;
  purpose: 'authorization_code_exchange' | 'jwks';
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body?: string;
};

export type NimiConnectorAuthAcquisitionHttpResponse = {
  status: number;
  ok: boolean;
  body: string;
  headers?: Record<string, string>;
};

export type NimiConnectorAuthAcquisitionCallbackRequest = {
  profileId: string;
  host: string;
  path: string;
};

// A loopback listener started before the browser opens. Only the port varies;
// the host and path come from the admitted profile.
export type NimiConnectorAuthAcquisitionCallback = {
  redirectUri: string;
  waitForCallback(signal: AbortSignal): Promise<Record<string, string>>;
  close(): void | Promise<void>;
};

export type NimiConnectorAuthAcquisitionCrypto = {
  getRandomValues(array: Uint8Array): Uint8Array;
  subtle: SubtleCrypto;
};

export type NimiConnectorAuthAcquisitionNativeHost = {
  proxyHttp(
    request: NimiConnectorAuthAcquisitionHttpRequest,
    signal?: AbortSignal,
  ): Promise<NimiConnectorAuthAcquisitionHttpResponse>;
  openExternalUrl(url: string, signal?: AbortSignal): Promise<{ opened: boolean }>;
  startAuthorizationCallback(
    request: NimiConnectorAuthAcquisitionCallbackRequest,
    signal?: AbortSignal,
  ): Promise<NimiConnectorAuthAcquisitionCallback>;
  // Stable opaque ext_agent_host_id of this local host; never a user identifier.
  hostIdentifier(signal?: AbortSignal): Promise<string>;
  crypto: NimiConnectorAuthAcquisitionCrypto;
  now(): number;
  log?: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    details: JsonObject,
  ) => void;
};

// Only methods the protected Desktop account carrier admits. It admits
// ListConnectors but not GetConnector, so reauthorization reads the bound
// registration from the caller's list.
export type NimiManagedConnectorCredentialRuntime = Pick<DesktopAccountProductRuntimeMethods, 'createConnector' | 'updateConnector' | 'listConnectors'>;

// Bounds the pages read while looking up the Connector to reauthorize.
const REGISTRATION_LOOKUP_MAX_PAGES = 20;

export type NimiAcquireManagedConnectorCredentialInHostOptions =
  NimiManagedConnectorCredentialAcquisitionRequest & {
    host: NimiConnectorAuthAcquisitionNativeHost;
    runtime: NimiManagedConnectorCredentialRuntime;
    callOptions?: RuntimeTypedCallOptions;
    onPending?: (state: NimiConnectorAuthAcquisitionPendingState) => void;
    signal?: AbortSignal;
  };

export type NimiConnectorAuthAcquisitionErrorCode =
  | 'AUTHORIZATION_DENIED'
  | 'PLAN_USAGE_NOT_GRANTED'
  | 'AUTHORIZATION_INVALID'
  | 'REGISTRATION_UNAVAILABLE'
  | 'BROWSER_UNAVAILABLE';

// Stable acquisition outcome without provider text, tokens or codes.
export class NimiConnectorAuthAcquisitionError extends Error {
  readonly code: NimiConnectorAuthAcquisitionErrorCode;

  constructor(code: NimiConnectorAuthAcquisitionErrorCode, message: string) {
    super(message);
    this.name = 'NimiConnectorAuthAcquisitionError';
    this.code = code;
  }
}

const SIWC_CREDENTIAL_SCHEMA = 'nimi.openai_chatgpt_plan.siwc/v1';
const SIWC_DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const SIWC_OFFLINE_SCOPE = 'offline_access';
const HOST_ID_PREFIXES = ['urn:uuid:', 'urn:ietf:params:oauth:jwk-thumbprint:', 'did:key:'];
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const MAX_CALLBACK_VALUE_BYTES = 4096;

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Managed OAuth acquisition was canceled', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

// Bounds how long cancellation waits for a host that is still creating the
// callback listener; a listener the host returns later is still closed.
const CALLBACK_STARTUP_CLEANUP_WAIT_MS = 5_000;

// The acquisition owns the loopback listener from the moment the host starts
// creating it. When cancellation, timeout or a startup failure wins that race,
// a listener the host still returns is closed, and the acquisition settles only
// after that close (bounded for a host that never returns).
async function startOwnedAuthorizationCallback(
  host: NimiConnectorAuthAcquisitionNativeHost,
  request: NimiConnectorAuthAcquisitionCallbackRequest,
  signal: AbortSignal,
): Promise<NimiConnectorAuthAcquisitionCallback> {
  const starting = host.startAuthorizationCallback(request, signal);
  try {
    return await awaitWithCancellation(starting, signal);
  } catch (error) {
    const cleanup = starting.then((late) => late.close(), () => undefined).catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      cleanup,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CALLBACK_STARTUP_CLEANUP_WAIT_MS);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    throw error;
  }
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

function acquisitionNow(host: NimiConnectorAuthAcquisitionNativeHost): number {
  const value = host.now();
  if (!Number.isSafeInteger(value)) {
    throw new Error('Managed OAuth acquisition clock returned an invalid value');
  }
  return value;
}

function parseJsonObject(body: string, errorLabel: string): JsonObject {
  if (String(body || '').length > MAX_TOKEN_RESPONSE_BYTES) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', `${errorLabel} exceeded its fixed size`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(body || '')) as unknown;
  } catch {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', `${errorLabel} returned invalid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', `${errorLabel} returned a non-object JSON payload`);
  }
  return parsed as JsonObject;
}

function logAcquisition(
  host: NimiConnectorAuthAcquisitionNativeHost,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  details: JsonObject,
): void {
  host.log?.(level, message, details);
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; // pragma: allowlist secret -- RFC 4648 base64url alphabet

function base64UrlEncode(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    output += BASE64URL_ALPHABET[(triple >> 18) & 63];
    output += BASE64URL_ALPHABET[(triple >> 12) & 63];
    if (index + 1 < bytes.length) output += BASE64URL_ALPHABET[(triple >> 6) & 63];
    if (index + 2 < bytes.length) output += BASE64URL_ALPHABET[triple & 63];
  }
  return output;
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'ID token is not base64url encoded');
  }
  const bytes = new Uint8Array(new ArrayBuffer(Math.floor((value.length * 6) / 8)));
  let length = 0;
  let buffer = 0;
  let bits = 0;
  for (const char of value) {
    buffer = ((buffer << 6) | BASE64URL_ALPHABET.indexOf(char)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[length] = (buffer >> bits) & 0xff;
      length += 1;
    }
  }
  return bytes.subarray(0, length);
}

function randomToken(crypto: NimiConnectorAuthAcquisitionCrypto, byteLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function pkceChallenge(crypto: NimiConnectorAuthAcquisitionCrypto, verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function profileForId(profileId: string): ConnectorAuthAcquisitionProfileSpec {
  const normalized = String(profileId || '').trim().toLowerCase();
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES[normalized];
  if (!profile) {
    throw new Error(`Connector auth acquisition profile "${profileId}" is not admitted`);
  }
  return profile;
}

function validHostIdentifier(value: string): boolean {
  if (!value || value !== value.trim() || value.length > 512 || /\s/u.test(value)) return false;
  return HOST_ID_PREFIXES.some((prefix) => value.startsWith(prefix) && value.length > prefix.length);
}

function exactCallbackRedirect(
  profile: ConnectorAuthAcquisitionProfileSpec,
  redirectUri: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error('Authorization callback listener returned an invalid redirect URI');
  }
  const port = Number(parsed.port);
  if (parsed.protocol !== 'http:' || parsed.hostname !== profile.callbackHost || !Number.isSafeInteger(port) || port <= 0 ||
    parsed.pathname !== profile.callbackPath || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('Authorization callback listener is not the admitted loopback callback');
  }
  return `http://${profile.callbackHost}:${port}${profile.callbackPath}`;
}

type RegistrationContext = {
  clientId: string;
  initialRegistration: boolean;
  loginHint: string;
};

// Explicit reauthorization reuses the registration that Runtime custody bound
// to this Connector; the renderer never supplies a client or account.
async function registrationContext(
  options: NimiAcquireManagedConnectorCredentialInHostOptions,
  profile: ConnectorAuthAcquisitionProfileSpec,
  signal: AbortSignal,
): Promise<RegistrationContext> {
  const connectorId = toTrimmedString(options.connectorId);
  if (!connectorId) {
    return { clientId: profile.initialClientId, initialRegistration: true, loginHint: '' };
  }
  let connector: Awaited<ReturnType<NimiManagedConnectorCredentialRuntime['listConnectors']>>['connectors'][number] | undefined;
  let pageToken = '';
  for (let page = 0; page < REGISTRATION_LOOKUP_MAX_PAGES && !connector; page += 1) {
    const response = await awaitWithCancellation(
      options.runtime.listConnectors({
        pageSize: 0,
        pageToken,
        kindFilter: ConnectorKind.REMOTE_MANAGED,
        statusFilter: ConnectorStatus.UNSPECIFIED,
        providerFilter: profile.providerAuthProfile,
      }, withAcquisitionSignal(options.callOptions, signal)),
      signal,
    );
    connector = (response.connectors ?? []).find((candidate) => candidate.connectorId === connectorId);
    pageToken = toTrimmedString(response.nextPageToken);
    if (!pageToken) break;
  }
  const clientId = toTrimmedString(connector?.oauthRegistration?.issuedClientId);
  if (!connector || connector.provider !== profile.providerAuthProfile ||
    connector.providerAuthProfile !== profile.providerAuthProfile || !clientId || clientId === profile.initialClientId) {
    throw new NimiConnectorAuthAcquisitionError(
      'REGISTRATION_UNAVAILABLE',
      'This Connector has no ChatGPT plan registration to reauthorize; add the account again',
    );
  }
  const accountLabel = toTrimmedString(connector.oauthRegistration?.accountLabel);
  return { clientId, initialRegistration: false, loginHint: accountLabel.includes('@') ? accountLabel : '' };
}

function authorizationUrl(input: {
  profile: ConnectorAuthAcquisitionProfileSpec;
  registration: RegistrationContext;
  hostId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
}): string {
  const params = new URLSearchParams();
  params.set('client_id', input.registration.clientId);
  if (input.registration.initialRegistration) {
    params.set('agent_name_hint', input.profile.agentNameHint);
  }
  params.set('ext_agent_host_id', input.hostId);
  if (input.registration.loginHint) {
    params.set('login_hint', input.registration.loginHint);
  }
  params.set('response_type', 'code');
  params.set('redirect_uri', input.redirectUri);
  params.set('scope', input.profile.scopes.join(' '));
  params.set('resource', input.profile.resource);
  params.set('state', input.state);
  params.set('nonce', input.nonce);
  params.set('code_challenge_method', 'S256');
  params.set('code_challenge', input.challenge);
  return `${input.profile.authorizationUrl}?${params.toString()}`;
}

function boundedCallbackValue(params: Record<string, string>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || !value || value.length > MAX_CALLBACK_VALUE_BYTES || value !== value.trim()) {
    return '';
  }
  return value;
}

function callbackRegistration(
  params: Record<string, string>,
  profile: ConnectorAuthAcquisitionProfileSpec,
  registration: RegistrationContext,
  expectedState: string,
): { code: string; clientId: string } {
  if (boundedCallbackValue(params, 'state') !== expectedState) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'Authorization callback state did not match this sign-in');
  }
  const error = boundedCallbackValue(params, 'error');
  if (error === 'access_denied') {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_DENIED', 'ChatGPT sign-in was canceled or denied');
  }
  if (error) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'ChatGPT sign-in returned an authorization error');
  }
  const code = boundedCallbackValue(params, 'code');
  if (!code) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'Authorization callback did not include a code');
  }
  const returnedClientId = boundedCallbackValue(params, 'client_id');
  if (registration.initialRegistration) {
    if (!returnedClientId || returnedClientId === profile.initialClientId) {
      throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'ChatGPT registration did not return an issued client');
    }
    return { code, clientId: returnedClientId };
  }
  if (returnedClientId && returnedClientId !== registration.clientId) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'Authorization returned a different ChatGPT registration');
  }
  return { code, clientId: registration.clientId };
}

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  tokenType: string;
  scopes: string[];
};

async function exchangeAuthorizationCode(input: {
  host: NimiConnectorAuthAcquisitionNativeHost;
  profile: ConnectorAuthAcquisitionProfileSpec;
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
  signal: AbortSignal;
}): Promise<TokenResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('client_id', input.clientId);
  form.set('code', input.code);
  form.set('code_verifier', input.verifier);
  form.set('redirect_uri', input.redirectUri);
  form.set('resource', input.profile.resource);
  const response = await awaitWithCancellation(input.host.proxyHttp({
    profileId: input.profile.profileId,
    purpose: 'authorization_code_exchange',
    url: input.profile.tokenUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  }, input.signal), input.signal);
  if (!response.ok) {
    let oauthError = '';
    try {
      oauthError = toTrimmedString((JSON.parse(response.body) as { error?: unknown }).error);
    } catch {
      oauthError = '';
    }
    throw new NimiConnectorAuthAcquisitionError(
      'AUTHORIZATION_INVALID',
      oauthError === 'invalid_grant'
        ? 'The ChatGPT authorization code expired or was already used; sign in again'
        : `ChatGPT token exchange failed with HTTP ${response.status}`,
    );
  }
  const payload = parseJsonObject(response.body, 'ChatGPT token exchange');
  const accessToken = toTrimmedString(payload.access_token);
  const refreshToken = toTrimmedString(payload.refresh_token);
  const idToken = toTrimmedString(payload.id_token);
  const tokenType = toTrimmedString(payload.token_type);
  const scopes = toTrimmedString(payload.scope).split(/\s+/u).filter(Boolean);
  if (!accessToken || !refreshToken || !idToken || tokenType.toLowerCase() !== 'bearer') {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'ChatGPT token exchange returned an incomplete token set');
  }
  return { accessToken, refreshToken, idToken, tokenType: 'Bearer', scopes };
}

type IdentityClaims = { subject: string; email: string };

// Verifies the RS256 ID token against OpenAI's published JWKS and binds it to
// this attempt's issued client and nonce.
async function verifyIdToken(input: {
  host: NimiConnectorAuthAcquisitionNativeHost;
  profile: ConnectorAuthAcquisitionProfileSpec;
  idToken: string;
  clientId: string;
  nonce: string;
  signal: AbortSignal;
}): Promise<IdentityClaims> {
  const parts = input.idToken.split('.');
  if (parts.length !== 3) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'ID token is not a signed JWT');
  }
  const decoder = new TextDecoder();
  const header = parseJsonObject(decoder.decode(base64UrlDecode(parts[0] ?? '')), 'ID token header');
  const claims = parseJsonObject(decoder.decode(base64UrlDecode(parts[1] ?? '')), 'ID token claims');
  const kid = toTrimmedString(header.kid);
  if (header.alg !== 'RS256' || !kid) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'ID token signing algorithm is not admitted');
  }
  const jwksResponse = await awaitWithCancellation(input.host.proxyHttp({
    profileId: input.profile.profileId,
    purpose: 'jwks',
    url: input.profile.jwksUrl,
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, input.signal), input.signal);
  if (!jwksResponse.ok) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', `OpenAI signing keys were unavailable (HTTP ${jwksResponse.status})`);
  }
  const jwks = parseJsonObject(jwksResponse.body, 'OpenAI signing keys');
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  const jwk = keys.find((candidate) => {
    const key = candidate as Record<string, unknown>;
    return key && key.kid === kid && key.kty === 'RSA' && (key.use === undefined || key.use === 'sig') &&
      (key.alg === undefined || key.alg === 'RS256') && typeof key.n === 'string' && typeof key.e === 'string';
  }) as Record<string, string> | undefined;
  if (!jwk) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'ID token signing key is not published');
  }
  const key = await input.host.crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signatureValid = await input.host.crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(parts[2] ?? ''),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!signatureValid) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'ID token signature is invalid');
  }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const expires = typeof claims.exp === 'number' ? claims.exp : Number.NaN;
  const subject = toTrimmedString(claims.sub);
  if (claims.iss !== input.profile.issuer || !audience.includes(input.clientId) || claims.nonce !== input.nonce ||
    !Number.isFinite(expires) || expires * 1000 <= acquisitionNow(input.host) || !subject) {
    throw new NimiConnectorAuthAcquisitionError('AUTHORIZATION_INVALID', 'ID token does not match this ChatGPT sign-in');
  }
  const email = toTrimmedString(claims.email);
  return { subject, email: email.includes('@') && !/\s/u.test(email) && email.length <= 512 ? email : '' };
}

function withAcquisitionSignal(
  options: RuntimeTypedCallOptions | undefined,
  signal: AbortSignal,
): RuntimeTypedCallOptions {
  return { ...withoutAcquisitionCancellation(options), signal };
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

async function persistAuthorizationThroughRuntime(input: {
  options: NimiAcquireManagedConnectorCredentialInHostOptions;
  profile: ConnectorAuthAcquisitionProfileSpec;
  credentialJson: string;
  accountLabel: string;
  signal: AbortSignal;
}): Promise<string> {
  // The final Runtime custody write is the commit point: cancellation before
  // dispatch aborts; after dispatch the host waits for the exact result.
  throwIfAborted(input.signal);
  const finalWriteCallOptions = withoutAcquisitionCancellation(input.options.callOptions);
  const connectorId = toTrimmedString(input.options.connectorId);
  if (connectorId) {
    const response = await input.options.runtime.updateConnector({
      connectorId,
      status: ConnectorStatus.UNSPECIFIED,
      authKind: ConnectorAuthKind.OAUTH_MANAGED,
      providerAuthProfile: input.profile.providerAuthProfile,
      credentialJson: input.credentialJson,
    }, finalWriteCallOptions);
    return response.connector?.connectorId || connectorId;
  }
  const label = toTrimmedString(input.options.label) || input.accountLabel || 'ChatGPT plan';
  const response = await input.options.runtime.createConnector({
    provider: input.profile.providerAuthProfile,
    endpoint: '',
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

// @nimi-authority: definition.nimi.sdks.feature-clients.connector-auth-plane
// @nimi-authority: rule.nimi.sdks.feature-clients.r060
// @nimi-authority: rule.nimi.sdks.feature-clients.r061
// @nimi-authority: rule.nimi.sdks.feature-clients.siwc-refresh
export async function acquireNimiManagedConnectorCredentialInHost(
  options: NimiAcquireManagedConnectorCredentialInHostOptions,
): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  const profile = profileForId(options.profileId);
  const lifecycle = createAcquisitionSignal(
    [options.signal, options.callOptions?.signal],
    profile.acquisitionTimeoutSeconds * 1000,
  );
  try {
    return await acquireWithProfile(options, profile, lifecycle.signal);
  } finally {
    lifecycle.dispose();
  }
}

async function acquireWithProfile(
  options: NimiAcquireManagedConnectorCredentialInHostOptions,
  profile: ConnectorAuthAcquisitionProfileSpec,
  signal: AbortSignal,
): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  const host = options.host;
  throwIfAborted(signal);
  const registration = await registrationContext(options, profile, signal);
  const hostId = toTrimmedString(await awaitWithCancellation(host.hostIdentifier(signal), signal));
  if (!validHostIdentifier(hostId)) {
    throw new Error('Local host identifier is not an admitted opaque ext_agent_host_id');
  }
  const state = randomToken(host.crypto, 32);
  const nonce = randomToken(host.crypto, 32);
  const verifier = randomToken(host.crypto, 64);
  const challenge = await pkceChallenge(host.crypto, verifier);

  const callback = await startOwnedAuthorizationCallback(host, {
    profileId: profile.profileId, host: profile.callbackHost, path: profile.callbackPath,
  }, signal);
  let params: Record<string, string>;
  let redirectUri: string;
  try {
    redirectUri = exactCallbackRedirect(profile, callback.redirectUri);
    const url = authorizationUrl({ profile, registration, hostId, redirectUri, state, nonce, challenge });
    logAcquisition(host, 'info', 'managed-oauth:browser-authorization:start', {
      profileId: profile.profileId,
      initialRegistration: registration.initialRegistration,
    });
    throwIfAborted(signal);
    options.onPending?.({ authorizationUrl: url, expiresInSeconds: profile.acquisitionTimeoutSeconds });
    const launch = await awaitWithCancellation(host.openExternalUrl(url, signal), signal);
    if (!launch.opened) {
      throw new NimiConnectorAuthAcquisitionError('BROWSER_UNAVAILABLE', 'Unable to open the browser for ChatGPT sign-in');
    }
    params = await awaitWithCancellation(callback.waitForCallback(signal), signal);
  } finally {
    await callback.close();
  }
  const { code, clientId } = callbackRegistration(params, profile, registration, state);
  throwIfAborted(signal);
  const tokens = await exchangeAuthorizationCode({ host, profile, clientId, code, verifier, redirectUri, signal });
  const identity = await verifyIdToken({ host, profile, idToken: tokens.idToken, clientId, nonce, signal });
  if (!tokens.scopes.includes(SIWC_DIRECT_SCOPE) || !tokens.scopes.includes(SIWC_OFFLINE_SCOPE)) {
    throw new NimiConnectorAuthAcquisitionError(
      'PLAN_USAGE_NOT_GRANTED',
      'ChatGPT plan usage was not granted for this sign-in; enable it and sign in again',
    );
  }
  const credentialJson = JSON.stringify({
    schema: SIWC_CREDENTIAL_SCHEMA,
    issuer: profile.issuer,
    subject: identity.subject,
    ...(identity.email ? { email: identity.email } : {}),
    client_id: clientId,
    ext_agent_host_id: hostId,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: tokens.tokenType,
    scopes: tokens.scopes,
    saved_at: new Date(acquisitionNow(host)).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
  });
  logAcquisition(host, 'info', 'managed-oauth:authorization:validated', {
    profileId: profile.profileId,
    initialRegistration: registration.initialRegistration,
  });
  const connectorId = await persistAuthorizationThroughRuntime({
    options, profile, credentialJson, accountLabel: identity.email, signal,
  });
  const result: NimiManagedConnectorCredentialAcquisitionResult = {
    profileId: profile.profileId,
    providerAuthProfile: profile.providerAuthProfile,
    connectorId,
  };
  if (identity.email) result.accountLabel = identity.email;
  return result;
}
