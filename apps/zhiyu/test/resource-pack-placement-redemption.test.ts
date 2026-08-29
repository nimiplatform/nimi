import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { redeemDesktopZhiyuResourcePackPlacement } from '../src-electron/resource-pack-placement-redemption';

test('Zhiyu main redeems only the Host-private correlation through Desktop presence auth', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-zhiyu-placement-redeem-')));
  const descriptorPath = path.join(root, 'presence.v1.json');
  try {
    await mkdir(path.dirname(descriptorPath), { recursive: true });
    await writeFile(descriptorPath, JSON.stringify({
      schemaVersion: 1,
      desktopAppId: 'nimi.desktop',
      bridgeId: 'desktop-placement-bridge',
      pid: 42,
      endpoint: 'http://127.0.0.1:49152',
      token: 'desktop-placement-token',
      startedAt: '2026-08-30T01:00:00.000Z',
      lastHeartbeatAt: '2026-08-30T01:00:05.000Z',
    }));
    const calls = [];
    const result = await redeemDesktopZhiyuResourcePackPlacement({
      correlationRef: 'zhiyu-placement-correlation-1',
      host: {
        desktopOpen: {
          descriptorPath,
          now: () => Date.parse('2026-08-30T01:00:05.000Z'),
          async fetch(url, init) {
            calls.push({ url, init });
            return {
              status: 200,
              async json() {
                return {
                  bridgeId: 'desktop-placement-bridge',
                  status: 'redeemed',
                  conversationAnchorId: 'conversation-anchor-main-only',
                };
              },
            };
          },
        },
      },
    });
    assert.deepEqual(result, { conversationAnchorId: 'conversation-anchor-main-only' });
    assert.equal(calls[0].url, 'http://127.0.0.1:49152/v1/zhiyu-resource-pack-placement/redeem');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      schemaVersion: 1,
      correlationRef: 'zhiyu-placement-correlation-1',
    });
    assert.doesNotMatch(JSON.stringify(calls[0]), /agentHandle|candidateBytes|targetAppId/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
