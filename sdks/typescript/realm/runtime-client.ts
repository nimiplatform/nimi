import { CoreClient } from '../core-client/index.js';
import { RealmTypedClient, type RuntimeClientContextDto, type RuntimeClientSourceDto, type RuntimeClientTokenDto, type RuntimeConnectionStateDto } from '../core-generated/realm-typed-client.js';
import { createRealmFetchTransport } from './fetch-transport.js';
import { createNimiError, extractNimiErrorFields } from '../types/index.js';
import { sha256Hex } from '../types/sha256.js';

export interface RuntimeClientLoginOptions {
  readonly realmBaseUrl: string;
  readonly officialWebBaseUrl: string;
  readonly realmEnvironmentId: string;
  readonly appId: string;
  readonly clientId: string;
  readonly redirectUri: string;
  /** An opaque generation from the application's authenticated user session.
   * A Nimi-only app uses a local sign-in-attempt generation; Nimi identity is
   * established only by the verified exchange. Never use an unverified user
   * field. Rotate on sign-out, user switch, canceled sign-in or unlink. */
  readonly currentUserContext: () => string | null;
  readonly fetch?: typeof fetch;
}

export type RuntimeClientIdentity = Omit<RuntimeClientTokenDto, 'contextToken'>;

/** The official confirmation page submits a navigation form to this Realm endpoint. */
// @nimi-authority: rule.nimi.platform.product-lifecycle.remote-client-sign-in
export function runtimeClientConfirmationUrl(realmBaseUrl: string): string {
  return new URL('/api/auth/runtime-clients/authorize', trustedOrigin(realmBaseUrl)).href;
}

// @nimi-authority: rule.nimi.platform.remote-clients.android-development
/** URI syntax only. Realm still owns exact source admission and environment. */
export function isRuntimeClientRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.href !== value || url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+:$/.test(url.protocol)
      && !url.host && url.pathname.startsWith('/') && !url.pathname.startsWith('//')
      && url.href === url.protocol + url.pathname;
  } catch { return false; }
}

/** Match the registered destination before consuming a transaction. Private-use
 * URLs have the same opaque `origin`, so origin/path comparison is insufficient. */
export function matchesRuntimeClientCallback(value: string, redirectUri: string): boolean {
  if (!isRuntimeClientRedirectUri(redirectUri)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    url.search = '';
    return url.href === redirectUri;
  } catch { return false; }
}

/** Store only in the initiating application's own session. It contains a PKCE
 * secret and is never a Nimi identity result or reusable Runtime permission. */
export interface RuntimeClientLoginTransaction {
  readonly applicationUserContext: string;
  readonly clientId: string;
  readonly appId: string;
  readonly redirectUri: string;
  readonly realmEnvironmentId: string;
  readonly realmBaseUrl: string;
  readonly state: string;
  readonly codeVerifier: string;
  readonly expectedAccountId?: string;
}

/** Read the admitted source before handing off to a native login browser.
 * This returns public source facts, never a user identity or permission. */
// @nimi-authority: rule.nimi.sdks.realm-consumer.runtime-client-context
export async function readRuntimeClientSource(options: Pick<RuntimeClientLoginOptions,
  'realmBaseUrl' | 'appId' | 'clientId' | 'redirectUri' | 'fetch'>): Promise<RuntimeClientSourceDto> {
  const source = await client(options).getRuntimeClientSource({ path: { clientId: options.clientId } });
  if (source.appId !== options.appId || source.clientId !== options.clientId || source.redirectUri !== options.redirectUri) throw invalidLogin();
  return source;
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.runtime-client-context
export async function prepareRuntimeClientLogin(options: RuntimeClientLoginOptions, expectedAccountId?: string): Promise<{
  authorizationUrl: string;
  transaction: RuntimeClientLoginTransaction;
}> {
  const owner = options.currentUserContext();
  if (!owner) throw contextChanged();
  const realmBaseUrl = trustedOrigin(options.realmBaseUrl);
  const officialWebBaseUrl = trustedOrigin(options.officialWebBaseUrl);
  if (!isRuntimeClientRedirectUri(options.redirectUri)) throw invalidLogin();
  if (!options.appId || !options.clientId || !options.realmEnvironmentId || expectedAccountId === '') throw invalidLogin();
  const verifier = randomSecret();
  const state = randomSecret();
  // Reuse the SDK's platform-independent SHA-256. Native shells need their
  // platform CSPRNG, but no browser-only SubtleCrypto or base64 globals.
  const digest = sha256Hex(new TextEncoder().encode(verifier));
  const challenge = base64url(Uint8Array.from(digest.match(/../g)!, byte => Number.parseInt(byte, 16)));
  if (options.currentUserContext() !== owner) throw contextChanged();
  const url = new URL('/account/connect', officialWebBaseUrl);
  url.search = new URLSearchParams({ client_id: options.clientId, redirect_uri: options.redirectUri,
    code_challenge: challenge, code_challenge_method: 'S256', state }).toString();
  return { authorizationUrl: url.href, transaction: {
    applicationUserContext: owner, clientId: options.clientId, appId: options.appId, redirectUri: options.redirectUri,
    realmEnvironmentId: options.realmEnvironmentId, realmBaseUrl, state, codeVerifier: verifier,
    ...(expectedAccountId ? { expectedAccountId } : {}),
  } };
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.runtime-client-context
export async function completeRuntimeClientLogin(options: RuntimeClientLoginOptions, transaction: RuntimeClientLoginTransaction,
  callbackUrl: string): Promise<RuntimeClientSession> {
  const current = options.currentUserContext();
  if (!current || transaction.applicationUserContext !== current) throw contextChanged();
  if (transaction.clientId !== options.clientId || transaction.appId !== options.appId
    || transaction.redirectUri !== options.redirectUri || transaction.realmBaseUrl !== trustedOrigin(options.realmBaseUrl)
    || transaction.realmEnvironmentId !== options.realmEnvironmentId
    || !/^[A-Za-z0-9_-]{43}$/.test(transaction.codeVerifier) || !/^[A-Za-z0-9_-]{43}$/.test(transaction.state)) throw invalidLogin();
  if (!matchesRuntimeClientCallback(callbackUrl, transaction.redirectUri)) throw invalidLogin();
  const callback = new URL(callbackUrl);
  if (callback.searchParams.get('state') !== transaction.state) throw invalidLogin();
  if (callback.searchParams.get('error') === 'access_denied') throw createNimiError({ message: 'Nimi sign-in was canceled.',
    reasonCode: 'RUNTIME_CLIENT_LOGIN_CANCELLED', source: 'sdk' });
  const code = callback.searchParams.get('code') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || [...callback.searchParams].length !== 2) throw invalidLogin();
  const token = await client(options).exchangeRuntimeClientCode({ path: {}, body: {
    clientId: transaction.clientId, redirectUri: transaction.redirectUri, authorizationCode: code, codeVerifier: transaction.codeVerifier,
  } });
  const session = new CurrentRuntimeClientSession(options, current, token);
  if (options.currentUserContext() !== current || token.realmEnvironmentId !== options.realmEnvironmentId
    || token.clientId !== options.clientId || token.appId !== options.appId
    || !token.accountId || !token.contextId || !/^[A-Za-z0-9_-]{43}$/.test(token.contextToken)
    || !Number.isFinite(Date.parse(token.expiresAt)) || Date.parse(token.expiresAt) <= Date.now()
    || (transaction.expectedAccountId && token.accountId !== transaction.expectedAccountId)) {
    await session.end().catch(() => undefined);
    throw contextChanged();
  }
  return session;
}

/** Current identity and primary discovery only. This does not report a peer
 * connection or AI readiness, and provides no generic Realm account client. */
export interface RuntimeClientSession {
  readonly identity: Readonly<RuntimeClientIdentity>;
  readonly closed: boolean;
  readonly active: boolean;
  readonly signal: AbortSignal;
  read(): Promise<RuntimeClientContextDto>;
  createConnection(offerSdp: string, expectedBindingId: string): Promise<RuntimeConnectionStateDto>;
  readConnection(connectionId: string, expectedBindingId: string): Promise<RuntimeConnectionStateDto>;
  end(): Promise<void>;
}

class CurrentRuntimeClientSession implements RuntimeClientSession {
  readonly identity: Readonly<RuntimeClientIdentity>;
  readonly #options: RuntimeClientLoginOptions;
  readonly #owner: string;
  readonly #api: RealmTypedClient;
  readonly #abort = new AbortController();
  #closed = false;
  #revoked = false;
  #ending?: Promise<void>;

  constructor(options: RuntimeClientLoginOptions, owner: string, token: RuntimeClientTokenDto) {
    this.#options = options; this.#owner = owner;
    this.identity = Object.freeze({ realmEnvironmentId: token.realmEnvironmentId, accountId: token.accountId,
      displayName: token.displayName, appId: token.appId, clientId: token.clientId, contextId: token.contextId, expiresAt: token.expiresAt });
    this.#api = client(options, token.contextToken);
  }

  get closed(): boolean { return this.#closed; }
  get active(): boolean {
    const active = !this.#closed && this.#options.currentUserContext() === this.#owner && Date.parse(this.identity.expiresAt) > Date.now();
    if (!active && !this.#closed) void this.end().catch(() => undefined);
    return active;
  }
  get signal(): AbortSignal { return this.#abort.signal; }

  async createConnection(offerSdp: string, expectedBindingId: string): Promise<RuntimeConnectionStateDto> {
    this.#assertCurrent();
    const result = await this.#request(() => this.#api.createRuntimeConnection({ path: {}, body: { offerSdp, bindingId: expectedBindingId } }, { signal: this.#abort.signal }));
    this.#assertCurrent();
    if (result.bindingId !== expectedBindingId || result.status !== 'pending') throw invalidLogin();
    return result;
  }

  async readConnection(connectionId: string, expectedBindingId: string): Promise<RuntimeConnectionStateDto> {
    this.#assertCurrent();
    const result = await this.#request(() => this.#api.getRuntimeConnection({ path: { connectionId } }, { signal: this.#abort.signal }));
    this.#assertCurrent();
    if (result.bindingId !== expectedBindingId || result.connectionId !== connectionId) throw invalidLogin();
    return result;
  }

  async read(): Promise<RuntimeClientContextDto> {
    this.#assertCurrent();
    const result = await this.#request(() => this.#api.getRuntimeClientContext({ path: {} }, { signal: this.#abort.signal }));
    this.#assertCurrent();
    if (result.contextId !== this.identity.contextId || result.accountId !== this.identity.accountId
      || result.appId !== this.identity.appId || result.clientId !== this.identity.clientId
      || result.realmEnvironmentId !== this.identity.realmEnvironmentId) {
      await this.end().catch(() => undefined); throw contextChanged();
    }
    return result;
  }

  /** Call immediately on local sign-out, account switch or unlink. Local use
   * ends before the request. Realm-confirmed absence is terminal; an uncertain
   * revocation still fails and can be explicitly retried. */
  async end(): Promise<void> {
    this.#closed = true; this.#abort.abort();
    if (this.#revoked) return;
    if (!this.#ending) {
      this.#ending = this.#api.endRuntimeClientContext({ path: {} }, { signal: AbortSignal.timeout(5000) })
        .catch((error: unknown) => {
          if (extractNimiErrorFields(error).reasonCode !== 'RUNTIME_CLIENT_CONTEXT_INVALID') throw error;
        })
        .then(() => { this.#revoked = true; }).finally(() => { this.#ending = undefined; });
    }
    await this.#ending;
  }

  #assertCurrent(): void {
    if (!this.active) throw contextChanged();
  }

  async #request<T>(execute: () => Promise<T>): Promise<T> {
    try { return await execute(); }
    catch (error) {
      if (extractNimiErrorFields(error).reasonCode === 'RUNTIME_CLIENT_CONTEXT_INVALID') {
        this.#closed = true; this.#revoked = true; this.#abort.abort();
      }
      throw error;
    }
  }
}

function client(options: Pick<RuntimeClientLoginOptions, 'realmBaseUrl' | 'fetch'>, token?: string): RealmTypedClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  return new RealmTypedClient(new CoreClient({ transport: createRealmFetchTransport({ baseUrl: trustedOrigin(options.realmBaseUrl),
    credentials: 'omit', fetch: (input, init) => fetchImpl(input, { ...init, redirect: 'error', credentials: 'omit' }),
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  }) }));
}
function trustedOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw invalidLogin();
  return url.origin;
}
function randomSecret(): string {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw createNimiError({ message: 'A platform cryptographic random source is required.',
    reasonCode: 'SDK_RUNTIME_REMOTE_CRYPTO_REQUIRED', source: 'sdk' });
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}
function base64url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '', value = 0, bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 6) { bits -= 6; result += alphabet[(value >>> bits) & 63]; }
  }
  if (bits) result += alphabet[(value << (6 - bits)) & 63];
  return result;
}
function invalidLogin() { return createNimiError({ message: 'Runtime client sign-in request is invalid.', reasonCode: 'RUNTIME_CLIENT_INPUT_INVALID', source: 'sdk' }); }
function contextChanged() { return createNimiError({ message: 'The application user context changed or expired. Start a new Nimi connection.', reasonCode: 'RUNTIME_CLIENT_CONTEXT_INVALID', source: 'sdk' }); }
