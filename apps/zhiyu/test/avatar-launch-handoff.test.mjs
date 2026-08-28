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
    },
    conversation: {
      ready: true,
      agentHandle: `agent_ref_${'a'.repeat(43)}`,
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
  assert.equal(action.avatarInstanceId, `zhiyu-avatar-agent-ref-${'a'.repeat(43)}`);
  assert.doesNotMatch(action.avatarInstanceId, /conversation-anchor|must-stay-in-runtime/);
});

test('Zhiyu builds one handle-only Avatar host payload without a second identity path', async () => {
  const { projectZhiyuAvatarLaunchAction } = await loadSourceModule('src/shell/avatar/avatar-launch.ts');
  const { buildZhiyuAvatarLaunchHandoff } = await loadSourceModule('src/shell/avatar/avatar-launch-handoff.ts');
  const evidence = readyEvidence();
  const action = projectZhiyuAvatarLaunchAction(evidence);

  const handoff = buildZhiyuAvatarLaunchHandoff({ evidence, action });

  assert.deepEqual(handoff.payload, {
    agentHandle: `agent_ref_${'a'.repeat(43)}`,
    conversationAnchorId: 'conversation-anchor:must-stay-in-runtime',
    avatarInstanceId: `zhiyu-avatar-agent-ref-${'a'.repeat(43)}`,
    launchSource: 'zhiyu',
  });
  assert.doesNotMatch(JSON.stringify(handoff.payload), /accessToken|subjectUserId|runtimeAppId|ownerUserId|runtimeSourceRef|localAgentRef/);
});

test('Zhiyu invokes the Avatar host with only the canonical handle handoff', async () => {
  const { projectZhiyuAvatarLaunchAction } = await loadSourceModule('src/shell/avatar/avatar-launch.ts');
  const { launchZhiyuAvatar } = await loadSourceModule('src/shell/avatar/avatar-launch-handoff.ts');
  const evidence = readyEvidence();
  const action = projectZhiyuAvatarLaunchAction(evidence);
  const calls = [];
  const result = await launchZhiyuAvatar({
    evidence,
    action,
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
  assert.deepEqual(calls.map((call) => call.kind), ['host']);
  assert.doesNotMatch(JSON.stringify(calls[0].payload), /agentId|accessToken|subjectUserId|runtimeAppId|ownerUserId|runtimeSourceRef|localAgentRef/);
});
