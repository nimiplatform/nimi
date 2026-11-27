import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readdir, readFile, realpath, rm, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { NimiDesktopOpenIntentEnvelope } from '@nimiplatform/kit/core/desktop-open';
import type { AvatarHostHandoffRequest } from '@nimiplatform/kit/features/avatar/headless';
import {
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import {
  DESKTOP_AGENT_CENTER_RESOURCE_PACK_PLACEMENT_PATH,
  openElectronDesktopIntent,
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
import { writeOwnerPrivateAtomicJson } from '../src-electron/owner-private-atomic-json';
import type { DesktopAvatarHostHandoffDispatch } from '../src-electron/bundled-avatar-host';

const envelope: NimiDesktopOpenIntentEnvelope = {
  schemaVersion: 2,
  sourceApp: 'nimi.zhiyu',
  sourceHost: 'desktop-electron-local-app-host',
  requestId: 'desktop-open-zhiyu-test-1',
  intent: {
    kind: 'open-partners',
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
  const diagnostics: string[] = [];
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
    writeStderr: (line) => { diagnostics.push(line); },
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

    assert.deepEqual(diagnostics.map((line) => JSON.parse(line.slice('[desktop-open] '.length))), [{
      stage: 'renderer-not-ready', ready: false, heartbeatAgeMs: null,
    }]);

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

    const retiredTauriSource = await post(descriptor.endpoint, descriptor.token, {
      schemaVersion: 2,
      sourceApp: 'nimi.test-launcher',
      sourceHost: 'tauri-standard-shell',
      requestId: 'desktop-open-reject-tauri',
      intent: { kind: 'open-runtime-config', page: 'models', action: 'install-model' },
    });
    assert.equal(retiredTauriSource.status, 200);
    assert.deepEqual(await retiredTauriSource.json(), {
      status: 'rejected',
      bridgeId: descriptor.bridgeId,
      reasonCode: 'desktop-open-intent-invalid',
      actionHint: 'fix_desktop_open_intent',
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
    assert.deepEqual(JSON.parse(diagnostics.at(-1)!.slice('[desktop-open] '.length)), {
      stage: 'renderer-heartbeat-expired', ready: true, heartbeatAgeMs: 10_001,
    });
  } finally {
    await host.shutdown();
    await assert.rejects(readFile(descriptorPath, 'utf8'), { code: 'ENOENT' });
    await rm(home, { recursive: true, force: true });
  }
});

test('Desktop Open dispatch failure remains rejected and records only finite owner state', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-desktop-open-dispatch-')));
  const diagnostics: string[] = [];
  const now = Date.parse('2026-10-06T12:00:00.000Z');
  let emitted = false;
  const host = await createDesktopElectronOpenIntentHost({
    homeDirectory: home,
    now: () => now,
    writeStderr: (line) => { diagnostics.push(line); },
    focusMainWindow: async () => { throw new Error('PRIVATE_FOCUS_ERROR'); },
    emitIntent: () => { emitted = true; },
  });
  try {
    const descriptor = JSON.parse(await readFile(path.join(home, '.nimi', 'run', 'desktop', 'open-intent', 'presence.v1.json'), 'utf8'));
    host.commandHandlers.desktop_open_intent_set_ready({ command: 'desktop_open_intent_set_ready', payload: { ready: true } });
    const result = await post(descriptor.endpoint, descriptor.token, envelope);
    assert.equal((await result.json()).reasonCode, 'desktop-open-desktop-not-ready');
    assert.equal(emitted, false);
    assert.deepEqual(JSON.parse(diagnostics[0]!.slice('[desktop-open] '.length)), {
      stage: 'desktop-dispatch-failed', ready: true, heartbeatAgeMs: 0,
    });
    assert.doesNotMatch(diagnostics.join(''), /PRIVATE_FOCUS_ERROR|nimi\.zhiyu|desktop-open-zhiyu-test-1|open-explore/);
    const next = await post(descriptor.endpoint, descriptor.token, envelope);
    assert.equal((await next.json()).reasonCode, 'desktop-open-desktop-not-ready');
    assert.equal(JSON.parse(diagnostics[1]!.slice('[desktop-open] '.length)).stage, 'renderer-not-ready');
  } finally {
    await host.shutdown();
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

test('open-partner-conversation dispatches directly to bundled Zhiyu without focusing Home and keeps renderer ready on unreached handoff', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-zhiyu-handoff-')));
  const descriptorPath = path.join(home, '.nimi', 'run', 'desktop', 'open-intent', 'presence.v1.json');
  let focusCount = 0;
  const emitted: NimiDesktopOpenIntentEnvelope[] = [];
  const handoffs: { conversationAnchorId: string; text?: string }[] = [];
  let shouldFailZhiyu = false;

  const host = await createDesktopElectronOpenIntentHost({
    homeDirectory: home,
    heartbeatIntervalMs: 60_000,
    readinessTtlMs: 10_000,
    writeStderr: () => undefined,
    focusMainWindow: async () => { focusCount += 1; },
    emitIntent: (value) => emitted.push(value),
    openPartnerConversation: async (target) => {
      handoffs.push(target);
      if (shouldFailZhiyu) throw new Error('zhiyu-target-not-reached');
    },
  });

  try {
    host.commandHandlers.desktop_open_intent_set_ready({
      command: 'desktop_open_intent_set_ready',
      payload: { ready: true },
    });
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as {
      endpoint: string;
      token: string;
      bridgeId: string;
    };

    const okResponse = await post(descriptor.endpoint, descriptor.token, {
      schemaVersion: 2,
      sourceApp: 'nimi.utopia',
      sourceHost: 'electron-standard-shell',
      requestId: 'desktop-open-utopia-chat-ok',
      intent: {
        kind: 'open-partner-conversation',
        conversationAnchorId: 'anchor_utopia_1',
        text: '海风正好，一起聊聊？',
      },
    });
    assert.equal(okResponse.status, 200);
    assert.deepEqual(await okResponse.json(), {
      status: 'accepted',
      confirmation: 'desktop-accepted',
      bridgeId: descriptor.bridgeId,
      requestId: 'desktop-open-utopia-chat-ok',
      appliedTarget: 'open-partner-conversation',
    });
    assert.equal(focusCount, 0, 'Home main window must not steal focus over bundled Zhiyu');
    assert.equal(emitted.length, 0, 'Home renderer navigation must not be mutated');
    assert.deepEqual(handoffs, [{
      conversationAnchorId: 'anchor_utopia_1',
      text: '海风正好，一起聊聊？',
    }]);

    // When Zhiyu rejects arrival, handoff returns rejected without marking Home renderer unready
    shouldFailZhiyu = true;
    const failedHandoff = await post(descriptor.endpoint, descriptor.token, {
      schemaVersion: 2,
      sourceApp: 'nimi.utopia',
      sourceHost: 'electron-standard-shell',
      requestId: 'desktop-open-utopia-chat-fail',
      intent: {
        kind: 'open-partner-conversation',
        conversationAnchorId: 'anchor_missing',
      },
    });
    assert.equal(failedHandoff.status, 200);
    assert.deepEqual(await failedHandoff.json(), {
      status: 'rejected',
      bridgeId: descriptor.bridgeId,
      reasonCode: 'desktop-open-desktop-not-ready',
      actionHint: 'wait_for_desktop_ready',
    });

    // Subsequent Home navigation intent still succeeds immediately because Home readiness was preserved
    const homeResponse = await post(descriptor.endpoint, descriptor.token, envelope);
    assert.equal(homeResponse.status, 200);
    assert.equal((await homeResponse.json() as { status: string }).status, 'accepted');
    assert.equal(focusCount, 1);
    assert.equal(emitted.length, 1);
  } finally {
    await host.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

test('Desktop Open periodic liveness presence skips fsync while preserving default durable fsync and stale/auth/readiness/hidden-Home-reveal semantics', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-desktop-open-presence-')));
  const descriptorPath = path.join(home, '.nimi', 'run', 'desktop', 'open-intent', 'presence.v1.json');
  let now = Date.parse('2026-11-27T10:00:00.000Z');
  let windowVisible = false;
  const lifecycleEvents: string[] = [];
  const emitted: NimiDesktopOpenIntentEnvelope[] = [];
  const diagnostics: string[] = [];

  try {
    await withFileHandleSyncCounter(async (getSyncCalls) => {
      const host = await createDesktopElectronOpenIntentHost({
        homeDirectory: home,
        now: () => now,
        heartbeatIntervalMs: 15,
        readinessTtlMs: 10_000,
        writeStderr: (line) => { diagnostics.push(line); },
        focusMainWindow: async () => {
          windowVisible = true;
          lifecycleEvents.push('focus-revealed');
        },
        emitIntent: (value) => {
          lifecycleEvents.push('emit-intent');
          emitted.push(value);
        },
      });
      try {
        const initialDescriptor = await readPresenceDescriptor(descriptorPath);
        assert.equal(initialDescriptor.lastHeartbeatAt, '2026-11-27T10:00:00.000Z');
        assert.equal(getSyncCalls(), 0, 'Desktop Open initial presence write must not fsync');

        // Advance clock across two real periodic heartbeat intervals.
        now += 3_000;
        const firstHeartbeat = await waitForPresenceHeartbeat(descriptorPath, '2026-11-27T10:00:03.000Z');
        now += 3_000;
        const secondHeartbeat = await waitForPresenceHeartbeat(descriptorPath, '2026-11-27T10:00:06.000Z');

        assert.equal(firstHeartbeat.bridgeId, initialDescriptor.bridgeId);
        assert.equal(secondHeartbeat.bridgeId, initialDescriptor.bridgeId);
        assert.equal(secondHeartbeat.endpoint, initialDescriptor.endpoint);
        assert.equal(secondHeartbeat.token, initialDescriptor.token);
        assert.equal(secondHeartbeat.startedAt, initialDescriptor.startedAt);
        assert.equal(getSyncCalls(), 0, 'Desktop Open periodic liveness heartbeats must skip fsync');

        if (process.platform !== 'win32') {
          assert.equal((await stat(path.dirname(descriptorPath))).mode & 0o777, 0o700);
          assert.equal((await stat(descriptorPath)).mode & 0o777, 0o600);
        }

        // Default durable writers using owner-private-atomic-json still fsync.
        await writeOwnerPrivateAtomicJson(
          path.join(home, '.nimi', 'run', 'desktop', 'durable-sentinel.json'),
          { schema: 'durable-sentinel/v1', ok: true },
          'durable-sentinel',
        );
        assert.equal(getSyncCalls(), 1, 'default owner-private atomic JSON write must remain durable');

        // Kit consumer stale endpoint expiration check rejects stale presence without calling fetch.
        let staleFetchCalled = false;
        const staleResult = await openElectronDesktopIntent({
          appId: 'nimi.zhiyu',
          command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
          payload: {
            requestId: 'desktop-open-stale-presence',
            intent: envelope.intent,
          },
          host: {
            capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
            desktopOpen: {
              descriptorPath,
              now: () => now + 10_001,
              fetch: async () => {
                staleFetchCalled = true;
                throw new Error('stale descriptor must not invoke fetch');
              },
            },
          },
        });
        assert.deepEqual(staleResult, {
          status: 'rejected',
          reasonCode: 'desktop-open-desktop-not-running',
          actionHint: 'open_desktop_first',
        });
        assert.equal(staleFetchCalled, false);

        // Loopback bearer credential protection still rejects invalid token without revealing Home.
        const unauthorized = await post(secondHeartbeat.endpoint, 'wrong-bearer-token', envelope);
        assert.equal(unauthorized.status, 401);
        assert.deepEqual(await unauthorized.json(), {
          status: 'rejected',
          bridgeId: secondHeartbeat.bridgeId,
          reasonCode: 'desktop-open-bridge-auth-failed',
          actionHint: 'check_desktop_runtime_bridge',
        });
        assert.equal(windowVisible, false);
        assert.deepEqual(emitted, []);

        // Renderer readiness check still rejects before ready without revealing hidden Home.
        const notReadyResult = await openElectronDesktopIntent({
          appId: 'nimi.zhiyu',
          command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
          payload: {
            requestId: envelope.requestId,
            intent: envelope.intent,
          },
          host: {
            capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
            desktopOpen: {
              descriptorPath,
              now: () => now,
            },
          },
        });
        assert.deepEqual(notReadyResult, {
          status: 'rejected',
          reasonCode: 'desktop-open-desktop-not-ready',
          actionHint: 'wait_for_desktop_ready',
        });
        assert.equal(windowVisible, false);
        assert.deepEqual(emitted, []);

        // Once renderer is ready, Kit consumer reaches loopback with bearer token, reveals hidden Home before emitting intent.
        host.commandHandlers.desktop_open_intent_set_ready({
          command: 'desktop_open_intent_set_ready',
          payload: { ready: true },
        });
        const acceptedResult = await openElectronDesktopIntent({
          appId: 'nimi.zhiyu',
          command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
          payload: {
            requestId: envelope.requestId,
            intent: envelope.intent,
          },
          host: {
            capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
            desktopOpen: {
              descriptorPath,
              now: () => now,
            },
          },
        });
        assert.deepEqual(acceptedResult, {
          status: 'accepted',
          confirmation: 'desktop-accepted',
          bridgeId: secondHeartbeat.bridgeId,
          requestId: envelope.requestId,
          appliedTarget: envelope.intent.kind,
        });
        assert.equal(windowVisible, true);
        assert.deepEqual(lifecycleEvents, ['focus-revealed', 'emit-intent']);
        assert.deepEqual(emitted, [envelope]);
        assert.equal(diagnostics.length, 1);
      } finally {
        await host.shutdown();
      }
      assert.deepEqual(await readdir(path.dirname(descriptorPath)), []);
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

type PresenceDescriptorSnapshot = {
  readonly schemaVersion: number;
  readonly desktopAppId: string;
  readonly bridgeId: string;
  readonly endpoint: string;
  readonly token: string;
  readonly startedAt: string;
  readonly lastHeartbeatAt: string;
};

async function readPresenceDescriptor(descriptorPath: string): Promise<PresenceDescriptorSnapshot> {
  return JSON.parse(await readFile(descriptorPath, 'utf8')) as PresenceDescriptorSnapshot;
}

async function waitForPresenceHeartbeat(
  descriptorPath: string,
  expectedHeartbeatAt: string,
  timeoutMs = 3_000,
): Promise<PresenceDescriptorSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = '';
  while (Date.now() < deadline) {
    try {
      const descriptor = await readPresenceDescriptor(descriptorPath);
      lastSeen = descriptor.lastHeartbeatAt;
      if (descriptor.lastHeartbeatAt === expectedHeartbeatAt) {
        return descriptor;
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT' && code !== 'EPERM' && code !== 'EBUSY') {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for Desktop Open heartbeat ${expectedHeartbeatAt}; last seen ${lastSeen || '<none>'}`);
}

async function withFileHandleSyncCounter<T>(
  run: (getSyncCalls: () => number) => Promise<T>,
): Promise<T> {
  const probeDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-desktop-open-sync-probe-')));
  const probeFile = path.join(probeDir, 'probe');
  let proto: { sync: () => Promise<void> };
  const handle = await open(probeFile, 'w');
  try {
    proto = Object.getPrototypeOf(handle) as { sync: () => Promise<void> };
  } finally {
    await handle.close();
    await rm(probeDir, { recursive: true, force: true });
  }
  const originalSync = proto.sync;
  let syncCalls = 0;
  proto.sync = async function (this: unknown) {
    syncCalls += 1;
    return await originalSync.call(this);
  };
  try {
    return await run(() => syncCalls);
  } finally {
    proto.sync = originalSync;
  }
}

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
