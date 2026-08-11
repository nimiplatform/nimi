import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConnectorAuthKind,
  ConnectorKind,
  ConnectorOwnerType,
  ConnectorStatus,
} from '../core-generated/runtime-typed-client';
import {
  acquireNimiManagedConnectorCredential,
  type NimiManagedConnectorCredentialAcquisitionHost,
} from './index';
import {
  acquireNimiManagedConnectorCredentialInHost,
  type NimiConnectorAuthAcquisitionNativeHost,
} from './host';

test('native host acquisition seals provider tokens into Runtime custody', async () => {
  const requests: string[] = [];
  const runtimeRequests: unknown[] = [];
  const pendingStates: unknown[] = [];
  let now = Date.parse('2026-06-05T00:00:00.000Z');
  const accessToken = 'managed-access-token';
  const host: NimiConnectorAuthAcquisitionNativeHost = {
    async proxyHttp(request) {
      requests.push(`${request.purpose}:${request.url}`);
      if (request.purpose === 'device_authorization') {
        return {
          status: 200,
          ok: true,
          body: JSON.stringify({
            user_code: 'USER-CODE',
            device_auth_id: 'device-auth-1',
            interval: 1,
            expires_in: 60,
            verification_uri_complete: 'https://auth.openai.com/device',
          }),
        };
      }
      return {
        status: 200,
        ok: true,
        body: JSON.stringify({
          authorization_code: 'auth-code',
          code_verifier: 'verifier',
        }),
      };
    },
    async openExternalUrl(url) {
      assert.equal(url, 'https://auth.openai.com/device');
      return { opened: true };
    },
    async oauthTokenExchange(input) {
      assert.equal(input.provider, 'CODEX');
      assert.equal(input.code, 'auth-code');
      assert.equal(input.codeVerifier, 'verifier');
      return {
        accessToken,
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'openid',
      };
    },
    async sleep(ms) {
      now += ms;
    },
    now: () => now,
  };

  const result = await acquireNimiManagedConnectorCredentialInHost({
    profileId: 'openai_codex',
    host,
    runtime: {
      async createConnector(request) {
        runtimeRequests.push(request);
        return {
          connector: {
            connectorId: 'conn-1',
            kind: ConnectorKind.REMOTE_MANAGED,
            ownerType: ConnectorOwnerType.USER,
            ownerId: 'user-1',
            provider: request.provider,
            endpoint: request.endpoint,
            label: request.label,
            status: ConnectorStatus.ACTIVE,
            localCategory: 0,
            hasCredential: true,
            authKind: request.authKind,
            providerAuthProfile: request.providerAuthProfile,
          },
        };
      },
      async updateConnector() {
        throw new Error('updateConnector should not be called for a new acquisition');
      },
    },
    onPending: (state) => pendingStates.push(state),
  });

  assert.deepEqual(Object.keys(result).sort(), [
    'connectorId',
    'expiresAt',
    'profileId',
    'providerAuthProfile',
  ]);
  assert.equal(result.profileId, 'openai_codex');
  assert.equal(result.providerAuthProfile, 'openai_codex');
  assert.equal(result.connectorId, 'conn-1');
  assert.deepEqual(Object.keys(pendingStates[0] as object).sort(), [
    'expiresInSeconds',
    'pollIntervalSeconds',
    'userCode',
    'verificationUrl',
  ]);
  assert.equal((pendingStates[0] as { pollIntervalSeconds?: number }).pollIntervalSeconds, 3);
  assert.deepEqual(requests.map((item) => item.split(':')[0]), ['device_authorization', 'device_token']);
  assert.equal((runtimeRequests[0] as { authKind?: unknown }).authKind, ConnectorAuthKind.OAUTH_MANAGED);
  assert.equal((runtimeRequests[0] as { providerAuthProfile?: unknown }).providerAuthProfile, 'openai_codex');
  const credential = JSON.parse((runtimeRequests[0] as { credentialJson?: string }).credentialJson ?? '{}') as Record<string, unknown>;
  assert.equal(credential.access_token, accessToken);
  assert.equal(credential.refresh_token, 'refresh-token');
  assert.equal(JSON.stringify(result).includes(accessToken), false);
  assert.equal(JSON.stringify(pendingStates).includes(accessToken), false);
});

test('renderer SDK facade forwards only acquisition input and rejects secret-bearing host projections', async () => {
  const forwarded: unknown[] = [];
  const pendingStates: unknown[] = [];
  const host: NimiManagedConnectorCredentialAcquisitionHost = {
    async acquireManagedConnectorCredential(input) {
      forwarded.push(input);
      input.onPending?.({
        userCode: 'USER-CODE',
        verificationUrl: 'https://auth.openai.com/device',
        expiresInSeconds: 60,
        pollIntervalSeconds: 3,
      });
      return {
        profileId: 'openai_codex',
        providerAuthProfile: 'openai_codex',
        connectorId: 'conn-1',
        expiresAt: '2026-06-05T01:00:00.000Z',
      };
    },
  };

  const result = await acquireNimiManagedConnectorCredential({
    profileId: 'openai_codex',
    connectorId: 'conn-1',
    provider: 'openai_codex',
    endpoint: 'https://chatgpt.com/backend-api/codex',
    label: 'Codex',
    onPending: (state) => pendingStates.push(state),
    host,
  });

  assert.deepEqual(Object.keys(forwarded[0] as object).sort(), [
    'connectorId',
    'endpoint',
    'label',
    'onPending',
    'profileId',
    'provider',
  ]);
  assert.deepEqual(result, {
    profileId: 'openai_codex',
    providerAuthProfile: 'openai_codex',
    connectorId: 'conn-1',
    expiresAt: '2026-06-05T01:00:00.000Z',
  });
  assert.deepEqual(pendingStates, [{
    userCode: 'USER-CODE',
    verificationUrl: 'https://auth.openai.com/device',
    expiresInSeconds: 60,
    pollIntervalSeconds: 3,
  }]);

  await assert.rejects(
    () => acquireNimiManagedConnectorCredential({
      profileId: 'openai_codex',
      host,
      credentialJson: '{"access_token":"must-not-cross"}',
    } as never),
    /unexpected field credentialJson/,
  );
  assert.equal(forwarded.length, 1);

  await assert.rejects(
    () => acquireNimiManagedConnectorCredential({
      profileId: 'openai_codex',
      host: {
        async acquireManagedConnectorCredential() {
          return {
            profileId: 'openai_codex',
            providerAuthProfile: 'openai_codex',
            accessToken: 'must-not-project',
          } as never;
        },
      },
    }),
    /unexpected field accessToken/,
  );
});

test('native host acquisition rejects malformed and timer-unrepresentable provider polling values', async () => {
  for (const timing of [
    { interval: Number.MAX_SAFE_INTEGER, expires_in: 60, error: /interval exceeds the runtime timer capacity/ },
    { interval: 3, expires_in: Number.MAX_SAFE_INTEGER, error: /expires_in exceeds the runtime timer capacity/ },
    { interval: '3seconds', expires_in: 60, error: /interval must be a positive integer/ },
    { interval: null, expires_in: 60, error: /interval must be a positive integer/ },
    { interval: '', expires_in: 60, error: /interval must be a positive integer/ },
    { interval: 3, expires_in: null, error: /expires_in must be a positive integer/ },
    { interval: 3, expires_in: '', error: /expires_in must be a positive integer/ },
  ]) {
    let opened = false;
    let runtimeWrites = 0;
    const host: NimiConnectorAuthAcquisitionNativeHost = {
      async proxyHttp() {
        return {
          status: 200,
          ok: true,
          body: JSON.stringify({
            user_code: 'USER-CODE',
            device_auth_id: 'device-auth-1',
            ...timing,
          }),
        };
      },
      async openExternalUrl() {
        opened = true;
        return { opened: true };
      },
      async oauthTokenExchange() {
        throw new Error('token exchange must not run');
      },
      async sleep() {
        throw new Error('sleep must not run');
      },
      now: Date.now,
    };
    await assert.rejects(
      () => acquireNimiManagedConnectorCredentialInHost({
        profileId: 'openai_codex',
        host,
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
      }),
      timing.error,
    );
    assert.equal(opened, false);
    assert.equal(runtimeWrites, 0);
  }
});

test('native host acquisition errors never project raw provider response text', async () => {
  const secret = 'provider-secret-response-fragment';
  const cases = [
    {
      name: 'malformed device authorization',
      respond(request: { purpose: string }) {
        return request.purpose === 'device_authorization'
          ? { status: 200, ok: true, body: secret }
          : { status: 500, ok: false, body: '' };
      },
    },
    {
      name: 'malformed successful poll',
      respond(request: { purpose: string }) {
        return request.purpose === 'device_authorization'
          ? {
              status: 200,
              ok: true,
              body: JSON.stringify({ user_code: 'USER-CODE', device_auth_id: 'device-auth-1', interval: 3, expires_in: 9 }),
            }
          : { status: 200, ok: true, body: secret };
      },
    },
    {
      name: 'pending poll description',
      respond(request: { purpose: string }) {
        return request.purpose === 'device_authorization'
          ? {
              status: 200,
              ok: true,
              body: JSON.stringify({ user_code: 'USER-CODE', device_auth_id: 'device-auth-1', interval: 3, expires_in: 6 }),
            }
          : { status: 403, ok: false, body: JSON.stringify({ error_description: secret }) };
      },
    },
  ];

  for (const testCase of cases) {
    let now = Date.parse('2026-08-11T00:00:00.000Z');
    let captured: unknown;
    try {
      await acquireNimiManagedConnectorCredentialInHost({
        profileId: 'openai_codex',
        host: {
          async proxyHttp(request) {
            return testCase.respond(request);
          },
          async openExternalUrl() {
            return { opened: true };
          },
          async oauthTokenExchange() {
            throw new Error('token exchange must not run');
          },
          async sleep(milliseconds) {
            now += milliseconds;
          },
          now: () => now,
        },
        runtime: {
          async createConnector() {
            throw new Error('Runtime write must not run');
          },
          async updateConnector() {
            throw new Error('Runtime write must not run');
          },
        },
      });
    } catch (error) {
      captured = error;
    }
    assert.ok(captured instanceof Error, `${testCase.name}: expected failure`);
    assert.equal(captured.message.includes(secret), false, `${testCase.name}: raw response escaped through error`);
  }
});

test('native host acquisition rejects provider polling values above profile maxima before side effects', async () => {
  for (const timing of [
    { interval: 31, expires_in: 900, error: /interval must not exceed 30/ },
    { interval: 30, expires_in: 901, error: /expires_in must not exceed 900/ },
  ]) {
    let browserOpens = 0;
    let polls = 0;
    let tokenExchanges = 0;
    let runtimeWrites = 0;
    await assert.rejects(
      () => acquireNimiManagedConnectorCredentialInHost({
        profileId: 'openai_codex',
        host: {
          async proxyHttp(request) {
            if (request.purpose === 'device_token') polls += 1;
            return {
              status: 200,
              ok: true,
              body: JSON.stringify({
                user_code: 'USER-CODE',
                device_auth_id: 'device-auth-1',
                ...timing,
              }),
            };
          },
          async openExternalUrl() {
            browserOpens += 1;
            return { opened: true };
          },
          async oauthTokenExchange() {
            tokenExchanges += 1;
            return { accessToken: 'must-remain-sealed' };
          },
          async sleep() {
            throw new Error('sleep must not run');
          },
          now: Date.now,
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
      }),
      timing.error,
    );
    assert.equal(browserOpens, 0);
    assert.equal(polls, 0);
    assert.equal(tokenExchanges, 0);
    assert.equal(runtimeWrites, 0);
  }
});

test('native host acquisition accepts inclusive profile timing maxima', async () => {
  let now = Date.parse('2026-08-11T00:00:00.000Z');
  let pendingState: { pollIntervalSeconds: number; expiresInSeconds: number } | undefined;
  const result = await acquireNimiManagedConnectorCredentialInHost({
    profileId: 'openai_codex',
    host: {
      async proxyHttp(request) {
        return request.purpose === 'device_authorization'
          ? {
              status: 200,
              ok: true,
              body: JSON.stringify({
                user_code: 'USER-CODE',
                device_auth_id: 'device-auth-1',
                interval: 30,
                expires_in: 900,
              }),
            }
          : {
              status: 200,
              ok: true,
              body: JSON.stringify({ authorization_code: 'code', code_verifier: 'verifier' }),
            };
      },
      async openExternalUrl() {
        return { opened: true };
      },
      async oauthTokenExchange() {
        return { accessToken: 'sealed-token' };
      },
      async sleep(milliseconds) {
        now += milliseconds;
      },
      now: () => now,
    },
    runtime: {
      async createConnector() {
        return { connector: { connectorId: 'connector-1' } } as never;
      },
      async updateConnector() {
        throw new Error('updateConnector must not run');
      },
    },
    onPending(state) {
      pendingState = state;
    },
  });

  assert.equal(result.connectorId, 'connector-1');
  assert.deepEqual(pendingState, {
    userCode: 'USER-CODE',
    verificationUrl: 'https://auth.openai.com/codex/device',
    pollIntervalSeconds: 30,
    expiresInSeconds: 900,
  });
});

test('native host acquisition fails closed when token expiry metadata exceeds date capacity', async () => {
  let now = Date.parse('2026-08-11T00:00:00.000Z');
  let runtimeWrites = 0;
  await assert.rejects(
    () => acquireNimiManagedConnectorCredentialInHost({
      profileId: 'openai_codex',
      host: {
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
        async openExternalUrl() {
          return { opened: true };
        },
        async oauthTokenExchange() {
          return { accessToken: 'sealed-token', expiresIn: Number.MAX_SAFE_INTEGER };
        },
        async sleep(milliseconds) {
          now += milliseconds;
        },
        now: () => now,
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
    }),
    /token exchange expires_in exceeds the runtime date capacity/,
  );
  assert.equal(runtimeWrites, 0);
});

test('native host acquisition cancellation interrupts polling and prevents token custody writes', async () => {
  const controller = new AbortController();
  let markSleepStarted: (() => void) | undefined;
  const sleepStarted = new Promise<void>((resolve) => {
    markSleepStarted = resolve;
  });
  let tokenExchanges = 0;
  let runtimeWrites = 0;
  const host: NimiConnectorAuthAcquisitionNativeHost = {
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
    async openExternalUrl() {
      return { opened: true };
    },
    async oauthTokenExchange() {
      tokenExchanges += 1;
      throw new Error('token exchange must not run');
    },
    sleep(_milliseconds, signal) {
      markSleepStarted?.();
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    now: Date.now,
  };
  const acquisition = acquireNimiManagedConnectorCredentialInHost({
    profileId: 'openai_codex',
    host,
    signal: controller.signal,
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
  });
  await sleepStarted;
  controller.abort(new DOMException('test cancellation', 'AbortError'));
  await assert.rejects(acquisition, (error: unknown) => (error as { name?: string }).name === 'AbortError');
  assert.equal(tokenExchanges, 0);
  assert.equal(runtimeWrites, 0);
});

test('native host acquisition rechecks cancellation before the final Runtime custody write', async () => {
  const controller = new AbortController();
  let now = Date.parse('2026-08-11T00:00:00.000Z');
  let runtimeWrites = 0;
  await assert.rejects(
    () => acquireNimiManagedConnectorCredentialInHost({
      profileId: 'openai_codex',
      signal: controller.signal,
      host: {
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
        async openExternalUrl() {
          return { opened: true };
        },
        async oauthTokenExchange() {
          controller.abort(new DOMException('canceled before commit', 'AbortError'));
          return { accessToken: 'must-remain-sealed' };
        },
        async sleep(milliseconds) {
          now += milliseconds;
        },
        now: () => now,
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
    }),
    (error: unknown) => (error as { name?: string }).name === 'AbortError',
  );
  assert.equal(runtimeWrites, 0);
});

test('final Runtime custody dispatch detaches acquisition cancellation and waits for the exact result', async () => {
  const controller = new AbortController();
  let now = Date.parse('2026-08-11T00:00:00.000Z');
  let markWriteStarted: (() => void) | undefined;
  const writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve;
  });
  let finishWrite: (() => void) | undefined;
  const writeFinished = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  let runtimeSignal: AbortSignal | undefined;
  let acquisitionSettled = false;
  const acquisition = acquireNimiManagedConnectorCredentialInHost({
    profileId: 'openai_codex',
    signal: controller.signal,
    host: {
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
      async openExternalUrl() {
        return { opened: true };
      },
      async oauthTokenExchange() {
        return { accessToken: 'sealed-token' };
      },
      async sleep(milliseconds) {
        now += milliseconds;
      },
      now: () => now,
    },
    runtime: {
      async createConnector(_request, callOptions) {
        runtimeSignal = callOptions?.signal;
        markWriteStarted?.();
        await writeFinished;
        return { connector: { connectorId: 'connector-committed' } } as never;
      },
      async updateConnector() {
        throw new Error('updateConnector must not run');
      },
    },
    callOptions: {
      timeoutMs: 300_000,
      metadata: { idempotencyKey: 'connector-auth-final-write-1234' },
    },
  });
  void acquisition.finally(() => {
    acquisitionSettled = true;
  });

  await writeStarted;
  controller.abort(new DOMException('cancel arrived after commit', 'AbortError'));
  await Promise.resolve();
  assert.equal(runtimeSignal, undefined);
  assert.equal(acquisitionSettled, false);
  finishWrite?.();
  const result = await acquisition;

  assert.equal(result.connectorId, 'connector-committed');
  assert.equal(controller.signal.aborted, true);
});

test('renderer SDK facade carries only the AbortSignal cancellation capability to its host', async () => {
  const controller = new AbortController();
  const host: NimiManagedConnectorCredentialAcquisitionHost = {
    async acquireManagedConnectorCredential(input) {
      assert.equal(input.signal, controller.signal);
      return {
        profileId: 'openai_codex',
        providerAuthProfile: 'openai_codex',
        connectorId: 'connector-1',
      };
    },
  };
  await acquireNimiManagedConnectorCredential({
    profileId: 'openai_codex',
    signal: controller.signal,
    host,
  });
});
