import assert from 'node:assert/strict';
import test from 'node:test';

import { CONNECTOR_AUTH_ACQUISITION_PROFILES } from '@nimiplatform/sdk/runtime/host';
import {
  createDesktopElectronHttpHost,
  type DesktopElectronHttpHost,
} from '../src-electron/http-request-host.js';

type SentRequest = {
  readonly input: string | URL;
  readonly init: RequestInit | undefined;
};

function invokeConnectorAuth(
  host: DesktopElectronHttpHost,
  request: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
) {
  return host.connectorAuthRequest(
    request as Parameters<DesktopElectronHttpHost['connectorAuthRequest']>[0],
    signal,
  );
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
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;
  assert.ok(profile);
  const host = createDesktopElectronHttpHost({
    fetch: async (input, init) => {
      sent.push({ input, init });
      return new Response('{"ok":true}', {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'session=must-not-reach-renderer',
          'Set-Cookie2': 'legacy=must-not-reach-renderer',
        },
      });
    },
  });

  const result = await invokeConnectorAuth(host, {
    url: profile.deviceTokenUrl,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: '{"device_auth_id":"fixture"}',
    profileId: profile.profileId,
    purpose: 'device_token',
  });

  assert.deepEqual(result, {
    status: 201,
    ok: true,
    headers: {
      'content-type': 'application/json',
    },
    body: '{"ok":true}',
  });
  assert.equal(sent.length, 1);
  assert.equal(String(sent[0]?.input), profile.deviceTokenUrl);
  assert.equal(sent[0]?.init?.method, 'POST');
  assert.equal(sent[0]?.init?.body, '{"device_auth_id":"fixture"}');
  assert.equal(sent[0]?.init?.redirect, 'manual');
  assert.equal(sent[0]?.init?.credentials, 'omit');
  assert.ok(sent[0]?.init?.signal instanceof AbortSignal);
});

test('Electron HTTP host uses the SDK acquisition profile for exact OAuth POST admission', async () => {
  const sent: string[] = [];
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;
  assert.ok(profile);
  const host = createDesktopElectronHttpHost({
    fetch: async (input) => {
      sent.push(String(input));
      return new Response('{"ok":true}', {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await invokeConnectorAuth(host, {
    url: profile.deviceAuthorizationUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"client_id":"fixture"}',
    profileId: profile.profileId,
    purpose: 'device_authorization',
  });
  await invokeConnectorAuth(host, {
    url: profile.deviceTokenUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"device_auth_id":"fixture"}',
    profileId: profile.profileId,
    purpose: 'device_token',
  });
  assert.deepEqual(sent, [
    profile.deviceAuthorizationUrl,
    profile.deviceTokenUrl,
  ]);

  for (const request of [
    {
      url: profile.deviceAuthorizationUrl,
      method: 'GET',
      profileId: profile.profileId,
      purpose: 'device_authorization',
    },
    {
      url: profile.deviceAuthorizationUrl,
      method: 'POST',
      profileId: profile.profileId,
      purpose: 'device_token',
    },
    {
      url: `${profile.deviceAuthorizationUrl}?redirect=1`,
      method: 'POST',
      profileId: profile.profileId,
      purpose: 'device_authorization',
    },
    {
      url: profile.deviceAuthorizationUrl,
      method: 'POST',
      profileId: 'unknown-profile',
      purpose: 'device_authorization',
    },
    {
      url: profile.deviceAuthorizationUrl,
      method: 'POST',
    },
  ]) {
    await expectReason(
      invokeConnectorAuth(host, request),
      'DESKTOP_HTTP_CONNECTOR_AUTH_NOT_ADMITTED',
    );
  }
  assert.equal(sent.length, 2);
});

test('Electron HTTP host rejects sensitive header overrides', async () => {
  let sendCount = 0;
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;
  assert.ok(profile);
  const host = createDesktopElectronHttpHost({
    fetch: async () => {
      sendCount += 1;
      return new Response('unexpected');
    },
  });

  await expectReason(
    invokeConnectorAuth(host, {
      url: 'ftp://realm.nimi.ai/file',
    }),
    'DESKTOP_HTTP_URL_SCHEME_INVALID',
  );
  await expectReason(
    invokeConnectorAuth(host, {
      url: profile.deviceTokenUrl,
      method: 'TRACE',
      profileId: profile.profileId,
      purpose: 'device_token',
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
      invokeConnectorAuth(host, {
        url: profile.deviceTokenUrl,
        method: 'POST',
        headers: { [headerName]: 'renderer-value' },
        profileId: profile.profileId,
        purpose: 'device_token',
      }),
      'DESKTOP_HTTP_HEADER_RESTRICTED',
    );
  }
  assert.equal(sendCount, 0);
});

test('Electron HTTP host applies fixed request-size boundaries before network dispatch', async () => {
  let sendCount = 0;
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;
  assert.ok(profile);
  const host = createDesktopElectronHttpHost({
    fetch: async () => {
      sendCount += 1;
      return new Response('unexpected');
    },
  });
  const oversizedRequests: Readonly<Record<string, unknown>>[] = [
    {
      url: `${profile.deviceTokenUrl}${'u'.repeat(8 * 1024)}`,
      method: 'POST',
      profileId: profile.profileId,
      purpose: 'device_token',
    },
    {
      url: profile.deviceTokenUrl,
      method: 'POST',
      headers: { [`x-${'n'.repeat(128)}`]: 'value' },
      profileId: profile.profileId,
      purpose: 'device_token',
    },
    {
      url: profile.deviceTokenUrl,
      method: 'POST',
      headers: { 'x-large-value': 'v'.repeat((8 * 1024) + 1) },
      profileId: profile.profileId,
      purpose: 'device_token',
    },
    {
      url: profile.deviceTokenUrl,
      method: 'POST',
      headers: {
        'x-total-a': 'a'.repeat(8 * 1024),
        'x-total-b': 'b'.repeat(8 * 1024),
        'x-total-c': 'c'.repeat(8 * 1024),
        'x-total-d': 'd'.repeat(8 * 1024),
      },
      profileId: profile.profileId,
      purpose: 'device_token',
    },
    {
      url: profile.deviceTokenUrl,
      method: 'POST',
      body: 'b'.repeat((8 * 1024 * 1024) + 1),
      profileId: profile.profileId,
      purpose: 'device_token',
    },
  ];

  for (const request of oversizedRequests) {
    const error = await expectReason(
      invokeConnectorAuth(host, request),
      'DESKTOP_HTTP_REQUEST_TOO_LARGE',
    );
    assert.equal(error.retryable, false);
  }
  assert.equal(sendCount, 0);
});

test('Electron HTTP host cancels a decompressed response stream above 16 MiB', async () => {
  let canceled = false;
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;
  assert.ok(profile);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array((16 * 1024 * 1024) + 1));
    },
    cancel() {
      canceled = true;
    },
  });
  const host = createDesktopElectronHttpHost({
    fetch: async () => new Response(body, {
      headers: {
        'Content-Encoding': 'gzip',
        'Set-Cookie': 'session=must-not-reach-renderer',
      },
    }),
  });

  const error = await expectReason(
    invokeConnectorAuth(host, {
      url: profile.deviceTokenUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      profileId: profile.profileId,
      purpose: 'device_token',
    }),
    'DESKTOP_HTTP_RESPONSE_TOO_LARGE',
  );
  assert.equal(error.retryable, false);
  assert.equal(canceled, true);
});

test('Electron HTTP host enforces a 32-request burst for each origin over five seconds', async () => {
  let now = 10_000;
  let sendCount = 0;
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;
  assert.ok(profile);
  const host = createDesktopElectronHttpHost({
    now: () => now,
    fetch: async () => {
      sendCount += 1;
      return new Response('ok');
    },
  });
  const admittedRequest = {
    url: profile.deviceTokenUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    profileId: profile.profileId,
    purpose: 'device_token',
  } as const;

  for (let index = 0; index < 32; index += 1) {
    await invokeConnectorAuth(host, admittedRequest);
  }
  assert.equal(sendCount, 32);
  const limited = await expectReason(
    invokeConnectorAuth(host, admittedRequest),
    'DESKTOP_HTTP_RATE_LIMITED',
  );
  assert.equal(limited.retryable, true);
  assert.equal(sendCount, 32);

  now = 9_000;
  await invokeConnectorAuth(host, admittedRequest);
  assert.equal(sendCount, 33);

  now += 5_001;
  await invokeConnectorAuth(host, admittedRequest);
  assert.equal(sendCount, 34);
});

test('Electron HTTP host classifies acquisition transport failures', async () => {
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;
  assert.ok(profile);
  const host = createDesktopElectronHttpHost({
    fetch: async () => {
      throw new Error('connection refused');
    },
  });
  const acquisition = await expectReason(
    invokeConnectorAuth(host, {
      url: profile.deviceTokenUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      profileId: profile.profileId,
      purpose: 'device_token',
    }),
    'DESKTOP_HTTP_SEND_FAILED',
  );
  assert.equal(acquisition.code, 'host-internal-error');
  assert.equal(acquisition.actionHint, 'retry_or_check_network');
  assert.equal(acquisition.retryable, true);
});

test('Electron HTTP host propagates managed connector cancellation into provider fetch', async () => {
  let observedSignal: AbortSignal | undefined;
  const host = createDesktopElectronHttpHost({
    fetch: async (_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<never>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
      });
    },
  });
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;
  assert.ok(profile);
  const controller = new AbortController();
  const request = invokeConnectorAuth(host, {
    url: profile.deviceTokenUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    profileId: profile.profileId,
    purpose: 'device_token',
  }, controller.signal);
  controller.abort(new DOMException('cancel provider request', 'AbortError'));
  await expectReason(request, 'DESKTOP_HTTP_SEND_FAILED');
  assert.equal(observedSignal?.aborted, true);
});
