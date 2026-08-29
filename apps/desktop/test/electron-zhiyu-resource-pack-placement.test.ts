import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { requestRunningZhiyuResourcePackPlacement } from '../src-electron/zhiyu-resource-pack-placement';

test('Desktop forwards the fixed request to a running Zhiyu presence and preserves typed ready', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-desktop-zhiyu-placement-')));
  const calls: Array<{ authorization: string | undefined; body: unknown; url: string | undefined }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      calls.push({
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        url: request.url,
      });
      const body = Buffer.from(JSON.stringify({
        bridgeId: 'zhiyu-placement-bridge-1',
        status: 'ready',
        reasonCode: 'zhiyu-resource-pack-placement-ready',
      }));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(body.length) });
      response.end(body);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const presencePath = path.join(home, '.nimi', 'run', 'zhiyu', 'resource-pack-placement', 'presence.v1.json');
    await mkdir(path.dirname(presencePath), { recursive: true });
    await writeFile(presencePath, JSON.stringify({
      schemaVersion: 1,
      appId: 'nimi.zhiyu',
      purpose: 'agent-center-resource-pack-placement',
      bridgeId: 'zhiyu-placement-bridge-1',
      pid: 42,
      endpoint: `http://127.0.0.1:${address.port}`,
      token: 'zhiyu-placement-token',
      startedAt: '2026-08-30T01:00:00.000Z',
      lastHeartbeatAt: '2026-08-30T01:00:05.000Z',
    }));

    const result = await requestRunningZhiyuResourcePackPlacement({
      homeDirectory: home,
      now: () => Date.parse('2026-08-30T01:00:05.000Z'),
      request: { schemaVersion: 1, correlationRef: 'zhiyu-placement-correlation-1' },
    });
    assert.deepEqual(result, {
      status: 'ready',
      reasonCode: 'zhiyu-resource-pack-placement-ready',
    });
    assert.deepEqual(calls, [{
      authorization: 'Bearer zhiyu-placement-token',
      body: { schemaVersion: 1, correlationRef: 'zhiyu-placement-correlation-1' },
      url: '/v1/agent-center-resource-pack-placement',
    }]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});

test('Desktop reports absent Zhiyu as typed unavailable without one exact registered start callback', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-desktop-zhiyu-placement-absent-')));
  try {
    const result = await requestRunningZhiyuResourcePackPlacement({
      homeDirectory: home,
      request: { schemaVersion: 1, correlationRef: 'zhiyu-placement-correlation-1' },
    });
    assert.deepEqual(result, {
      status: 'unavailable',
      reasonCode: 'target-app-unavailable',
      actionHint: 'start_zhiyu_and_retry',
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('Desktop starts only an exactly resolved Zhiyu registration before dispatch', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-desktop-zhiyu-placement-launch-')));
  const presencePath = path.join(home, '.nimi', 'run', 'zhiyu', 'resource-pack-placement', 'presence.v1.json');
  let starts = 0;
  try {
    const result = await requestRunningZhiyuResourcePackPlacement({
      homeDirectory: home,
      now: () => Date.parse('2026-08-30T01:00:05.000Z'),
      launchWaitMs: 500,
      request: { schemaVersion: 1, correlationRef: 'zhiyu-placement-correlation-launch' },
      async startExactZhiyu() {
        starts += 1;
        await mkdir(path.dirname(presencePath), { recursive: true });
        await writeFile(presencePath, JSON.stringify({
          schemaVersion: 1,
          appId: 'nimi.zhiyu',
          purpose: 'agent-center-resource-pack-placement',
          bridgeId: 'zhiyu-placement-bridge-launch',
          pid: 42,
          endpoint: 'http://127.0.0.1:49152',
          token: 'zhiyu-placement-token-launch',
          startedAt: '2026-08-30T01:00:00.000Z',
          lastHeartbeatAt: '2026-08-30T01:00:05.000Z',
        }));
        return true;
      },
      async fetch(_url, init) {
        assert.deepEqual(JSON.parse(init.body), {
          schemaVersion: 1,
          correlationRef: 'zhiyu-placement-correlation-launch',
        });
        return {
          status: 200,
          async json() {
            return {
              bridgeId: 'zhiyu-placement-bridge-launch',
              status: 'ready',
              reasonCode: 'zhiyu-resource-pack-placement-ready',
            };
          },
        };
      },
    });
    assert.equal(starts, 1);
    assert.deepEqual(result, { status: 'ready', reasonCode: 'zhiyu-resource-pack-placement-ready' });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
