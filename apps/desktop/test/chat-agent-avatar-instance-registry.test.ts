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

function installTauriInvokeMock(
  handler: (command: string, payload?: unknown) => Promise<unknown> | unknown,
): () => void {
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__NIMI_TAURI_TEST__;
  const previousWindow = globalRecord.window;
  globalRecord.__NIMI_TAURI_TEST__ = {
    invoke: handler,
  };
  globalRecord.window = {
    __NIMI_TAURI_TEST__: globalRecord.__NIMI_TAURI_TEST__,
  };
  return () => {
    if (typeof previousTauri === 'undefined') {
      delete globalRecord.__NIMI_TAURI_TEST__;
    } else {
      globalRecord.__NIMI_TAURI_TEST__ = previousTauri;
    }
    if (typeof previousWindow === 'undefined') {
      delete globalRecord.window;
    } else {
      globalRecord.window = previousWindow;
    }
  };
}

test('desktop avatar live instance parser rejects missing minimal identity', () => {
  assert.throws(() => {
    parseDesktopAvatarLiveInstanceRecord({
      avatarInstanceId: 'instance-1',
    });
  }, /agentId/);
});

test('desktop avatar live instance parser rejects old authority fields', () => {
  assert.throws(() => {
    parseDesktopAvatarLiveInstanceRecord({
      avatarInstanceId: 'instance-1',
      agentId: 'agent-1',
      launchSource: 'desktop-agent-chat',
      conversationAnchorId: 'anchor-1',
    });
  }, /forbidden authority field: conversationAnchorId/);

  assert.throws(() => {
    parseDesktopAvatarLiveInstanceRecord({
      avatarInstanceId: 'instance-1',
      agentId: 'agent-1',
      avatarPackageId: 'live2d_ab12cd34ef56',
    });
  }, /forbidden authority field: avatarPackageId/);
});

test('desktop avatar live instance bridge rejects authority-bearing projection records', async () => {
  const restore = installTauriInvokeMock(async () => [{
    avatarInstanceId: 'instance-1',
    agentId: 'agent-1',
    bindingId: 'binding-1',
  }]);

  try {
    await assert.rejects(
      listDesktopAvatarLiveInstances('agent-1'),
      /forbidden authority field: bindingId/,
    );
  } finally {
    restore();
  }
});

test('desktop avatar ephemeral instance id extends deterministic base with nonce', () => {
  const instanceId = buildDesktopAvatarEphemeralInstanceId({
    agentId: 'agent-1',
    threadId: 'thread-1',
    nonce: 'wave-4',
  });

  assert.equal(instanceId, 'desktop-avatar-agent-1-thread-1-wave-4');
});

test('desktop avatar close handoff parser rejects invalid payload', () => {
  assert.throws(() => parseDesktopAvatarCloseHandoffResult(null), /invalid payload/);
});

test('desktop avatar close handoff bridge invokes fixed command and payload shape', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  const restore = installTauriInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    return {
      opened: true,
      handoffUri: 'nimi-avatar://close?avatar_instance_id=instance-1',
    };
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
      payload: {
        payload: {
          avatarInstanceId: 'instance-1',
          closedBy: 'desktop',
          sourceSurface: 'desktop-agent-chat',
        },
      },
    }]);
  } finally {
    restore();
  }
});

test('desktop avatar close handoff failure does not invoke unrelated bridge commands', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  const restore = installTauriInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    throw new Error('close failed');
  });

  try {
    await assert.rejects(
      closeDesktopAvatarHandoff({
        avatarInstanceId: 'instance-1',
        closedBy: 'desktop',
        sourceSurface: 'desktop-agent-chat',
      }),
      /close failed/,
    );
    assert.equal(calls[0]?.command, 'desktop_avatar_close_handoff');
    assert.deepEqual(calls[0]?.payload, {
      payload: {
        avatarInstanceId: 'instance-1',
        closedBy: 'desktop',
        sourceSurface: 'desktop-agent-chat',
      },
    });
    assert.ok(!calls.some(({ command }) => (
      command === 'desktop_agent_center_background_import'
      || command === 'desktop_agent_center_config_put'
      || command === 'runtime_bridge_unary'
      || command === 'desktop_avatar_launch_handoff'
    )));
  } finally {
    restore();
  }
});

test('desktop avatar live instance bridge invokes fixed command and payload shape', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  const restore = installTauriInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    return [{
      avatarInstanceId: 'instance-1',
      agentId: 'agent-1',
      launchSource: 'desktop-agent-chat',
    }];
  });

  try {
    const instances = await listDesktopAvatarLiveInstances('agent-1');

    assert.equal(instances.length, 1);
    assert.equal(instances[0]?.avatarInstanceId, 'instance-1');
    assert.deepEqual(calls, [{
      command: 'desktop_avatar_instance_registry_list',
      payload: {
        payload: {
          agentId: 'agent-1',
        },
      },
    }]);
  } finally {
    restore();
  }
});
