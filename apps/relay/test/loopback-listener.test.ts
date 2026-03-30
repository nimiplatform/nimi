import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { listenForOAuthCallback } from '../src/main/auth/loopback-listener.js';

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate test port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForListener(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
}

describe('RL-BOOT-005 — loopback OAuth listener', () => {
  it('parses GET callback query params', async () => {
    const port = await getAvailablePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const listenTask = listenForOAuthCallback({ redirectUri, timeoutMs: 500 });

    await waitForListener();
    const response = await fetch(`${redirectUri}?code=token-123&state=state-abc`);
    assert.equal(response.status, 200);

    const result = await listenTask;
    assert.equal(result.code, 'token-123');
    assert.equal(result.state, 'state-abc');
    assert.equal(result.error, undefined);
  });

  it('parses POST callback form body and accepts localhost redirect URIs', async () => {
    const port = await getAvailablePort();
    const redirectUri = `http://localhost:${port}/oauth/callback`;
    const listenTask = listenForOAuthCallback({ redirectUri, timeoutMs: 500 });

    await waitForListener();
    const response = await fetch(redirectUri, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'code=token-post&state=state-post',
    });
    assert.equal(response.status, 200);

    const result = await listenTask;
    assert.equal(result.code, 'token-post');
    assert.equal(result.state, 'state-post');
    assert.equal(result.error, undefined);
  });

  it('ignores wrong callback paths until a valid callback arrives', async () => {
    const port = await getAvailablePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const listenTask = listenForOAuthCallback({ redirectUri, timeoutMs: 500 });

    await waitForListener();
    const wrongPathResponse = await fetch(`http://127.0.0.1:${port}/oauth/other?code=ignored`);
    assert.equal(wrongPathResponse.status, 404);

    const validResponse = await fetch(`${redirectUri}?code=token-after-404&state=recovered`);
    assert.equal(validResponse.status, 200);

    const result = await listenTask;
    assert.equal(result.code, 'token-after-404');
    assert.equal(result.state, 'recovered');
  });

  it('returns error callbacks as terminal results', async () => {
    const port = await getAvailablePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const listenTask = listenForOAuthCallback({ redirectUri, timeoutMs: 500 });

    await waitForListener();
    const response = await fetch(redirectUri, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'error=access_denied&state=state-error',
    });
    assert.equal(response.status, 200);

    const result = await listenTask;
    assert.equal(result.code, undefined);
    assert.equal(result.state, 'state-error');
    assert.equal(result.error, 'access_denied');
  });

  it('does not resolve success when callback omits both code and error', async () => {
    const port = await getAvailablePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const listenTask = listenForOAuthCallback({ redirectUri, timeoutMs: 500 });

    await waitForListener();
    const invalidResponse = await fetch(redirectUri, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'state=missing-code',
    });
    assert.equal(invalidResponse.status, 400);

    const validResponse = await fetch(`${redirectUri}?code=token-after-invalid&state=final-state`);
    assert.equal(validResponse.status, 200);

    const result = await listenTask;
    assert.equal(result.code, 'token-after-invalid');
    assert.equal(result.state, 'final-state');
    assert.equal(result.error, undefined);
  });
});
