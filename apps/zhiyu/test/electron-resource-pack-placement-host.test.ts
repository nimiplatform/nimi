import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createZhiyuElectronResourcePackPlacementHost,
  type ZhiyuElectronResourcePackPlacementHost,
} from '../src-electron/resource-pack-placement-host';

test('Zhiyu presence focuses, emits one purpose-specific event, and waits for destination ready ack', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-zhiyu-placement-host-')));
  const presencePath = path.join(home, '.nimi', 'run', 'zhiyu', 'resource-pack-placement', 'presence.v1.json');
  const events: unknown[] = [];
  let focusCount = 0;
  let host: ZhiyuElectronResourcePackPlacementHost | undefined;
  try {
    host = await createZhiyuElectronResourcePackPlacementHost({
      homeDirectory: home,
      heartbeatIntervalMs: 60_000,
      ackTimeoutMs: 1_000,
      now: () => Date.parse('2026-08-30T01:00:00.000Z'),
      focusMainWindow: async () => { focusCount += 1; },
      redeemPlacement: async (correlationRef) => {
        assert.equal(correlationRef, 'zhiyu-placement-correlation-1');
        return { conversationAnchorId: 'conversation-anchor-1' };
      },
      resolveDestinationAgent: async (conversationAnchorId) => {
        assert.equal(conversationAnchorId, 'conversation-anchor-1');
        return { status: 'ready', agentHandle: 'agent_ref_destination_current' };
      },
      emitPlacement: (event) => {
        events.push(event);
        queueMicrotask(() => host?.acknowledge({
          schemaVersion: 1,
          requestId: event.requestId,
          status: 'ready',
          reasonCode: 'zhiyu-resource-pack-placement-ready',
        }));
      },
    });
    const descriptor = JSON.parse(await readFile(presencePath, 'utf8')) as {
      bridgeId: string;
      endpoint: string;
      token: string;
    };
    const unauthorized = await post(descriptor.endpoint, 'wrong-token', {
      schemaVersion: 1,
      correlationRef: 'zhiyu-placement-correlation-1',
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(focusCount, 0);

    const response = await post(descriptor.endpoint, descriptor.token, {
      schemaVersion: 1,
      correlationRef: 'zhiyu-placement-correlation-1',
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, {
      bridgeId: descriptor.bridgeId,
      status: 'ready',
      reasonCode: 'zhiyu-resource-pack-placement-ready',
    });
    assert.equal(focusCount, 1);
    assert.deepEqual(events, [{
      schemaVersion: 1,
      requestId: (events[0] as { requestId: string }).requestId,
      agentHandle: 'agent_ref_destination_current',
    }]);

    const forbidden = await post(descriptor.endpoint, descriptor.token, {
      schemaVersion: 1,
      correlationRef: 'zhiyu-placement-correlation-1',
      conversationAnchorId: 'conversation-anchor-forbidden',
      candidateBytes: [1, 2, 3],
    });
    assert.equal(forbidden.status, 400);
    assert.equal(focusCount, 1);
    assert.equal(events.length, 1);
  } finally {
    await host?.shutdown();
    await assert.rejects(readFile(presencePath, 'utf8'), { code: 'ENOENT' });
    await rm(home, { recursive: true, force: true });
  }
});

test('Zhiyu presence returns typed non-ready when the renderer does not acknowledge', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-zhiyu-placement-timeout-')));
  let host: ZhiyuElectronResourcePackPlacementHost | undefined;
  try {
    host = await createZhiyuElectronResourcePackPlacementHost({
      homeDirectory: home,
      heartbeatIntervalMs: 60_000,
      ackTimeoutMs: 20,
      focusMainWindow: async () => undefined,
      emitPlacement: () => undefined,
      redeemPlacement: async () => ({ conversationAnchorId: 'conversation-anchor-1' }),
      resolveDestinationAgent: async () => ({ status: 'ready', agentHandle: 'agent_ref_destination_current' }),
    });
    const descriptor = JSON.parse(await readFile(
      path.join(home, '.nimi', 'run', 'zhiyu', 'resource-pack-placement', 'presence.v1.json'),
      'utf8',
    )) as { bridgeId: string; endpoint: string; token: string };
    const response = await post(descriptor.endpoint, descriptor.token, {
      schemaVersion: 1,
      correlationRef: 'zhiyu-placement-correlation-1',
    });
    assert.deepEqual(await response.json(), {
      bridgeId: descriptor.bridgeId,
      status: 'failed',
      reasonCode: 'destination-not-ready',
      actionHint: 'retry_zhiyu_resource_pack_placement',
    });
  } finally {
    await host?.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

test('Zhiyu placement serializes resolution and preserves destination-session failure', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-zhiyu-placement-race-')));
  let host: ZhiyuElectronResourcePackPlacementHost | undefined;
  let releaseRedemption: (() => void) | undefined;
  const redemptionGate = new Promise<void>((resolve) => { releaseRedemption = resolve; });
  try {
    host = await createZhiyuElectronResourcePackPlacementHost({
      homeDirectory: home,
      heartbeatIntervalMs: 60_000,
      ackTimeoutMs: 200,
      focusMainWindow: async () => undefined,
      emitPlacement: () => undefined,
      redeemPlacement: async () => {
        await redemptionGate;
        return { conversationAnchorId: 'conversation-anchor-1' };
      },
      resolveDestinationAgent: async () => ({ status: 'failed', reasonCode: 'destination-session-failed' }),
    });
    const descriptor = JSON.parse(await readFile(
      path.join(home, '.nimi', 'run', 'zhiyu', 'resource-pack-placement', 'presence.v1.json'),
      'utf8',
    )) as { bridgeId: string; endpoint: string; token: string };
    const first = post(descriptor.endpoint, descriptor.token, {
      schemaVersion: 1,
      correlationRef: 'zhiyu-placement-correlation-first',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await post(descriptor.endpoint, descriptor.token, {
      schemaVersion: 1,
      correlationRef: 'zhiyu-placement-correlation-second',
    });
    assert.deepEqual(await second.json(), {
      bridgeId: descriptor.bridgeId,
      status: 'failed',
      reasonCode: 'destination-not-ready',
      actionHint: 'retry_zhiyu_resource_pack_placement',
    });
    releaseRedemption?.();
    assert.deepEqual(await (await first).json(), {
      bridgeId: descriptor.bridgeId,
      status: 'failed',
      reasonCode: 'destination-session-failed',
      actionHint: 'retry_zhiyu_resource_pack_placement',
    });
  } finally {
    releaseRedemption?.();
    await host?.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

async function post(endpoint: string, token: string, value: unknown): Promise<Response> {
  return fetch(`${endpoint}/v1/agent-center-resource-pack-placement`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
}
