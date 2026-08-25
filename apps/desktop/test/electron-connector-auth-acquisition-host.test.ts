import assert from 'node:assert/strict';
import test from 'node:test';

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

test('Desktop credential Runtime carries explicit request identity and signal into the protected unary', async () => {
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
  const operation = runtime.createConnector({
    provider: 'openai',
    endpoint: '',
    label: 'OpenAI',
    apiKey: '',
  } as never, {
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

test('Desktop native host keeps managed connector tokens inside Runtime custody', async () => {
  const accessToken = 'native-host-access-token';
  const runtimeRequests: Array<Record<string, unknown>> = [];
  const events: Array<{ eventName: string; payload: unknown }> = [];
  const openedUrls: string[] = [];
  let networkCalls = 0;
  let now = Date.parse('2026-08-10T00:00:00.000Z');
  let verificationUrl = 'https://auth.openai.com/device';
  let senderAuthorized = true;
  const host = createDesktopElectronConnectorAuthAcquisitionHost({
    async proxyHttp(request) {
      networkCalls += 1;
      if (request.purpose === 'device_authorization') {
        return {
          status: 200,
          ok: true,
          body: JSON.stringify({
            user_code: 'USER-CODE',
            device_auth_id: 'device-auth-1',
            interval: 1,
            expires_in: 60,
            verification_uri_complete: verificationUrl,
          }),
        };
      }
      return {
        status: 200,
        ok: true,
        body: JSON.stringify({
          authorization_code: 'authorization-code',
          code_verifier: 'code-verifier',
        }),
      };
    },
    runtime: {
      async createConnector(request) {
        throw new Error(`createConnector should not run for ${String(request.provider || '')}`);
      },
      async updateConnector(request) {
        runtimeRequests.push(request as unknown as Record<string, unknown>);
        return { connector: { connectorId: request.connectorId } } as never;
      },
    },
    async openExternalUrl(url) {
      openedUrls.push(url);
    },
    async oauthTokenExchange() {
      return {
        accessToken,
        refreshToken: 'native-host-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'openid',
      };
    },
    async sleep(milliseconds) {
      now += milliseconds;
    },
    now: () => now,
    authorizeSender: () => senderAuthorized,
  });
  const requestId = 'connector-auth-native-owner-1234';
  const result = await host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: {
      payload: {
        requestId,
        profileId: 'openai_codex',
        connectorId: 'connector-1',
        provider: 'openai_codex',
        endpoint: 'https://chatgpt.com/backend-api/codex',
        label: 'Codex',
      },
    },
    sendEvent: (eventName: string, payload: unknown) => events.push({ eventName, payload }),
  } as never);

  assert.deepEqual(Object.keys(result as object).sort(), [
    'connectorId',
    'expiresAt',
    'profileId',
    'providerAuthProfile',
  ]);
  assert.equal(JSON.stringify(result).includes(accessToken), false);
  assert.equal(events[0]?.eventName, desktopManagedConnectorAuthPendingEvent(requestId));
  assert.deepEqual(Object.keys(events[0]?.payload as object).sort(), [
    'expiresInSeconds',
    'pollIntervalSeconds',
    'userCode',
    'verificationUrl',
  ]);
  assert.equal(JSON.stringify(events).includes(accessToken), false);
  const credential = JSON.parse(String(runtimeRequests[0]?.credentialJson || '{}')) as Record<string, unknown>;
  assert.equal(credential.access_token, accessToken);
  assert.equal(credential.refresh_token, 'native-host-refresh-token');
  assert.equal(networkCalls, 2);
  assert.deepEqual(openedUrls, ['https://auth.openai.com/device']);

  await assert.rejects(
    async () => host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
      payload: {
        payload: {
          requestId: 'connector-auth-native-owner-5678',
          profileId: 'openai_codex',
          accessToken: 'renderer-injected-secret',
        },
      },
      sendEvent: () => undefined,
    } as never),
    (error: unknown) => {
      assert.equal(
        (error as { reasonCode?: string }).reasonCode,
        'desktop-managed-connector-payload-invalid',
      );
      return true;
    },
  );
  assert.equal(networkCalls, 2);

  verificationUrl = 'file:///C:/secret.txt';
  await assert.rejects(
    async () => host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
      payload: {
        payload: {
          requestId: 'connector-auth-native-owner-9012',
          profileId: 'openai_codex',
          connectorId: 'connector-1',
        },
      },
      sendEvent: () => undefined,
    } as never),
    (error: unknown) => {
      assert.equal(
        (error as { reasonCode?: string }).reasonCode,
        'desktop-managed-connector-verification-url-invalid',
      );
      return true;
    },
  );
  assert.equal(networkCalls, 3);
  assert.equal(events.length, 1);
  assert.equal(openedUrls.length, 1);

  senderAuthorized = false;
  await assert.rejects(
    async () => host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
      payload: {
        payload: {
          requestId: 'connector-auth-native-owner-3456',
          profileId: 'openai_codex',
        },
      },
      sendEvent: () => undefined,
    } as never),
    (error: unknown) => {
      assert.equal(
        (error as { reasonCode?: string }).reasonCode,
        'desktop-managed-connector-sender-forbidden',
      );
      return true;
    },
  );
  assert.equal(networkCalls, 3);
});

test('Desktop native host cancellation and shutdown abort and await active managed connector acquisitions', async () => {
  let runtimeWrites = 0;
  let sleepSequence = 0;
  const sleepStarted = new Map<number, () => void>();
  const waitForSleep = (sequence: number) => new Promise<void>((resolve) => {
    sleepStarted.set(sequence, resolve);
  });
  const host = createDesktopElectronConnectorAuthAcquisitionHost({
    async proxyHttp(request) {
      assert.equal(request.purpose, 'device_authorization');
      return {
        status: 200,
        ok: true,
        body: JSON.stringify({
          user_code: 'USER-CODE',
          device_auth_id: 'device-auth-1',
          interval: 3,
          expires_in: 60,
        }),
      };
    },
    runtime: {
      async createConnector() {
        runtimeWrites += 1;
        throw new Error('Runtime write must not run');
      },
      async updateConnector() {
        runtimeWrites += 1;
        throw new Error('Runtime write must not run');
      },
    },
    async openExternalUrl() {},
    async oauthTokenExchange() {
      throw new Error('token exchange must not run');
    },
    sleep(_milliseconds, signal) {
      sleepSequence += 1;
      sleepStarted.get(sleepSequence)?.();
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    authorizeSender: () => true,
  });

  const firstSleep = waitForSleep(1);
  const firstRequestId = 'connector-auth-native-cancel-1234';
  const firstAcquisition = Promise.resolve(host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: { payload: { requestId: firstRequestId, profileId: 'openai_codex' } },
    sendEvent: () => undefined,
  } as never));
  await firstSleep;
  const cancelResult = await host.commandHandlers[DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: { payload: { requestId: firstRequestId } },
  } as never);
  assert.deepEqual(cancelResult, { canceled: true });
  await assert.rejects(firstAcquisition, (error: unknown) => (error as { name?: string }).name === 'AbortError');

  const secondSleep = waitForSleep(2);
  const secondAcquisition = Promise.resolve(host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: {
      payload: {
        requestId: 'connector-auth-native-shutdown-5678',
        profileId: 'openai_codex',
      },
    },
    sendEvent: () => undefined,
  } as never));
  await secondSleep;
  await host.shutdown();
  await assert.rejects(secondAcquisition, (error: unknown) => (error as { name?: string }).name === 'AbortError');
  assert.equal(runtimeWrites, 0);

  await assert.rejects(
    async () => host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
      payload: {
        payload: {
          requestId: 'connector-auth-native-closed-9012',
          profileId: 'openai_codex',
        },
      },
      sendEvent: () => undefined,
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'desktop-managed-connector-host-closed',
  );
});

test('Desktop native host rejects cancellation after dispatch and waits for the exact Runtime custody result', async () => {
  let now = Date.parse('2026-08-11T00:00:00.000Z');
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
    async accountProductUnary(input: {
      readonly signal?: AbortSignal;
      readonly requestId?: string;
      readonly timeoutMs?: number;
    }) {
      runtimeSignal = input.signal;
      runtimeRequestId = input.requestId || '';
      runtimeTimeoutMs = input.timeoutMs;
      markWriteStarted?.();
      await writeGate;
      throw new Error('exact Runtime custody failure');
    },
  } as never);
  const host = createDesktopElectronConnectorAuthAcquisitionHost({
    async proxyHttp(request) {
      return request.purpose === 'device_authorization'
        ? {
            status: 200,
            ok: true,
            body: JSON.stringify({
              user_code: 'USER-CODE',
              device_auth_id: 'device-auth-1',
              interval: 3,
              expires_in: 60,
            }),
          }
        : {
            status: 200,
            ok: true,
            body: JSON.stringify({ authorization_code: 'code', code_verifier: 'verifier' }),
          };
    },
    runtime,
    async openExternalUrl() {},
    async oauthTokenExchange() {
      return { accessToken: 'sealed-token' };
    },
    async sleep(milliseconds) {
      now += milliseconds;
    },
    now: () => now,
    authorizeSender: () => true,
  });

  const acquisition = Promise.resolve(host.commandHandlers[DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]({
    payload: {
      payload: {
        requestId: 'connector-auth-native-write-1234',
        profileId: 'openai_codex',
      },
    },
    sendEvent: () => undefined,
  } as never));
  const acquisitionRejected = assert.rejects(
    acquisition,
    /exact Runtime custody failure/,
  );
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
