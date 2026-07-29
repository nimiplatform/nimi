import assert from 'node:assert/strict';
import test from 'node:test';

import { CONNECTOR_AUTH_ACQUISITION_PROFILES } from '@nimiplatform/sdk/runtime';
import {
  createDesktopElectronHttpHost,
  type DesktopElectronHttpHost,
} from '../src-electron/http-request-host.js';

type SentRequest = {
  readonly input: string | URL;
  readonly init: RequestInit | undefined;
};

function invoke(
  host: DesktopElectronHttpHost,
  request: Readonly<Record<string, unknown>>,
) {
  return host.commandHandlers.http_request({
    payload: { payload: request },
  });
}

async function expectReason(
  promise: Promise<unknown>,
  reasonCode: string,
): Promise<Readonly<Record<string, unknown>>> {
  let record: Readonly<Record<string, unknown>> | undefined;
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error && typeof error === 'object');
    record = error as Readonly<Record<string, unknown>>;
    assert.equal(record.reasonCode, reasonCode);
    return true;
  });
  assert.ok(record);
  return record;
}

test('Electron HTTP host returns the complete response through a fixed main-process request', async () => {
  const sent: SentRequest[] = [];
  const host = createDesktopElectronHttpHost({
    realmBaseUrl: 'https://realm.nimi.ai',
    fetch: async (input, init) => {
      sent.push({ input, init });
      return new Response('realm-body', {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'session=must-not-reach-renderer',
          'Set-Cookie2': 'legacy=must-not-reach-renderer',
          'X-Realm-Revision': '17',
        },
      });
    },
  });

  const result = await invoke(host, {
    url: 'https://realm.nimi.ai/api/worlds?limit=2',
    method: 'post',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: '{"name":"Nimi"}',
    diagnosticSessionId: 'renderer-session-1234',
  });

  assert.deepEqual(result, {
    status: 201,
    ok: true,
    headers: {
      'content-type': 'application/json',
      'x-realm-revision': '17',
    },
    body: 'realm-body',
  });
  assert.equal(sent.length, 1);
  assert.equal(String(sent[0]?.input), 'https://realm.nimi.ai/api/worlds?limit=2');
  assert.equal(sent[0]?.init?.method, 'POST');
  assert.equal(sent[0]?.init?.body, '{"name":"Nimi"}');
  assert.equal(sent[0]?.init?.redirect, 'manual');
  assert.equal(sent[0]?.init?.credentials, 'omit');
  assert.ok(sent[0]?.init?.signal instanceof AbortSignal);
});

test('Electron HTTP host admits only fixed Realm and loopback ordinary origins', async () => {
  const sent: string[] = [];
  const host = createDesktopElectronHttpHost({
    realmBaseUrl: 'http://127.0.0.1:3002',
    fetch: async (input) => {
      sent.push(String(input));
      return new Response('ok');
    },
  });

  await invoke(host, { url: 'http://localhost:3002/api/me' });
  await invoke(host, { url: 'http://127.0.0.1/health' });
  assert.deepEqual(sent, [
    'http://localhost:3002/api/me',
    'http://127.0.0.1/health',
  ]);

  await expectReason(
    invoke(host, { url: 'https://api.third-party.example/v1/data' }),
    'DESKTOP_HTTP_ORIGIN_FORBIDDEN',
  );
  await expectReason(
    invoke(host, { url: 'http://localhost:3003/socket' }),
    'DESKTOP_HTTP_ORIGIN_FORBIDDEN',
  );
  assert.equal(sent.length, 2);
});

test('Electron HTTP host admits only the seven fixed HTTP methods', async () => {
  const sent: RequestInit[] = [];
  const host = createDesktopElectronHttpHost({
    realmBaseUrl: 'https://realm.nimi.ai',
    fetch: async (_input, init) => {
      assert.ok(init);
      sent.push(init);
      return new Response('ok');
    },
  });
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

  for (const method of methods) {
    await invoke(host, {
      url: `https://realm.nimi.ai/api/method/${method.toLowerCase()}`,
      method,
      body: 'request-body',
    });
  }

  assert.deepEqual(sent.map((request) => request.method), methods);
  assert.deepEqual(
    sent.map((request) => request.body),
    [undefined, 'request-body', 'request-body', 'request-body', 'request-body', 'request-body', undefined],
  );
});

test('Electron HTTP host uses the SDK acquisition profile for exact OAuth POST admission', async () => {
  const sent: string[] = [];
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;
  assert.ok(profile);
  const host = createDesktopElectronHttpHost({
    realmBaseUrl: 'https://realm.nimi.ai',
    fetch: async (input) => {
      sent.push(String(input));
      return new Response('{"ok":true}', {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await invoke(host, {
    url: profile.deviceAuthorizationUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"client_id":"fixture"}',
    connectorAuthProfileId: profile.profileId,
    connectorAuthPurpose: 'device_authorization',
  });
  await invoke(host, {
    url: profile.deviceTokenUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"device_auth_id":"fixture"}',
    connectorAuthProfileId: profile.profileId,
    connectorAuthPurpose: 'device_token',
  });
  assert.deepEqual(sent, [
    profile.deviceAuthorizationUrl,
    profile.deviceTokenUrl,
  ]);

  for (const request of [
    {
      url: profile.deviceAuthorizationUrl,
      method: 'GET',
      connectorAuthProfileId: profile.profileId,
      connectorAuthPurpose: 'device_authorization',
    },
    {
      url: profile.deviceAuthorizationUrl,
      method: 'POST',
      connectorAuthProfileId: profile.profileId,
      connectorAuthPurpose: 'device_token',
    },
    {
      url: `${profile.deviceAuthorizationUrl}?redirect=1`,
      method: 'POST',
      connectorAuthProfileId: profile.profileId,
      connectorAuthPurpose: 'device_authorization',
    },
    {
      url: profile.deviceAuthorizationUrl,
      method: 'POST',
      connectorAuthProfileId: 'unknown-profile',
      connectorAuthPurpose: 'device_authorization',
    },
    {
      url: profile.deviceAuthorizationUrl,
      method: 'POST',
    },
  ]) {
    await expectReason(
      invoke(host, request),
      request.connectorAuthProfileId === undefined
        ? 'DESKTOP_HTTP_ORIGIN_FORBIDDEN'
        : 'DESKTOP_HTTP_CONNECTOR_AUTH_NOT_ADMITTED',
    );
  }
  assert.equal(sent.length, 2);
});

test('Electron HTTP host rejects unknown payload fields and sensitive header overrides', async () => {
  let sendCount = 0;
  const host = createDesktopElectronHttpHost({
    realmBaseUrl: 'https://realm.nimi.ai',
    fetch: async () => {
      sendCount += 1;
      return new Response('unexpected');
    },
  });

  await expectReason(
    host.commandHandlers.http_request({
      payload: {
        payload: { url: 'https://realm.nimi.ai/api/me' },
        authorization: 'Bearer secret',
      },
    }),
    'DESKTOP_HTTP_PAYLOAD_INVALID',
  );
  await expectReason(
    invoke(host, {
      url: 'https://realm.nimi.ai/api/me',
      authorization: 'Bearer secret',
    }),
    'DESKTOP_HTTP_PAYLOAD_INVALID',
  );
  await expectReason(
    invoke(host, {
      url: 'ftp://realm.nimi.ai/file',
    }),
    'DESKTOP_HTTP_URL_SCHEME_INVALID',
  );
  await expectReason(
    invoke(host, {
      url: 'https://realm.nimi.ai/api/me',
      method: 'TRACE',
    }),
    'DESKTOP_HTTP_METHOD_INVALID',
  );

  for (const headerName of [
    'Authorization',
    'Cookie',
    'Cookie2',
    'Host',
    'Origin',
    'Proxy-Connection',
    'Referer',
    'Sec-Fetch-Site',
    'Access-Control-Request-Headers',
    'X-Forwarded-For',
  ]) {
    await expectReason(
      invoke(host, {
        url: 'https://realm.nimi.ai/api/me',
        headers: { [headerName]: 'renderer-value' },
      }),
      'DESKTOP_HTTP_HEADER_RESTRICTED',
    );
  }
  assert.equal(sendCount, 0);
});

test('Electron HTTP host applies fixed request-size boundaries before network dispatch', async () => {
  let sendCount = 0;
  const host = createDesktopElectronHttpHost({
    realmBaseUrl: 'https://realm.nimi.ai',
    fetch: async () => {
      sendCount += 1;
      return new Response('unexpected');
    },
  });
  const oversizedRequests: Readonly<Record<string, unknown>>[] = [
    {
      url: `https://realm.nimi.ai/${'u'.repeat(8 * 1024)}`,
    },
    {
      url: 'https://realm.nimi.ai/api/me',
      headers: { [`x-${'n'.repeat(128)}`]: 'value' },
    },
    {
      url: 'https://realm.nimi.ai/api/me',
      headers: { 'x-large-value': 'v'.repeat((8 * 1024) + 1) },
    },
    {
      url: 'https://realm.nimi.ai/api/me',
      headers: {
        'x-total-a': 'a'.repeat(8 * 1024),
        'x-total-b': 'b'.repeat(8 * 1024),
        'x-total-c': 'c'.repeat(8 * 1024),
        'x-total-d': 'd'.repeat(8 * 1024),
      },
    },
    {
      url: 'https://realm.nimi.ai/api/me',
      method: 'POST',
      body: 'b'.repeat((8 * 1024 * 1024) + 1),
    },
  ];

  for (const request of oversizedRequests) {
    const error = await expectReason(
      invoke(host, request),
      'DESKTOP_HTTP_REQUEST_TOO_LARGE',
    );
    assert.equal(error.retryable, false);
  }
  assert.equal(sendCount, 0);
});

test('Electron HTTP host cancels a decompressed response stream above 16 MiB', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array((16 * 1024 * 1024) + 1));
    },
    cancel() {
      canceled = true;
    },
  });
  const host = createDesktopElectronHttpHost({
    realmBaseUrl: 'https://realm.nimi.ai',
    fetch: async () => new Response(body, {
      headers: {
        'Content-Encoding': 'gzip',
        'Set-Cookie': 'session=must-not-reach-renderer',
      },
    }),
  });

  const error = await expectReason(
    invoke(host, { url: 'https://realm.nimi.ai/api/oversized' }),
    'DESKTOP_HTTP_RESPONSE_TOO_LARGE',
  );
  assert.equal(error.retryable, false);
  assert.equal(canceled, true);
});

test('Electron HTTP host enforces a 32-request burst for each origin over five seconds', async () => {
  let now = 10_000;
  let sendCount = 0;
  const host = createDesktopElectronHttpHost({
    realmBaseUrl: 'https://realm.nimi.ai',
    now: () => now,
    fetch: async () => {
      sendCount += 1;
      return new Response('ok');
    },
  });

  for (let index = 0; index < 32; index += 1) {
    await invoke(host, { url: `https://realm.nimi.ai/api/items/${index}` });
  }
  assert.equal(sendCount, 32);
  const limited = await expectReason(
    invoke(host, { url: 'https://realm.nimi.ai/api/items/overflow' }),
    'DESKTOP_HTTP_RATE_LIMITED',
  );
  assert.equal(limited.retryable, true);
  assert.equal(sendCount, 32);

  now = 9_000;
  await invoke(host, { url: 'https://realm.nimi.ai/api/items/after-clock-rollback' });
  assert.equal(sendCount, 33);

  now += 5_001;
  await invoke(host, { url: 'https://realm.nimi.ai/api/items/after-window' });
  assert.equal(sendCount, 34);
});

test('Electron HTTP host classifies Realm and acquisition transport failures', async () => {
  const host = createDesktopElectronHttpHost({
    realmBaseUrl: 'http://127.0.0.1:3002',
    fetch: async () => {
      throw new Error('connection refused');
    },
  });
  const realm = await expectReason(
    invoke(host, { url: 'http://localhost:3002/api/worlds' }),
    'REALM_UNAVAILABLE',
  );
  assert.equal(realm.code, 'runtime-service-unavailable');
  assert.equal(realm.actionHint, 'check_realm_service_status');
  assert.equal(realm.retryable, true);

  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;
  assert.ok(profile);
  const acquisition = await expectReason(
    invoke(host, {
      url: profile.deviceTokenUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      connectorAuthProfileId: profile.profileId,
      connectorAuthPurpose: 'device_token',
    }),
    'DESKTOP_HTTP_SEND_FAILED',
  );
  assert.equal(acquisition.code, 'host-internal-error');
  assert.equal(acquisition.actionHint, 'retry_or_check_network');
  assert.equal(acquisition.retryable, true);
});
