import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:owner-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    avatarInstanceId: 'zhiyu-avatar-local-agent-owner-1-agent-1',
    launchSource: 'zhiyu',
  });
  assert.doesNotMatch(JSON.stringify(handoff.payload), /conversationAnchorId|must-stay-in-runtime|accessToken|subjectUserId|runtimeAppId/);
});

test('Zhiyu registers the Runtime live instance before invoking the Avatar host', async () => {
  const { projectZhiyuAvatarLaunchAction } = await loadSourceModule('src/shell/avatar/avatar-launch.ts');
  const { launchZhiyuAvatar } = await loadSourceModule('src/shell/avatar/avatar-launch-handoff.ts');
  const evidence = readyEvidence();
  const action = projectZhiyuAvatarLaunchAction(evidence);
  const calls = [];
  globalThis.__nimiZhiyuRuntimeAgentBinding = {
    hostEquivalence: {
      evidenceRef: 'runtime-sdk-authority:test-host',
      authority: 'runtime-sdk',
      failureSemantics: 'fail-closed',
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
    assert.deepEqual(calls[0].options, {
      metadata: {
        'x-nimi-runtime-host-equivalence': 'runtime-sdk-authority:test-host',
      },
    });
    assert.doesNotMatch(JSON.stringify(calls[1].payload), /conversationAnchorId|must-stay-in-runtime|accessToken|subjectUserId|runtimeAppId/);
  } finally {
    delete globalThis.__nimiZhiyuRuntimeAgentBinding;
  }
});

test('Zhiyu Avatar host bridge prepares only the minimal Avatar Electron environment', async () => {
  const { buildZhiyuAvatarElectronLaunchEnvironment } = await loadSourceModule('src-electron/avatar-launch-handoff.ts');

  const env = buildZhiyuAvatarElectronLaunchEnvironment({
    runtimeEndpoint: '127.0.0.1:46371',
    dataRoot: 'D:/tmp/zhiyu-standard',
    payload: {
      agentId: 'local-agent:owner-1:agent-1',
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:owner-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      avatarInstanceId: 'zhiyu-avatar-local-agent-owner-1-agent-1',
      launchSource: 'zhiyu',
    },
  });

  assert.equal(env.NIMI_RUNTIME_GRPC_ADDR, '127.0.0.1:46371');
  assert.equal(env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_OWNER_USER_ID, 'user-1');
  assert.equal(env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF, 'runtime-source:owner-1');
  assert.equal(env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_REF, 'local-agent:owner-1:agent-1');
  assert.equal(env.NIMI_AVATAR_ELECTRON_AVATAR_INSTANCE_ID, 'zhiyu-avatar-local-agent-owner-1-agent-1');
  assert.equal(env.NIMI_AVATAR_ELECTRON_LAUNCH_SOURCE, 'zhiyu');
  assert.ok(env.NIMI_AVATAR_ELECTRON_AGENT_CENTER_DATA_ROOT.endsWith('tmp\\zhiyu-standard') || env.NIMI_AVATAR_ELECTRON_AGENT_CENTER_DATA_ROOT.endsWith('tmp/zhiyu-standard'));
  assert.ok(env.NIMI_AVATAR_ELECTRON_STANDARD_DATA_ROOT.includes('zhiyu-avatar-local-agent-owner-1-agent-1'));
  assert.doesNotMatch(JSON.stringify(env), /conversationAnchorId|accessToken|subjectUserId|runtimeAppId/);
});

test('Zhiyu Avatar source keeps the launch handoff public and does not import Desktop private bridge truth', () => {
  const avatarLaunch = readFileSync(path.join(root, 'src/shell/avatar/avatar-launch.ts'), 'utf8');
  const handoff = readFileSync(path.join(root, 'src/shell/avatar/avatar-launch-handoff.ts'), 'utf8');
  const electron = readFileSync(path.join(root, 'src-electron/avatar-launch-handoff.ts'), 'utf8');
  const preload = readFileSync(path.join(root, 'src-electron/preload.cts'), 'utf8');
  const all = `${avatarLaunch}\n${handoff}\n${electron}\n${preload}`;
  const avatarHandoffSurfaces = `${avatarLaunch}\n${handoff}\n${electron}`;

  assert.match(avatarLaunch, /buildAvatarLaunchInstanceId/);
  assert.match(handoff, /buildAvatarLaunchHandoffPayload/);
  assert.match(electron, /parseAvatarLaunchHandoffPayload/);
  assert.match(preload, /__nimiZhiyuAvatarLaunchHandoff/);
  assert.doesNotMatch(all, /apps\/desktop|@renderer\/|desktop_avatar_launch_handoff|runtime\/internal/);
  assert.doesNotMatch(all, /conversationAnchorId:\s*payload|NIMI_AVATAR_ELECTRON_CONVERSATION|accessToken/);
  assert.doesNotMatch(avatarHandoffSurfaces, /scopedBinding/);
});
