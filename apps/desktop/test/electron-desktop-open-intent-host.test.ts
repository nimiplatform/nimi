import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { NimiDesktopOpenIntentEnvelope } from '@nimiplatform/kit/core/desktop-open';
import type { AvatarHostHandoffRequest } from '@nimiplatform/kit/features/avatar/headless';
import {
  DESKTOP_AGENT_CENTER_RESOURCE_PACK_PLACEMENT_PATH,
  requestElectronAppActivitySourceLaunch,
} from '@nimiplatform/kit/shell/electron/main';
import { createDesktopAppActivitySourceLaunch } from '../src-electron/app-activity-source-launch-host';
import {
  createDesktopElectronOpenIntentHost,
  DESKTOP_APP_ACTIVITY_SOURCE_LAUNCH_PATH,
  DESKTOP_AVATAR_HOST_HANDOFF_PATH,
  DESKTOP_OPEN_INTENT_EVENT,
  DESKTOP_ZHIYU_RESOURCE_PACK_REDEEM_PATH,
} from '../src-electron/desktop-open-intent-host';
import type { DesktopAvatarHostHandoffDispatch } from '../src-electron/bundled-avatar-host';

const envelope: NimiDesktopOpenIntentEnvelope = {
  schemaVersion: 1,
  sourceApp: 'nimi.zhiyu',
  sourceHost: 'desktop-electron-local-app-host',
  requestId: 'desktop-open-zhiyu-test-1',
  intent: {
    kind: 'open-explore',
    section: 'personas',
    productIntent: 'select-partner',
  },
};

test('Electron Desktop Open host enforces auth/readiness and emits an exact admitted envelope', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-desktop-open-')));
  const descriptorPath = path.join(
    home,
    '.nimi',
    'run',
    'desktop',
    'open-intent',
    'presence.v1.json',
  );
  let now = Date.parse('2026-07-19T10:00:00.000Z');
  let focusCount = 0;
  const emitted: NimiDesktopOpenIntentEnvelope[] = [];
  const avatarRequests: DesktopAvatarHostHandoffDispatch[] = [];
  const placementRequests: unknown[] = [];
  let descriptor: {
    schemaVersion: number;
    desktopAppId: string;
    bridgeId: string;
    endpoint: string;
    token: string;
    startedAt: string;
    lastHeartbeatAt: string;
  } | undefined;
  const host = await createDesktopElectronOpenIntentHost({
    homeDirectory: home,
    now: () => now,
    heartbeatIntervalMs: 60_000,
    readinessTtlMs: 10_000,
    focusMainWindow: async () => { focusCount += 1; },
    emitIntent: (value) => emitted.push(value),
    avatarHostHandoff: async (dispatch) => {
      avatarRequests.push(dispatch);
      return {
        command: dispatch.request.command,
        state: 'present',
        avatarInstanceRef: dispatch.request.target.avatarInstanceId,
        switchIntentRef: null,
        committedPresentationRef: dispatch.request.target.committedPresentationRef,
        temporaryCustodyRef: dispatch.request.target.temporaryCustodyRef,
      };
    },
    zhiyuResourcePackPlacement: async (request) => {
      placementRequests.push(request);
      assert.ok(descriptor);
      assert.deepEqual(Object.keys(request).sort(), ['correlationRef', 'schemaVersion']);
      const mismatched = await post(
        descriptor.endpoint,
        descriptor.token,
        { schemaVersion: 1, correlationRef: 'zhiyu-placement-mismatch' },
        DESKTOP_ZHIYU_RESOURCE_PACK_REDEEM_PATH,
      );
      assert.equal(mismatched.status, 404);
      const redeemed = await post(
        descriptor.endpoint,
        descriptor.token,
        request,
        DESKTOP_ZHIYU_RESOURCE_PACK_REDEEM_PATH,
      );
      assert.equal(redeemed.status, 200);
      assert.deepEqual(await redeemed.json(), {
        bridgeId: descriptor.bridgeId,
        status: 'redeemed',
        conversationAnchorId: 'conversation-anchor-1',
      });
      const reused = await post(
        descriptor.endpoint,
        descriptor.token,
        request,
        DESKTOP_ZHIYU_RESOURCE_PACK_REDEEM_PATH,
      );
      assert.equal(reused.status, 404);
      return {
        status: 'ready',
        reasonCode: 'zhiyu-resource-pack-placement-ready',
      };
    },
  });
  try {
    descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as typeof descriptor;
    assert.ok(descriptor);
    assert.equal(descriptor.schemaVersion, 1);
    assert.equal(descriptor.desktopAppId, 'nimi.desktop');
    assert.match(descriptor.bridgeId, /^desktop-open-bridge-[A-Za-z0-9_-]+$/u);
    assert.match(descriptor.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.equal(descriptor.startedAt, '2026-07-19T10:00:00.000Z');
    assert.equal(descriptor.lastHeartbeatAt, descriptor.startedAt);

    const unknown = await fetch(`${descriptor.endpoint}/v1/open-intent?query=not-allowed`, {
      method: 'POST',
    });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get('access-control-allow-origin'), null);

    const unauthorized = await post(descriptor.endpoint, 'wrong-token', envelope);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), {
      status: 'rejected',
      bridgeId: descriptor.bridgeId,
      reasonCode: 'desktop-open-bridge-auth-failed',
      actionHint: 'check_desktop_runtime_bridge',
    });

    const notReady = await post(descriptor.endpoint, descriptor.token, envelope);
    assert.equal(notReady.status, 200);
    assert.deepEqual(await notReady.json(), {
      status: 'rejected',
      bridgeId: descriptor.bridgeId,
      reasonCode: 'desktop-open-desktop-not-ready',
      actionHint: 'wait_for_desktop_ready',
    });
    assert.equal(focusCount, 0);
    assert.deepEqual(emitted, []);

    const placement = await post(
      descriptor.endpoint,
      descriptor.token,
      { schemaVersion: 1, conversationAnchorId: 'conversation-anchor-1' },
      DESKTOP_AGENT_CENTER_RESOURCE_PACK_PLACEMENT_PATH,
    );
    assert.equal(placement.status, 200);
    assert.deepEqual(await placement.json(), {
      bridgeId: descriptor.bridgeId,
      status: 'ready',
      reasonCode: 'zhiyu-resource-pack-placement-ready',
    });
    assert.equal(placementRequests.length, 1);
    assert.deepEqual(Object.keys(placementRequests[0] as object).sort(), ['correlationRef', 'schemaVersion']);
    assert.equal(focusCount, 0);
    assert.deepEqual(emitted, []);

    const avatarRequest: AvatarHostHandoffRequest = {
      command: 'presence',
      target: {
        agentHandle: `agent_ref_${'a'.repeat(43)}`,
        conversationAnchorId: 'anchor-1',
        avatarInstanceId: 'avatar-instance-1',
        launchSource: 'zhiyu',
        switchIntentRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      },
    };
    const avatarPresence = await post(
      descriptor.endpoint,
      descriptor.token,
      {
        schemaVersion: 1,
        sourceApp: 'nimi.zhiyu',
        avatarHostTargetRef: `avatar_target_${'b'.repeat(43)}`,
        request: avatarRequest,
      },
      DESKTOP_AVATAR_HOST_HANDOFF_PATH,
    );
    assert.equal(avatarPresence.status, 200);
    assert.deepEqual(await avatarPresence.json(), {
      bridgeId: descriptor.bridgeId,
      command: 'presence',
      state: 'present',
      avatarInstanceRef: 'avatar-instance-1',
      switchIntentRef: null,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    });
    assert.deepEqual(avatarRequests, [{
      schemaVersion: 1,
      sourceApp: 'nimi.zhiyu',
      avatarHostTargetRef: `avatar_target_${'b'.repeat(43)}`,
      request: avatarRequest,
    }]);
    assert.equal(focusCount, 0);

    assert.throws(() => host.commandHandlers.desktop_open_intent_set_ready({
      command: 'desktop_open_intent_set_ready',
      payload: { ready: true, extra: true },
    }), /desktop-open-ready-payload-invalid/u);
    host.commandHandlers.desktop_open_intent_set_ready({
      command: 'desktop_open_intent_set_ready',
      payload: { ready: true },
    });

    const accepted = await post(descriptor.endpoint, descriptor.token, envelope);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {
      status: 'accepted',
      confirmation: 'desktop-accepted',
      bridgeId: descriptor.bridgeId,
      requestId: envelope.requestId,
      appliedTarget: envelope.intent.kind,
    });
    assert.equal(focusCount, 1);
    assert.deepEqual(emitted, [envelope]);

    now += 10_001;
    const stale = await post(descriptor.endpoint, descriptor.token, envelope);
    assert.deepEqual(await stale.json(), {
      status: 'rejected',
      bridgeId: descriptor.bridgeId,
      reasonCode: 'desktop-open-desktop-not-ready',
      actionHint: 'wait_for_desktop_ready',
    });
    assert.equal(focusCount, 1);
  } finally {
    await host.shutdown();
    await assert.rejects(readFile(descriptorPath, 'utf8'), { code: 'ENOENT' });
    await rm(home, { recursive: true, force: true });
  }
});

test('Electron Desktop Open host rejects a non-canonical symlinked home ancestry', {
  skip: process.platform !== 'darwin',
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-desktop-open-symlink-')));
  const canonicalHome = path.join(root, 'canonical-home');
  const linkedHome = path.join(root, 'linked-home');
  try {
    await mkdir(canonicalHome, { mode: 0o700 });
    await symlink(canonicalHome, linkedHome, 'dir');
    await assert.rejects(
      createDesktopElectronOpenIntentHost({
        homeDirectory: linkedHome,
        focusMainWindow: async () => undefined,
        emitIntent: () => undefined,
      }),
      /desktop-open-presence-parent-must-not-be-symlink/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Electron Desktop Open event keeps the admitted cross-shell event identity', () => {
  assert.equal(DESKTOP_OPEN_INTENT_EVENT, 'desktop-open://open-intent');
});

test('Zhiyu placement correlation expires before redemption and never exposes source context', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-placement-expiry-')));
  let now = Date.parse('2026-08-30T01:00:00.000Z');
  let descriptor: { endpoint: string; token: string } | undefined;
  const host = await createDesktopElectronOpenIntentHost({
    homeDirectory: home,
    now: () => now,
    heartbeatIntervalMs: 60_000,
    focusMainWindow: async () => undefined,
    emitIntent: () => undefined,
    zhiyuResourcePackPlacement: async (request) => {
      assert.ok(descriptor);
      now += 15_001;
      const stale = await post(
        descriptor.endpoint,
        descriptor.token,
        request,
        DESKTOP_ZHIYU_RESOURCE_PACK_REDEEM_PATH,
      );
      assert.equal(stale.status, 404);
      assert.doesNotMatch(JSON.stringify(request), /agent_ref|conversation-anchor|candidateBytes/u);
      return {
        status: 'failed',
        reasonCode: 'agent-resolution-failed',
        actionHint: 'retry_zhiyu_resource_pack_placement',
      };
    },
  });
  try {
    descriptor = JSON.parse(await readFile(path.join(
      home, '.nimi', 'run', 'desktop', 'open-intent', 'presence.v1.json',
    ), 'utf8')) as typeof descriptor;
    const result = await host.requestZhiyuResourcePackPlacement({
      conversationAnchorId: 'conversation-anchor-expiring',
    });
    assert.deepEqual(result, {
      status: 'failed',
      reasonCode: 'agent-resolution-failed',
      actionHint: 'retry_zhiyu_resource_pack_placement',
    });
  } finally {
    await host.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

test('App activity source launch accepts only a Runtime-issued request id over the running bridge', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-activity-launch-')));
  const descriptorPath = path.join(home, '.nimi', 'run', 'desktop', 'open-intent', 'presence.v1.json');
  const openRequestId = `aor_${'A'.repeat(32)}`;
  const launched: string[] = [];
  const host = await createDesktopElectronOpenIntentHost({
    homeDirectory: home,
    heartbeatIntervalMs: 60_000,
    focusMainWindow: async () => undefined,
    emitIntent: () => undefined,
    appActivitySourceLaunch: async (id) => {
      launched.push(id);
      return { status: 'requested' };
    },
  });
  try {
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as { endpoint: string; token: string; bridgeId: string };
    // The Kit carrier of another App's Host reaches the same exact endpoint.
    assert.deepEqual(
      await requestElectronAppActivitySourceLaunch({ host: { desktopOpen: { descriptorPath } }, openRequestId }),
      { status: 'requested' },
    );
    assert.deepEqual(launched, [openRequestId]);
    for (const body of [
      { schemaVersion: 1, openRequestId, appId: 'com.example.studio' },
      { schemaVersion: 1, openRequestId: 'aor_short' },
      { schemaVersion: 2, openRequestId },
      { schemaVersion: 1, openRequestId: `https://example.com/${'A'.repeat(20)}` },
    ]) {
      const rejected = await post(descriptor.endpoint, descriptor.token, body, DESKTOP_APP_ACTIVITY_SOURCE_LAUNCH_PATH);
      assert.equal(rejected.status, 400);
      assert.deepEqual(await rejected.json(), { bridgeId: descriptor.bridgeId, status: 'failed', reason: 'launch-failed' });
    }
    const unauthorized = await post(descriptor.endpoint, 'wrong-token', { schemaVersion: 1, openRequestId }, DESKTOP_APP_ACTIVITY_SOURCE_LAUNCH_PATH);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(launched, [openRequestId], 'rejected requests never reach the launch owner');
  } finally {
    await host.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

test('Desktop launches only the Runtime-resolved exact source and reports launch separately from opening', async () => {
  const installedSelector = new Uint8Array([1, 2, 3]);
  const localSelector = new Uint8Array(32).fill(0xab);
  const installedCalls: Uint8Array[] = [];
  const localCalls: string[] = [];
  let target: { sourceClass: 'installed' | 'local-development'; launchSelector: Uint8Array; appId: string } | Error = {
    sourceClass: 'installed', launchSelector: installedSelector, appId: 'com.example.studio',
  };
  let runState = 'running';
  const launch = createDesktopAppActivitySourceLaunch({
    resolve: () => async () => {
      if (target instanceof Error) throw target;
      return target;
    },
    launchInstalled: () => async (selector) => {
      installedCalls.push(selector);
      return { state: runState };
    },
    startLocalDevelopment: () => async (registrationHandle) => {
      localCalls.push(registrationHandle);
      return registrationHandle === 'ab'.repeat(32);
    },
  });
  assert.deepEqual(await launch('aor_request'), { status: 'requested' });
  assert.equal(installedCalls[0], installedSelector);
  runState = 'crashed';
  assert.deepEqual(await launch('aor_request'), { status: 'failed', reason: 'launch-failed' });
  target = { sourceClass: 'local-development', launchSelector: localSelector, appId: 'com.example.studio' };
  assert.deepEqual(await launch('aor_request'), { status: 'requested' });
  assert.deepEqual(localCalls, ['ab'.repeat(32)]);
  target = new Error('open request unavailable');
  assert.deepEqual(await launch('aor_request'), { status: 'failed', reason: 'launch-failed' });
  const noRuntime = createDesktopAppActivitySourceLaunch({
    resolve: () => undefined,
    launchInstalled: () => undefined,
    startLocalDevelopment: () => undefined,
  });
  assert.deepEqual(await noRuntime('aor_request'), { status: 'unavailable', reason: 'host-unavailable' });
});

async function post(
  endpoint: string,
  token: string,
  value: unknown,
  requestPath = '/v1/open-intent',
): Promise<Response> {
  return await fetch(`${endpoint}${requestPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
}
