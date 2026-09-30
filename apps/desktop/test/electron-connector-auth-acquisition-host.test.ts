import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import type { NimiConnectorAuthAcquisitionCallback } from '@nimiplatform/sdk/runtime/host';
import {
  bindDesktopSenderInvalidation,
  createDesktopElectronConnectorAuthAcquisitionHost,
  createDesktopManagedConnectorCredentialRuntime,
} from '../src-electron/connector-auth-acquisition-host.js';
import {
  DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND,
  DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND,
  desktopManagedConnectorAuthPendingEvent,
} from '../src/shell/shared/connector-auth-acquisition-contract.js';

const ISSUED_CLIENT = 'oaiapp_desktop_test';
const HOST_ID = 'urn:uuid:9d7f1f61-4ab0-4d1b-a0e6-3c1f5e4d2b10';
const NOW = Date.parse('2026-09-30T12:00:00.000Z');

type SigningKey = { privateKey: webcrypto.CryptoKey; jwk: webcrypto.JsonWebKey };

async function signingKey(): Promise<SigningKey> {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  return { privateKey: pair.privateKey, jwk: await webcrypto.subtle.exportKey('jwk', pair.publicKey) };
}

async function idToken(key: SigningKey, claims: Record<string, unknown>): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'desktop-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;
}

// A browser, loopback listener and OpenAI endpoint double for one sign-in.
async function signInDouble(options: {
  callback?: (url: URL) => Record<string, string>;
  holdCallback?: boolean;
} = {}) {
  const key = await signingKey();
  const opened: string[] = [];
  const httpPurposes: string[] = [];
  let delivered: Record<string, string> | undefined;
  let resolveCallback: ((params: Record<string, string>) => void) | undefined;
  let callbackListenerStarted: (() => void) | undefined;
  const listening = new Promise<void>((resolve) => {
    callbackListenerStarted = resolve;
  });
  return {
    opened,
    httpPurposes,
    listening,
    async proxyHttp(request: { purpose: string; body?: string }) {
      httpPurposes.push(request.purpose);
      if (request.purpose === 'jwks') {
        return { status: 200, ok: true, body: JSON.stringify({ keys: [{ ...key.jwk, kid: 'desktop-key', alg: 'RS256', use: 'sig' }] }) };
      }
      const nonce = new URL(opened[0]!).searchParams.get('nonce');
      return {
        status: 200, ok: true,
        body: JSON.stringify({
          access_token: 'desktop.access.token', refresh_token: 'desktop-refresh-token', token_type: 'Bearer', expires_in: 3600,
          id_token: await idToken(key, { iss: 'https://auth.openai.com', aud: ISSUED_CLIENT, sub: 'account', email: 'user@example.com', nonce, exp: NOW / 1000 + 3600 }),
          scope: 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke',
        }),
      };
    },
    async openExternalUrl(url: string) {
      opened.push(url);
      const parsed = new URL(url);
      delivered = options.callback?.(parsed) ?? { code: 'code', state: parsed.searchParams.get('state')!, client_id: ISSUED_CLIENT };
      if (!options.holdCallback) resolveCallback?.(delivered);
    },
    async startAuthorizationCallback(): Promise<NimiConnectorAuthAcquisitionCallback> {
      callbackListenerStarted?.();
      return {
        redirectUri: 'http://127.0.0.1:61234/auth/callback',
        waitForCallback: (signal) => new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          if (delivered && !options.holdCallback) resolve(delivered);
          else resolveCallback = resolve;
        }),
        close: () => undefined,
      };
    },
    hostIdentifier: async () => HOST_ID,
    crypto: webcrypto as never,
    now: () => NOW,
  };
}

test('Desktop sender invalidation excludes same-document navigation and covers renderer replacement', () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const webContents = {
    on(eventName: string, listener: (...args: unknown[]) => void) {
      listeners.set(eventName, listener);
      return webContents;
    },
  } as unknown as Parameters<typeof bindDesktopSenderInvalidation>[0];
  let invalidations = 0;
  bindDesktopSenderInvalidation(webContents, () => {
    invalidations += 1;
  });

  listeners.get('did-start-navigation')?.({}, 'https://frame.invalid', false, false);
  assert.equal(invalidations, 0, 'subframe navigation must not invalidate the Desktop sender');
  listeners.get('did-start-navigation')?.({}, 'nimi-app://desktop/#/login', true, true);
  assert.equal(invalidations, 0, 'same-document navigation must preserve the Desktop sender');
  listeners.get('did-start-navigation')?.({}, 'nimi-app://desktop/', false, true);
  assert.equal(invalidations, 1, 'main-frame navigation must invalidate active acquisitions');
  listeners.get('render-process-gone')?.();
  assert.equal(invalidations, 2, 'renderer loss must keep invalidating active acquisitions');
});

// The protected account carrier admits ListConnectors but not GetConnector, so
// reauthorization reads its registration from a list and GetConnector never
// reaches the carrier, where it would fail as an untrusted Runtime.
test('Desktop credential Runtime reads Connectors only through the carrier-admitted list', async () => {
  const methods: string[] = [];
  const runtime = createDesktopManagedConnectorCredentialRuntime({
    async accountProductUnary(input: { readonly methodId: string }) {
      methods.push(input.methodId);
      throw new Error('test read released');
    },
  } as never);
  await assert.rejects(runtime.listConnectors({ pageSize: 0, pageToken: '', kindFilter: 0, statusFilter: 0, providerFilter: 'openai_chatgpt_plan' } as never));
  assert.deepEqual(methods, ['/nimi.runtime.v1.RuntimeConnectorService/ListConnectors']);
  const unadmitted = runtime as unknown as { getConnector(request: unknown): Promise<unknown> };
  await assert.rejects(
    unadmitted.getConnector({ connectorId: 'connector-1' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'desktop-managed-connector-runtime-method-forbidden',
  );
  assert.equal(methods.length, 1, 'GetConnector never reached the protected carrier');
});

test('Desktop credential Runtime admits only Connector list, create and update with explicit request identity', async () => {
  const controller = new AbortController();
  let capturedInput: Record<string, unknown> | undefined;
  let releaseWrite: (() => void) | undefined;
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const runtime = createDesktopManagedConnectorCredentialRuntime({
    async accountProductUnary(input: { readonly signal?: AbortSignal; readonly requestId?: string }) {
      capturedInput = input as unknown as Record<string, unknown>;
      await writeGate;
      throw new Error('test write released');
    },
  } as never);
  const operation = runtime.createConnector({ provider: 'openai_chatgpt_plan', endpoint: '', label: 'ChatGPT plan', apiKey: '' } as never, {
    metadata: { idempotencyKey: 'connector-auth-native-write-identity-1234' },
    signal: controller.signal,
  });
  try {
    while (!capturedInput) await Promise.resolve();
    assert.equal(capturedInput.signal, controller.signal);
    assert.equal(capturedInput.requestId, 'connector-auth-native-write-identity-1234');
  } finally {
    releaseWrite?.();
    await operation.catch(() => undefined);
  }
});

test('Desktop native host runs ChatGPT plan sign-in while tokens stay in Runtime custody', async () => {
  const double = await signInDouble();
  const runtimeRequests: Array<Record<string, unknown>> = [];
  const events: Array<{ eventName: string; payload: unknown }> = [];
  let senderAuthorized = true;
  const host = createDesktopElectronConnectorAuthAcquisitionHost({
    proxyHttp: double.proxyHttp as never,
    runtime: {
      async listConnectors() {
        return { connectors: [{ connectorId: 'connector-1', provider: 'openai_chatgpt_plan', providerAuthProfile: 'openai_chatgpt_plan', oauthRegistration: { issuedClientId: ISSUED_CLIENT, accountLabel: 'user@example.com' } }], nextPageToken: '' } as never;
      },
      async createConnector() {
        throw new Error('reauthorization must update the selected Connector');
      },
      async updateConnector(request) {
        runtimeRequests.push(request as unknown as Record<string, unknown>);
        return { connector: { connectorId: request.connectorId } } as never;
      },
    },
    openExternalUrl: double.openExternalUrl,
    startAuthorizationCallback: double.startAuthorizationCallback,
    hostIdentifier: double.hostIdentifier,
    crypto: double.crypto,
    now: double.now,
    authorizeSender: () => senderAuthorized,
  });
  const requestId = 'connector-auth-native-owner-1234';
  const result = await host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: { payload: { requestId, profileId: 'openai_chatgpt_plan', connectorId: 'connector-1' } },
    sendEvent: (eventName: string, payload: unknown) => events.push({ eventName, payload }),
  } as never);

  assert.deepEqual(result, { profileId: 'openai_chatgpt_plan', providerAuthProfile: 'openai_chatgpt_plan', connectorId: 'connector-1', accountLabel: 'user@example.com' });
  assert.equal(events[0]?.eventName, desktopManagedConnectorAuthPendingEvent(requestId));
  assert.deepEqual(Object.keys(events[0]?.payload as object).sort(), ['authorizationUrl', 'expiresInSeconds']);
  assert.equal(JSON.stringify(events).includes('desktop-refresh-token'), false);
  assert.equal(double.opened.length, 1);
  assert.ok(double.opened[0]!.startsWith('https://auth.openai.com/api/accounts/authorize?'));
  assert.deepEqual(double.httpPurposes, ['authorization_code_exchange', 'jwks']);
  const credential = JSON.parse(String(runtimeRequests[0]?.credentialJson || '{}')) as Record<string, unknown>;
  assert.equal(credential.refresh_token, 'desktop-refresh-token');
  assert.equal(credential.client_id, ISSUED_CLIENT);

  for (const [payload, reasonCode] of [
    [{ requestId: 'connector-auth-native-owner-5678', profileId: 'openai_chatgpt_plan', accessToken: 'renderer-injected-secret' }, 'desktop-managed-connector-payload-invalid'],
    [{ requestId: 'connector-auth-native-owner-9012', profileId: 'openai_chatgpt_plan', endpoint: 'https://chatgpt.com/backend-api/codex' }, 'desktop-managed-connector-payload-invalid'],
  ] as const) {
    await assert.rejects(
      async () => host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({ payload: { payload }, sendEvent: () => undefined } as never),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === reasonCode,
    );
  }
  senderAuthorized = false;
  await assert.rejects(
    async () => host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
      payload: { payload: { requestId: 'connector-auth-native-owner-3456', profileId: 'openai_chatgpt_plan' } },
      sendEvent: () => undefined,
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'desktop-managed-connector-sender-forbidden',
  );
  assert.equal(double.opened.length, 1);
});

test('Desktop native host maps denied ChatGPT sign-in to a stable typed outcome', async () => {
  const double = await signInDouble({ callback: (url) => ({ error: 'access_denied', state: url.searchParams.get('state')! }) });
  const host = createDesktopElectronConnectorAuthAcquisitionHost({
    proxyHttp: double.proxyHttp as never,
    runtime: {
      async listConnectors() { throw new Error('initial sign-in has no Connector'); },
      async createConnector() { throw new Error('denied sign-in must not write'); },
      async updateConnector() { throw new Error('denied sign-in must not write'); },
    },
    openExternalUrl: double.openExternalUrl,
    startAuthorizationCallback: double.startAuthorizationCallback,
    hostIdentifier: double.hostIdentifier,
    crypto: double.crypto,
    now: double.now,
    authorizeSender: () => true,
  });
  await assert.rejects(
    async () => host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
      payload: { payload: { requestId: 'connector-auth-native-denied-1234', profileId: 'openai_chatgpt_plan' } },
      sendEvent: () => undefined,
    } as never),
    (error: unknown) => {
      const record = error as { reasonCode?: string; actionHint?: string; message?: string };
      assert.equal(record.reasonCode, 'desktop-chatgpt-plan-authorization-denied');
      assert.equal(record.actionHint, 'retry_chatgpt_plan_sign_in');
      return true;
    },
  );
  assert.deepEqual(double.httpPurposes, []);
});

test('Desktop native host cancellation and shutdown abort and await active sign-ins', async () => {
  let runtimeWrites = 0;
  const first = await signInDouble({ holdCallback: true });
  const writes = {
    async listConnectors() { throw new Error('initial sign-in has no Connector'); },
    async createConnector() {
      runtimeWrites += 1;
      throw new Error('Runtime write must not run');
    },
    async updateConnector() {
      runtimeWrites += 1;
      throw new Error('Runtime write must not run');
    },
  };
  const host = createDesktopElectronConnectorAuthAcquisitionHost({
    proxyHttp: first.proxyHttp as never,
    runtime: writes as never,
    openExternalUrl: first.openExternalUrl,
    startAuthorizationCallback: first.startAuthorizationCallback,
    hostIdentifier: first.hostIdentifier,
    crypto: first.crypto,
    now: first.now,
    authorizeSender: () => true,
  });
  const firstRequestId = 'connector-auth-native-cancel-1234';
  const firstAcquisition = Promise.resolve(host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: { payload: { requestId: firstRequestId, profileId: 'openai_chatgpt_plan' } },
    sendEvent: () => undefined,
  } as never));
  await first.listening;
  while (first.opened.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  const cancelResult = await host.commandHandlers[DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: { payload: { requestId: firstRequestId } },
  } as never);
  assert.deepEqual(cancelResult, { canceled: true });
  await assert.rejects(firstAcquisition, (error: unknown) => (error as { name?: string }).name === 'AbortError');

  const secondOpened = first.opened.length;
  const secondAcquisition = Promise.resolve(host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: { payload: { requestId: 'connector-auth-native-shutdown-5678', profileId: 'openai_chatgpt_plan' } },
    sendEvent: () => undefined,
  } as never));
  while (first.opened.length === secondOpened) await new Promise((resolve) => setTimeout(resolve, 1));
  await host.shutdown();
  await assert.rejects(secondAcquisition, (error: unknown) => (error as { name?: string }).name === 'AbortError');
  assert.equal(runtimeWrites, 0);
  await assert.rejects(
    async () => host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
      payload: { payload: { requestId: 'connector-auth-native-closed-9012', profileId: 'openai_chatgpt_plan' } },
      sendEvent: () => undefined,
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'desktop-managed-connector-host-closed',
  );
});

test('Desktop native host rejects cancellation after dispatch and waits for the exact Runtime custody result', async () => {
  const double = await signInDouble();
  let markWriteStarted: (() => void) | undefined;
  const writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve;
  });
  let releaseWrite: (() => void) | undefined;
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  let runtimeSignal: AbortSignal | undefined;
  let runtimeRequestId = '';
  let runtimeTimeoutMs: number | undefined;
  const runtime = createDesktopManagedConnectorCredentialRuntime({
    async accountProductUnary(input: { readonly signal?: AbortSignal; readonly requestId?: string; readonly timeoutMs?: number }) {
      runtimeSignal = input.signal;
      runtimeRequestId = input.requestId || '';
      runtimeTimeoutMs = input.timeoutMs;
      markWriteStarted?.();
      await writeGate;
      throw new Error('exact Runtime custody failure');
    },
  } as never);
  const host = createDesktopElectronConnectorAuthAcquisitionHost({
    proxyHttp: double.proxyHttp as never,
    runtime,
    openExternalUrl: double.openExternalUrl,
    startAuthorizationCallback: double.startAuthorizationCallback,
    hostIdentifier: double.hostIdentifier,
    crypto: double.crypto,
    now: double.now,
    authorizeSender: () => true,
  });
  const acquisition = Promise.resolve(host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: { payload: { requestId: 'connector-auth-native-write-1234', profileId: 'openai_chatgpt_plan' } },
    sendEvent: () => undefined,
  } as never));
  const acquisitionRejected = assert.rejects(acquisition, /exact Runtime custody failure/);
  await writeStarted;
  const cancelResult = await host.commandHandlers[DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: { payload: { requestId: 'connector-auth-native-write-1234' } },
  } as never);
  assert.deepEqual(cancelResult, { canceled: false });
  let shutdownSettled = false;
  const shutdown = host.shutdown().then(() => {
    shutdownSettled = true;
  });
  await Promise.resolve();
  assert.equal(runtimeSignal, undefined);
  assert.equal(runtimeRequestId, 'connector-auth-native-write-1234');
  assert.equal(runtimeTimeoutMs, 300_000);
  assert.equal(shutdownSettled, false);
  releaseWrite?.();
  await shutdown;
  await acquisitionRejected;
  assert.equal(shutdownSettled, true);
});
