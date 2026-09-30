import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

import { ConnectorAuthKind } from '../core-generated/runtime-typed-client';
import {
  acquireNimiManagedConnectorCredential,
  type NimiManagedConnectorCredentialAcquisitionHost,
} from './index';
import {
  acquireNimiManagedConnectorCredentialInHost,
  CONNECTOR_AUTH_ACQUISITION_PROFILES,
  NimiConnectorAuthAcquisitionError,
  type NimiConnectorAuthAcquisitionHttpRequest,
  type NimiConnectorAuthAcquisitionNativeHost,
  type NimiManagedConnectorCredentialRuntime,
} from './host';

const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_chatgpt_plan!;
const HOST_ID = 'urn:uuid:4a0f7f2c-0d3c-4d8e-9d59-1f2a3b4c5d6e';
const ISSUED_CLIENT = 'oaiapp_issued_client';
const NOW = Date.parse('2026-09-30T12:00:00.000Z');

function base64Url(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString('base64url');
}

type SigningKey = { privateKey: CryptoKey; jwk: JsonWebKey };

async function signingKey(): Promise<SigningKey> {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  return { privateKey: pair.privateKey, jwk: await webcrypto.subtle.exportKey('jwk', pair.publicKey) };
}

async function idToken(key: SigningKey, claims: Record<string, unknown>, kid = 'key-1'): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = base64Url(JSON.stringify(claims));
  const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

type Scenario = {
  host: NimiConnectorAuthAcquisitionNativeHost;
  runtime: NimiManagedConnectorCredentialRuntime;
  http: NimiConnectorAuthAcquisitionHttpRequest[];
  opened: string[];
  writes: Array<{ kind: 'create' | 'update'; request: Record<string, unknown> }>;
  lists: Array<Record<string, unknown>>;
  closed: { count: number };
  callbackStartedBeforeBrowser: { value: boolean };
};

async function scenario(options: {
  callback?: (url: URL) => Record<string, string>;
  claims?: (nonce: string) => Record<string, unknown>;
  scope?: string;
  connector?: Record<string, unknown>;
  tamperSignature?: boolean;
  beforeWrite?: () => void;
} = {}): Promise<Scenario> {
  const key = await signingKey();
  const http: NimiConnectorAuthAcquisitionHttpRequest[] = [];
  const opened: string[] = [];
  const writes: Scenario['writes'] = [];
  const lists: Scenario['lists'] = [];
  const closed = { count: 0 };
  const callbackStartedBeforeBrowser = { value: false };
  let callbackStarted = false;
  let delivered: Record<string, string> | undefined;
  let resolveCallback: ((params: Record<string, string>) => void) | undefined;
  const host: NimiConnectorAuthAcquisitionNativeHost = {
    async proxyHttp(request) {
      http.push(request);
      if (request.purpose === 'jwks') {
        return { status: 200, ok: true, body: JSON.stringify({ keys: [{ ...key.jwk, kid: 'key-1', use: 'sig', alg: 'RS256' }] }) };
      }
      const form = new URLSearchParams(request.body);
      const authorizeUrl = new URL(opened[0]!);
      const claims = options.claims?.(authorizeUrl.searchParams.get('nonce')!) ?? {
        iss: 'https://auth.openai.com', aud: form.get('client_id'), sub: 'account-subject', email: 'user@example.com',
        nonce: authorizeUrl.searchParams.get('nonce'), exp: Math.floor(NOW / 1000) + 3600,
      };
      let token = await idToken(key, claims);
      if (options.tamperSignature) token = `${token.slice(0, -4)}AAAA`;
      return {
        status: 200, ok: true,
        body: JSON.stringify({
          access_token: 'access.jwt.value', refresh_token: 'rotating-refresh', id_token: token, token_type: 'Bearer', expires_in: 3600,
          scope: options.scope ?? 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke',
        }),
      };
    },
    async openExternalUrl(url) {
      callbackStartedBeforeBrowser.value = callbackStarted;
      opened.push(url);
      const parsed = new URL(url);
      // The browser returns asynchronously; the listener may register later.
      delivered = options.callback?.(parsed) ?? {
        code: 'authorization-code', state: parsed.searchParams.get('state')!, client_id: ISSUED_CLIENT,
        scope: 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke',
      };
      resolveCallback?.(delivered);
      return { opened: true };
    },
    async startAuthorizationCallback(request) {
      assert.deepEqual(request, { profileId: 'openai_chatgpt_plan', host: '127.0.0.1', path: '/auth/callback' });
      callbackStarted = true;
      return {
        redirectUri: 'http://127.0.0.1:54321/auth/callback',
        waitForCallback: (signal) => new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          if (delivered) resolve(delivered);
          else resolveCallback = resolve;
        }),
        close: () => {
          closed.count += 1;
        },
      };
    },
    async hostIdentifier() {
      return HOST_ID;
    },
    crypto: webcrypto as unknown as NimiConnectorAuthAcquisitionNativeHost['crypto'],
    now: () => NOW,
  };
  const runtime: NimiManagedConnectorCredentialRuntime = {
    async createConnector(request) {
      options.beforeWrite?.();
      writes.push({ kind: 'create', request: request as unknown as Record<string, unknown> });
      return { connector: { connectorId: 'connector-new' } } as never;
    },
    async updateConnector(request) {
      options.beforeWrite?.();
      writes.push({ kind: 'update', request: request as unknown as Record<string, unknown> });
      return { connector: { connectorId: String(request.connectorId) } } as never;
    },
    async listConnectors(request) {
      lists.push(request as unknown as Record<string, unknown>);
      return { connectors: options.connector ? [options.connector] : [], nextPageToken: '' } as never;
    },
  };
  return { host, runtime, http, opened, writes, lists, closed, callbackStartedBeforeBrowser };
}

test('initial ChatGPT plan registration uses loopback PKCE and seals only validated tokens in Runtime custody', async () => {
  const run = await scenario();
  const pending: unknown[] = [];
  const result = await acquireNimiManagedConnectorCredentialInHost({
    profileId: 'openai_chatgpt_plan', host: run.host, runtime: run.runtime, onPending: (state) => pending.push(state),
  });
  assert.deepEqual(result, { profileId: 'openai_chatgpt_plan', providerAuthProfile: 'openai_chatgpt_plan', connectorId: 'connector-new', accountLabel: 'user@example.com' });
  assert.equal(run.callbackStartedBeforeBrowser.value, true);
  const url = new URL(run.opened[0]!);
  assert.equal(`${url.origin}${url.pathname}`, 'https://auth.openai.com/api/accounts/authorize');
  const params = Object.fromEntries(url.searchParams);
  assert.equal(params.client_id, 'dynamic_agent_client');
  assert.equal(params.agent_name_hint, 'Nimi');
  assert.equal(params.ext_agent_host_id, HOST_ID);
  assert.equal(params.redirect_uri, 'http://127.0.0.1:54321/auth/callback');
  assert.equal(params.scope, 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
  assert.equal(params.resource, 'https://api.openai.com/v1');
  assert.equal(params.response_type, 'code');
  assert.equal(params.code_challenge_method, 'S256');
  assert.ok(params.state && params.nonce && params.code_challenge && params.state !== params.nonce);
  assert.equal(params.login_hint, undefined);
  const exchange = run.http.find((request) => request.purpose === 'authorization_code_exchange')!;
  const form = Object.fromEntries(new URLSearchParams(exchange.body));
  assert.equal(exchange.url, 'https://auth.openai.com/api/accounts/oauth/token');
  assert.equal(form.client_id, ISSUED_CLIENT);
  assert.equal(form.grant_type, 'authorization_code');
  assert.equal(form.redirect_uri, params.redirect_uri);
  assert.equal(form.resource, 'https://api.openai.com/v1');
  const challenge = base64Url(new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(form.code_verifier!))));
  assert.equal(challenge, params.code_challenge);
  assert.equal(run.closed.count, 1);
  assert.equal(run.writes.length, 1);
  const write = run.writes[0]!;
  assert.equal(write.kind, 'create');
  assert.equal(write.request.provider, 'openai_chatgpt_plan');
  assert.equal(write.request.endpoint, '');
  assert.equal(write.request.authKind, ConnectorAuthKind.OAUTH_MANAGED);
  assert.equal(write.request.label, 'user@example.com');
  const credential = JSON.parse(String(write.request.credentialJson));
  assert.deepEqual(Object.keys(credential).sort(), [
    'access_token', 'client_id', 'email', 'ext_agent_host_id', 'issuer', 'refresh_token', 'saved_at', 'schema', 'scopes', 'subject', 'token_type',
  ]);
  assert.equal(credential.schema, 'nimi.openai_chatgpt_plan.siwc/v1');
  assert.equal(credential.client_id, ISSUED_CLIENT);
  assert.equal(credential.subject, 'account-subject');
  assert.equal(credential.saved_at, '2026-09-30T12:00:00Z');
  assert.equal(JSON.stringify(pending).includes('rotating-refresh'), false);
  assert.equal(JSON.stringify(result).includes('access.jwt.value'), false);
  assert.deepEqual(pending, [{ authorizationUrl: run.opened[0], expiresInSeconds: profile.acquisitionTimeoutSeconds }]);
});

test('explicit reauthorization reuses the Runtime-bound registration and updates the same Connector', async () => {
  const run = await scenario({
    connector: {
      connectorId: 'connector-1', provider: 'openai_chatgpt_plan', providerAuthProfile: 'openai_chatgpt_plan',
      oauthRegistration: { issuedClientId: ISSUED_CLIENT, accountLabel: 'user@example.com' },
    },
    callback: (url) => ({ code: 'code-2', state: url.searchParams.get('state')! }),
  });
  await acquireNimiManagedConnectorCredentialInHost({ profileId: 'openai_chatgpt_plan', connectorId: 'connector-1', host: run.host, runtime: run.runtime });
  const params = new URL(run.opened[0]!).searchParams;
  assert.equal(params.get('client_id'), ISSUED_CLIENT);
  assert.equal(params.get('agent_name_hint'), null);
  assert.equal(params.get('login_hint'), 'user@example.com');
  assert.equal(params.get('ext_agent_host_id'), HOST_ID);
  assert.equal(run.writes.length, 1);
  assert.equal(run.writes[0]!.kind, 'update');
  assert.equal(run.writes[0]!.request.connectorId, 'connector-1');
  // The protected Desktop account carrier admits ListConnectors, not GetConnector.
  assert.deepEqual(run.lists.map((request) => request.providerFilter), ['openai_chatgpt_plan']);
});

test('invalid callbacks, identities and grants never reach Runtime custody', async () => {
  const cases: Array<{ name: string; code: string; options: Parameters<typeof scenario>[0] }> = [
    { name: 'state mismatch', code: 'AUTHORIZATION_INVALID', options: { callback: () => ({ code: 'c', state: 'forged', client_id: ISSUED_CLIENT }) } },
    { name: 'denied', code: 'AUTHORIZATION_DENIED', options: { callback: (url) => ({ error: 'access_denied', state: url.searchParams.get('state')! }) } },
    { name: 'no issued client', code: 'AUTHORIZATION_INVALID', options: { callback: (url) => ({ code: 'c', state: url.searchParams.get('state')! }) } },
    { name: 'registration entrypoint returned', code: 'AUTHORIZATION_INVALID', options: { callback: (url) => ({ code: 'c', state: url.searchParams.get('state')!, client_id: 'dynamic_agent_client' }) } },
    { name: 'plan usage not granted', code: 'PLAN_USAGE_NOT_GRANTED', options: { scope: 'email offline_access openid profile' } },
    { name: 'bad signature', code: 'AUTHORIZATION_INVALID', options: { tamperSignature: true } },
    { name: 'wrong nonce', code: 'AUTHORIZATION_INVALID', options: { claims: () => ({ iss: 'https://auth.openai.com', aud: ISSUED_CLIENT, sub: 's', nonce: 'other', exp: NOW / 1000 + 60 }) } },
    { name: 'wrong audience', code: 'AUTHORIZATION_INVALID', options: { claims: (nonce) => ({ iss: 'https://auth.openai.com', aud: 'oaiapp_other', sub: 's', nonce, exp: NOW / 1000 + 60 }) } },
    { name: 'expired identity', code: 'AUTHORIZATION_INVALID', options: { claims: (nonce) => ({ iss: 'https://auth.openai.com', aud: ISSUED_CLIENT, sub: 's', nonce, exp: NOW / 1000 - 1 }) } },
    { name: 'foreign issuer', code: 'AUTHORIZATION_INVALID', options: { claims: (nonce) => ({ iss: 'https://example.com', aud: ISSUED_CLIENT, sub: 's', nonce, exp: NOW / 1000 + 60 }) } },
  ];
  for (const testCase of cases) {
    const run = await scenario(testCase.options);
    await assert.rejects(
      acquireNimiManagedConnectorCredentialInHost({ profileId: 'openai_chatgpt_plan', host: run.host, runtime: run.runtime }),
      (error: unknown) => error instanceof NimiConnectorAuthAcquisitionError && error.code === testCase.code,
      testCase.name,
    );
    assert.equal(run.writes.length, 0, testCase.name);
    assert.equal(run.closed.count, 1, `${testCase.name} closed the callback listener`);
  }
});

test('reauthorization rejects a different registration and Connectors without one', async () => {
  const connector = {
    connectorId: 'connector-1', provider: 'openai_chatgpt_plan', providerAuthProfile: 'openai_chatgpt_plan',
    oauthRegistration: { issuedClientId: ISSUED_CLIENT, accountLabel: 'user@example.com' },
  };
  const other = await scenario({ connector, callback: (url) => ({ code: 'c', state: url.searchParams.get('state')!, client_id: 'oaiapp_other' }) });
  await assert.rejects(
    acquireNimiManagedConnectorCredentialInHost({ profileId: 'openai_chatgpt_plan', connectorId: 'connector-1', host: other.host, runtime: other.runtime }),
    (error: unknown) => error instanceof NimiConnectorAuthAcquisitionError && error.code === 'AUTHORIZATION_INVALID',
  );
  const legacy = await scenario({ connector: { connectorId: 'legacy', provider: 'openai_codex', providerAuthProfile: 'openai_codex' } });
  await assert.rejects(
    acquireNimiManagedConnectorCredentialInHost({ profileId: 'openai_chatgpt_plan', connectorId: 'legacy', host: legacy.host, runtime: legacy.runtime }),
    (error: unknown) => error instanceof NimiConnectorAuthAcquisitionError && error.code === 'REGISTRATION_UNAVAILABLE',
  );
  assert.equal(legacy.opened.length, 0);
  const missing = await scenario();
  await assert.rejects(
    acquireNimiManagedConnectorCredentialInHost({ profileId: 'openai_chatgpt_plan', connectorId: 'connector-removed', host: missing.host, runtime: missing.runtime }),
    (error: unknown) => error instanceof NimiConnectorAuthAcquisitionError && error.code === 'REGISTRATION_UNAVAILABLE',
  );
  assert.equal(missing.opened.length, 0);
  assert.equal(other.writes.length + legacy.writes.length + missing.writes.length, 0);
});

test('cancellation before the final write aborts while a dispatched write settles exactly', async () => {
  const controller = new AbortController();
  const run = await scenario({ callback: () => {
    controller.abort(new DOMException('user canceled', 'AbortError'));
    return {};
  } });
  await assert.rejects(
    acquireNimiManagedConnectorCredentialInHost({ profileId: 'openai_chatgpt_plan', host: run.host, runtime: run.runtime, signal: controller.signal }),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.equal(run.writes.length, 0);
  assert.equal(run.closed.count, 1);

  const late = new AbortController();
  const dispatched = await scenario({ beforeWrite: () => late.abort(new DOMException('late cancel', 'AbortError')) });
  const result = await acquireNimiManagedConnectorCredentialInHost({ profileId: 'openai_chatgpt_plan', host: dispatched.host, runtime: dispatched.runtime, signal: late.signal });
  assert.equal(result.connectorId, 'connector-new');
  assert.equal(dispatched.writes.length, 1);
});

test('cancellation while the host starts the listener closes the late listener before settling', async () => {
  const run = await scenario();
  const controller = new AbortController();
  let startRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    startRequested = resolve;
  });
  let returnListener!: () => void;
  const startup = new Promise<void>((resolve) => {
    returnListener = resolve;
  });
  let closes = 0;
  const host: NimiConnectorAuthAcquisitionNativeHost = {
    ...run.host,
    async startAuthorizationCallback() {
      startRequested();
      await startup;
      return {
        redirectUri: 'http://127.0.0.1:54321/auth/callback',
        waitForCallback: () => new Promise<Record<string, string>>(() => undefined),
        close: async () => {
          closes += 1;
        },
      };
    },
  };
  let settled = false;
  const operation = acquireNimiManagedConnectorCredentialInHost({
    profileId: 'openai_chatgpt_plan', host, runtime: run.runtime, signal: controller.signal,
  }).finally(() => {
    settled = true;
  });
  await requested;
  controller.abort(new DOMException('user canceled during listener startup', 'AbortError'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  // Cancellation waits for the listener the host is still creating.
  assert.equal(settled, false);
  returnListener();
  await assert.rejects(operation, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(closes, 1);
  assert.equal(run.opened.length, 0);
  assert.equal(run.writes.length, 0);
});

test('a listener the host returns after cancellation settled is still closed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const run = await scenario();
  const controller = new AbortController();
  let startRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    startRequested = resolve;
  });
  let returnListener!: () => void;
  const startup = new Promise<void>((resolve) => {
    returnListener = resolve;
  });
  let closes = 0;
  const host: NimiConnectorAuthAcquisitionNativeHost = {
    ...run.host,
    async startAuthorizationCallback() {
      startRequested();
      await startup;
      return {
        redirectUri: 'http://127.0.0.1:54321/auth/callback',
        waitForCallback: () => new Promise<Record<string, string>>(() => undefined),
        close: async () => {
          closes += 1;
        },
      };
    },
  };
  const operation = acquireNimiManagedConnectorCredentialInHost({
    profileId: 'openai_chatgpt_plan', host, runtime: run.runtime, signal: controller.signal,
  });
  await requested;
  controller.abort(new DOMException('user canceled during listener startup', 'AbortError'));
  await new Promise((resolve) => setImmediate(resolve));
  // A host that never returns cannot hold cancellation open indefinitely.
  t.mock.timers.tick(5_000);
  await assert.rejects(operation, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(closes, 0);
  returnListener();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 1);
  assert.equal(run.opened.length, 0);
  assert.equal(run.writes.length, 0);
});

test('renderer facade accepts only the narrowed request and a secret-free result', async () => {
  const host: NimiManagedConnectorCredentialAcquisitionHost = {
    async acquireManagedConnectorCredential(input) {
      input.onPending?.({ authorizationUrl: 'https://auth.openai.com/api/accounts/authorize?client_id=x', expiresInSeconds: 600 });
      return { profileId: 'openai_chatgpt_plan', providerAuthProfile: 'openai_chatgpt_plan', connectorId: 'c', accountLabel: 'user@example.com' };
    },
  };
  const pending: unknown[] = [];
  const result = await acquireNimiManagedConnectorCredential({ profileId: 'openai_chatgpt_plan', host, onPending: (state) => pending.push(state) });
  assert.equal(result.accountLabel, 'user@example.com');
  assert.equal(pending.length, 1);
  await assert.rejects(
    acquireNimiManagedConnectorCredential({ profileId: 'openai_chatgpt_plan', host, provider: 'openai' } as never),
    /unexpected field provider/u,
  );
  const leaking: NimiManagedConnectorCredentialAcquisitionHost = {
    async acquireManagedConnectorCredential() {
      return { profileId: 'openai_chatgpt_plan', providerAuthProfile: 'openai_chatgpt_plan', connectorId: 'c', accessToken: 'secret' };
    },
  };
  await assert.rejects(acquireNimiManagedConnectorCredential({ profileId: 'openai_chatgpt_plan', host: leaking }), /unexpected field accessToken/u);
});
