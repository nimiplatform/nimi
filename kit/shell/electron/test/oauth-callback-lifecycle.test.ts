import { connect, createServer, type Socket } from 'node:net';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { listenElectronOauthForCode } from '../src/main/oauth.js';
import { findFreePort } from './electron-shell-test-utils.js';

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('operation did not finish within its bound')), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function listener(timeoutMs = 30_000) {
  const port = await findFreePort();
  const uri = `http://127.0.0.1:${port}/oauth/callback`;
  const result = listenElectronOauthForCode({ redirectUri: uri, expectedState: 'pending-state', timeoutMs }, 'oauth_listen_for_code');
  let completed = false;
  const observed = result.then(
    (value) => { completed = true; return { value, error: undefined }; },
    (error: unknown) => { completed = true; return { value: undefined, error }; },
  );
  const sockets: Socket[] = [];
  const requests: ClientRequest[] = [];

  const openSocket = async () => {
    for (let attempt = 0; ; attempt++) {
      const socket = connect({ host: '127.0.0.1', port });
      sockets.push(socket);
      socket.on('error', () => {});
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('connect', resolve);
          socket.once('error', reject);
        });
        socket.resume();
        return socket;
      } catch (error) {
        socket.destroy();
        if (attempt >= 30) throw error;
        await delay(10);
      }
    }
  };
  // A 100 Continue response establishes that the real server parsed this
  // request. Only one of the declared two body bytes is sent.
  const unfinishedPost = async () => {
    const socket = await openSocket();
    const acknowledged = new Promise<void>((resolve) => socket.once('data', () => resolve()));
    socket.write('POST /oauth/callback HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nExpect: 100-continue\r\n\r\nx');
    await within(acknowledged, 2000);
    socket.resume();
    return socket;
  };
  const accept = async () => {
    const response = await fetch(`${uri}?code=valid&state=pending-state`, { signal: AbortSignal.timeout(2000) });
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('Return to Nimi to finish signing in');
    expect(page).toContain('</html>');
    return within(observed, 2000);
  };
  return {
    uri, observed, openSocket, unfinishedPost, accept,
    post(headers: Record<string, string> = {}) {
      let client!: ClientRequest;
      const response = new Promise<{ status: number | undefined; text: string }>((resolve, reject) => {
        client = httpRequest(uri, { method: 'POST', headers }, (incoming) => {
          const parts: Buffer[] = [];
          incoming.on('data', (part: Buffer) => parts.push(part));
          incoming.on('end', () => resolve({ status: incoming.statusCode, text: Buffer.concat(parts).toString('utf8') }));
          incoming.on('error', reject);
        });
        client.on('error', reject);
      });
      // Cleanup after a failed assertion may close the request before its
      // response is awaited; retain rejection handling in that case as well.
      void response.catch(() => undefined);
      requests.push(client);
      return { client, response };
    },
    async cleanup() {
      for (const client of requests) client.destroy();
      for (const socket of sockets) socket.destroy();
      if (!completed) {
        await fetch(`${uri}?code=cleanup&state=pending-state`, { signal: AbortSignal.timeout(2000) })
          .then((response) => response.body?.cancel()).catch(() => undefined);
      }
      await within(observed, 2000);
    },
  };
}

describe('OAuth callback connection and request lifetime', () => {
  it('delivers a complete response when another request is pipelined on the accepted socket', async () => {
    const host = await listener();
    try {
      const socket = await host.openSocket();
      let response = '';
      socket.on('data', (chunk: Buffer) => { response += chunk.toString('utf8'); });
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
      socket.write('GET /oauth/callback?code=valid&state=pending-state HTTP/1.1\r\nHost: localhost\r\n\r\n'
        + 'POST /oauth/callback HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\nx');
      expect((await within(host.observed, 2000)).value).toMatchObject({ code: 'valid' });
      await within(closed, 2000);
      expect(response).toContain('HTTP/1.1 200');
      expect(response).toContain('</html>');
    } finally {
      await host.cleanup();
    }
  });

  it('delivers the accepted callback and complete browser page without waiting for an unfinished POST', async () => {
    const host = await listener();
    try {
      const stalled = await host.unfinishedPost();
      const idle = await host.openSocket();
      const closed = new Promise<void>((resolve) => stalled.once('close', () => resolve()));
      const idleClosed = new Promise<void>((resolve) => idle.once('close', () => resolve()));
      const outcome = await host.accept();
      expect(outcome.value).toMatchObject({ code: 'valid', state: 'pending-state' });
      await within(Promise.all([closed, idleClosed]), 2000);
      expect(idle.destroyed).toBe(true);
    } finally {
      await host.cleanup();
    }
  });

  it('delivers the real minimum business timeout while an unfinished POST is still connected', async () => {
    const started = Date.now();
    const host = await listener(10_000);
    try {
      const stalled = await host.unfinishedPost();
      const closed = new Promise<void>((resolve) => stalled.once('close', () => resolve()));
      const outcome = await within(host.observed, 12_000);
      expect(outcome.error).toMatchObject({ reasonCode: 'electron-oauth-callback-timeout' });
      expect(Date.now() - started).toBeGreaterThanOrEqual(9_500);
      await within(closed, 2000);
    } finally {
      await host.cleanup();
    }
  }, 16_000);

  it('accepts a complete form at the body limit and rejects a declared oversized body before it arrives', async () => {
    const host = await listener();
    try {
      const ready = await host.openSocket(); ready.destroy();
      const oversized = host.post({ 'Content-Length': String(16 * 1024 + 1) });
      oversized.client.flushHeaders();
      expect((await within(oversized.response, 2000)).status).toBe(413);
      const prefix = 'code=valid&state=pending-state&padding=';
      const form = prefix + 'x'.repeat(16 * 1024 - Buffer.byteLength(prefix));
      const valid = host.post({ 'Content-Type': 'application/x-www-form-urlencoded' });
      valid.client.end(form);
      expect((await within(valid.response, 2000)).status).toBe(200);
      expect((await within(host.observed, 2000)).value).toMatchObject({ code: 'valid' });
    } finally {
      await host.cleanup();
    }
  });

  it('rejects an oversized chunked body before the client ends it and preserves the login attempt', async () => {
    const host = await listener();
    try {
      const ready = await host.openSocket(); ready.destroy();
      const oversized = host.post({ 'Transfer-Encoding': 'chunked' });
      oversized.client.write(Buffer.alloc(8 * 1024, 'x'));
      oversized.client.write(Buffer.alloc(8 * 1024, 'x'));
      oversized.client.write('x');
      expect((await within(oversized.response, 2000)).status).toBe(413);
      expect((await host.accept()).value).toMatchObject({ state: 'pending-state' });
    } finally {
      await host.cleanup();
    }
  });

  it('bounds total body read time even while bytes continue arriving', async () => {
    const host = await listener();
    let drip: ReturnType<typeof setInterval> | undefined;
    try {
      const ready = await host.openSocket(); ready.destroy();
      const slow = host.post({ 'Content-Length': '1000' });
      slow.client.write('x');
      drip = setInterval(() => slow.client.write('x'), 250);
      expect((await within(slow.response, 12_000)).status).toBe(408);
      clearInterval(drip);
      expect((await host.accept()).value).toMatchObject({ code: 'valid' });
    } finally {
      clearInterval(drip);
      await host.cleanup();
    }
  }, 16_000);

  it('returns a typed binding failure without leaving the business timer running', async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    try {
      const address = occupied.address();
      if (!address || typeof address === 'string') throw new Error('expected TCP address');
      await expect(within(listenElectronOauthForCode({
        redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`,
        expectedState: 'pending-state',
      }, 'oauth_listen_for_code'), 2000)).rejects.toMatchObject({
        reasonCode: 'electron-oauth-callback-listener-failed',
      });
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });
});
