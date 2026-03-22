import assert from 'node:assert/strict';
import test from 'node:test';

import { desktopBridge } from '../src/shell/renderer/bridge';
import { createProxyFetch } from '../src/shell/renderer/infra/bridge/proxy-fetch';

test('createProxyFetch keeps Request method/body/headers when init is omitted', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const originalProxyHttp = desktopBridge.proxyHttp;

  desktopBridge.proxyHttp = (async (payload: Record<string, unknown>) => {
    calls.push(payload);
    return {
      status: 200,
      ok: true,
      headers: {
        'content-type': 'application/json',
      },
      body: '{}',
    };
  }) as typeof desktopBridge.proxyHttp;

  try {
    const proxyFetch = createProxyFetch();
    const body = JSON.stringify({ identifier: 'demo', password: 'demo-password' });
    await proxyFetch(new Request('http://127.0.0.1:3002/api/auth/password/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body,
    }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, 'POST');
    assert.equal(calls[0]?.body, body);
    assert.equal((calls[0]?.headers as Record<string, string>)['content-type'], 'application/json');
  } finally {
    desktopBridge.proxyHttp = originalProxyHttp;
  }
});

test('createProxyFetch moves authorization into explicit bridge field', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const originalProxyHttp = desktopBridge.proxyHttp;

  desktopBridge.proxyHttp = (async (payload: Record<string, unknown>) => {
    calls.push(payload);
    return {
      status: 200,
      ok: true,
      headers: {
        'content-type': 'application/json',
      },
      body: '{}',
    };
  }) as typeof desktopBridge.proxyHttp;

  try {
    const proxyFetch = createProxyFetch();
    await proxyFetch('http://127.0.0.1:3002/api/me', {
      headers: {
        authorization: 'Bearer desktop-token',
        'content-type': 'application/json',
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.authorization, 'Bearer desktop-token');
    assert.equal((calls[0]?.headers as Record<string, string>).authorization, undefined);
    assert.equal((calls[0]?.headers as Record<string, string>)['content-type'], 'application/json');
  } finally {
    desktopBridge.proxyHttp = originalProxyHttp;
  }
});
