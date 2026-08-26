import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

async function loadSourceModule(relativePath) {
  const sourcePath = path.join(root, relativePath);
  const output = buildSync({
    entryPoints: [sourcePath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
    alias: {
      '@nimiplatform/kit/features/avatar/headless': path.join(repoRoot, 'kit/features/avatar/src/headless.ts'),
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}

function readyEvidence(overrides = {}) {
  return {
    localAgent: {
      ready: true,
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:owner-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
    },
    conversation: {
      ready: true,
      agentHandle: `agent_ref_${'a'.repeat(43)}`,
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:owner-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'conversation-anchor:must-stay-in-runtime',
    },
    avatar: {
      launchAvailable: true,
    },
    ...overrides,
  };
}

test('Zhiyu projects a ready Avatar action with a Runtime-anchor-free instance id', async () => {
  const { projectZhiyuAvatarLaunchAction } = await loadSourceModule('src/shell/avatar/avatar-launch.ts');

  const action = projectZhiyuAvatarLaunchAction(readyEvidence());

  assert.equal(action.state, 'ready');
  assert.equal(action.reasonCode, 'zhiyu-avatar-launch-ready');
  assert.equal(action.avatarInstanceId, 'zhiyu-avatar-local-agent-owner-1-agent-1');
  assert.doesNotMatch(action.avatarInstanceId, /conversation-anchor|must-stay-in-runtime/);
});

test('Zhiyu builds Runtime live-instance registration separately from the Avatar host payload', async () => {
  const { projectZhiyuAvatarLaunchAction } = await loadSourceModule('src/shell/avatar/avatar-launch.ts');
  const { buildZhiyuAvatarLaunchHandoff } = await loadSourceModule('src/shell/avatar/avatar-launch-handoff.ts');
  const evidence = readyEvidence();
  const action = projectZhiyuAvatarLaunchAction(evidence);

  const handoff = buildZhiyuAvatarLaunchHandoff({ evidence, action });

  assert.deepEqual(handoff.registerLiveInstance, {
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:owner-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'conversation-anchor:must-stay-in-runtime',
    avatarInstanceId: 'zhiyu-avatar-local-agent-owner-1-agent-1',
  });
  assert.deepEqual(handoff.payload, {
    agentId: 'local-agent:owner-1:agent-1',
    agentHandle: `agent_ref_${'a'.repeat(43)}`,
    conversationAnchorId: 'conversation-anchor:must-stay-in-runtime',
    avatarInstanceId: 'zhiyu-avatar-local-agent-owner-1-agent-1',
    launchSource: 'zhiyu',
  });
  assert.doesNotMatch(JSON.stringify(handoff.payload), /accessToken|subjectUserId|runtimeAppId|ownerUserId|runtimeSourceRef|localAgentRef/);
});

test('Zhiyu registers the Runtime live instance before invoking the Avatar host', async () => {
  const { projectZhiyuAvatarLaunchAction } = await loadSourceModule('src/shell/avatar/avatar-launch.ts');
  const { launchZhiyuAvatar } = await loadSourceModule('src/shell/avatar/avatar-launch-handoff.ts');
  const evidence = readyEvidence();
  const action = projectZhiyuAvatarLaunchAction(evidence);
  const calls = [];
  globalThis.__nimiZhiyuRuntimeAgentAccess = {
    localAppCarrier: {
      kind: 'protected-local-app-carrier',
    },
  };
  try {
    const result = await launchZhiyuAvatar({
      evidence,
      action,
      runtimeAgent: {
        anchors: {
          registerAvatarLiveInstance: async (input, options) => {
            calls.push({ kind: 'register', input, options });
            return { binding: {}, snapshot: {} };
          },
        },
      },
      invokeHost: async (payload) => {
        calls.push({ kind: 'host', payload });
        return {
          opened: true,
          avatarInstanceId: payload.avatarInstanceId,
          handoffUri: 'electron:avatar',
          launchSource: payload.launchSource,
          pid: 777,
        };
      },
    });

    assert.equal(result.state, 'opened');
    assert.deepEqual(calls.map((call) => call.kind), ['register', 'host']);
    assert.deepEqual(calls[0].input, {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:owner-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'conversation-anchor:must-stay-in-runtime',
      avatarInstanceId: 'zhiyu-avatar-local-agent-owner-1-agent-1',
    });
    assert.deepEqual(calls[0].options, {});
    assert.doesNotMatch(JSON.stringify(calls[1].payload), /accessToken|subjectUserId|runtimeAppId|ownerUserId|runtimeSourceRef|localAgentRef/);
  } finally {
    delete globalThis.__nimiZhiyuRuntimeAgentAccess;
  }
});
