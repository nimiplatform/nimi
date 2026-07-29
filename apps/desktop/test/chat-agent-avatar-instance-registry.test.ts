import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDesktopAvatarEphemeralInstanceId,
  closeDesktopAvatarHandoff,
  parseDesktopAvatarCloseHandoffResult,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher.js';
import {
  listDesktopAvatarLiveInstances,
  parseDesktopAvatarLiveInstanceRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-instance-registry.js';

const AGENT_ID = 'local-agent:opaque-1';

function installElectronInvokeMock(
  handler: (command: string, payload?: unknown) => Promise<unknown> | unknown,
): () => void {
  const globalRecord = globalThis as Record<string, unknown>;
  const previousElectron = globalRecord.__NIMI_ELECTRON_TEST__;
  const previousWindow = globalRecord.window;
  globalRecord.__NIMI_ELECTRON_TEST__ = { invoke: handler, listen: () => () => undefined };
  globalRecord.window = { __NIMI_HTML_BOOT_ID__: 'avatar-instance-registry-test' };
  return () => {
    if (previousElectron === undefined) delete globalRecord.__NIMI_ELECTRON_TEST__;
    else globalRecord.__NIMI_ELECTRON_TEST__ = previousElectron;
    if (previousWindow === undefined) delete globalRecord.window;
    else globalRecord.window = previousWindow;
  };
}

test('desktop avatar live instance parser requires the minimal selector projection', () => {
  assert.throws(
    () => parseDesktopAvatarLiveInstanceRecord({ avatarInstanceId: 'instance-1' }),
    /agentId/,
  );
  assert.deepEqual(parseDesktopAvatarLiveInstanceRecord({
    avatarInstanceId: 'instance-1',
    agentId: AGENT_ID,
    launchSource: 'desktop-agent-chat',
  }), {
    avatarInstanceId: 'instance-1',
    agentId: AGENT_ID,
    launchSource: 'desktop-agent-chat',
  });
});

test('desktop avatar live instance parser rejects authority-bearing projections', () => {
  for (const field of ['ownerUserId', 'runtimeSourceRef', 'localAgentRef', 'conversationAnchorId', 'bindingId']) {
    assert.throws(
      () => parseDesktopAvatarLiveInstanceRecord({
        avatarInstanceId: 'instance-1',
        agentId: AGENT_ID,
        [field]: 'forbidden',
      }),
      /forbidden authority field/,
    );
  }
  assert.throws(
    () => parseDesktopAvatarLiveInstanceRecord({ avatarInstanceId: 'instance-1', agentId: 'agent-1' }),
    /local-agent ref/,
  );
});

test('desktop avatar live instance bridge rejects authority-bearing host records', async () => {
  const restore = installElectronInvokeMock(async () => [{
    avatarInstanceId: 'instance-1',
    agentId: AGENT_ID,
    ownerUserId: 'forbidden',
  }]);
  try {
    await assert.rejects(listDesktopAvatarLiveInstances({ agentId: AGENT_ID }), /forbidden authority field/);
  } finally {
    restore();
  }
});

test('desktop avatar ephemeral instance id extends the deterministic selector id', () => {
  assert.equal(
    buildDesktopAvatarEphemeralInstanceId({ agentId: AGENT_ID, threadId: 'thread-1', nonce: 'wave-4' }),
    'desktop-avatar-local-agent-opaque-1-thread-1-wave-4',
  );
});

test('desktop avatar close handoff invokes the fixed command only', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  const restore = installElectronInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    return { opened: true, handoffUri: 'desktop-supervised-avatar://close/instance-1' };
  });
  try {
    const result = await closeDesktopAvatarHandoff({
      avatarInstanceId: 'instance-1',
      closedBy: 'desktop',
      sourceSurface: 'desktop-agent-chat',
    });
    assert.equal(result.opened, true);
    assert.deepEqual(calls, [{
      command: 'desktop_avatar_close_handoff',
      payload: { payload: { avatarInstanceId: 'instance-1', closedBy: 'desktop', sourceSurface: 'desktop-agent-chat' } },
    }]);
  } finally {
    restore();
  }
  assert.throws(() => parseDesktopAvatarCloseHandoffResult(null), /invalid payload/);
});

test('desktop avatar live instance bridge sends only the Runtime Agent selector', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  const restore = installElectronInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    return [{ avatarInstanceId: 'instance-1', agentId: AGENT_ID, launchSource: 'desktop-agent-chat' }];
  });
  try {
    const instances = await listDesktopAvatarLiveInstances({ agentId: AGENT_ID });
    assert.equal(instances.length, 1);
    assert.deepEqual(calls, [{
      command: 'desktop_avatar_instance_registry_list',
      payload: { payload: { agentId: AGENT_ID } },
    }]);
  } finally {
    restore();
  }
});
