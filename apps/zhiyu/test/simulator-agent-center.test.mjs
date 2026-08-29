import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createZhiyuCanonicalAgentCenterSession } from '../src/renderer/agent-center-session.ts';
import { createZhiyuSimulatorBindings } from '../src/simulator/bindings.ts';

test('Simulator Agent Center keeps configuration in memory with CAS and fail-closed validation', async () => {
  const cleanup = [];
  const context = simulatorContext(cleanup);
  const bindings = createZhiyuSimulatorBindings(context);
  const home = await bindings.app.projection.loadHome({
    selectedAgentHandle: null,
    previousConversationAnchorId: null,
    isCurrent: () => true,
  });
  const agentHandle = home.localAgent.agentHandle;
  const conversationAnchorId = home.conversation.conversationAnchorId;
  assert.ok(agentHandle);
  assert.ok(conversationAnchorId);
  assert.equal(bindings.app.projection.agentCenterBinding('wrong-handle'), null);

  const binding = bindings.app.projection.agentCenterBinding(agentHandle);
  const session = createZhiyuCanonicalAgentCenterSession(agentHandle, conversationAnchorId, binding);
  assert.ok(session);
  await session.refresh();
  assert.equal(session.getSnapshot().phase, 'ready');
  assert.equal(session.getSnapshot().state.autonomy.revision, '1');
  assert.equal(session.getSnapshot().state.appearance.presentationRevision, '1');
  assert.deepEqual(
    session.getSnapshot().state.appearance.voiceCatalog.options.filter((option) => option.kind === 'voice_asset_id'),
    [{
      reference: 'voice_asset_id:simulator-custom-voice',
      kind: 'voice_asset_id',
      name: 'simulator-custom-voice',
      supportedLangs: [],
    }],
  );
  assert.deepEqual(session.getSnapshot().state.sections, [
    'overview',
    'appearance',
    'behavior',
    'ai-config',
    'cognition',
    'advanced',
  ]);
  assert.equal(session.getSnapshot().state.cognition.lifecycleStatus, 'active');
  assert.equal(session.getSnapshot().state.sourceContext.source?.coverage.completeSections, 3);
  assert.equal(session.getSnapshot().state.cognition.memory?.currentCount, 1);
  assert.equal(session.getSnapshot().state.cognition.memory?.items[0]?.epistemicStatus, 'explicit');
  assert.equal(
    session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0]?.capabilityContract,
    'text.generate',
  );

  await session.overwriteSharedAIConfig({
    expectedRevision: '1',
    capabilities: [{
      capabilityContract: 'text.embed',
      requiredFeatures: [],
      route: { oneofKind: 'local', local: {} },
    }],
  });
  assert.equal(
    session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0]?.capabilityContract,
    'text.embed',
  );

  await session.updateAutonomy({
    expectedRevision: '1',
    enabled: false,
    mode: 'medium',
    dailyTokenBudget: 2048,
    maxTokensPerHook: 256,
  });
  assert.deepEqual(session.getSnapshot().state.autonomy, {
    revision: '2',
    enabled: false,
    mode: 'medium',
    usedTokensInWindow: 0,
    dailyTokenBudget: 2048,
    maxTokensPerHook: 256,
    windowStartedAt: null,
    suspendedUntil: null,
    budgetExhausted: false,
    controlsDisabled: false,
    disabledReason: null,
  });

  await assert.rejects(
    session.updateAutonomy({
      expectedRevision: '2',
      mode: 'turbo',
      dailyTokenBudget: 2048,
      maxTokensPerHook: 256,
    }),
    /ZHIYU_SIMULATOR_AUTONOMY_MODE_INVALID/u,
  );
  assert.equal(session.getSnapshot().state.autonomy.revision, '2');

  assert.equal(typeof session.appearance.setAvatarAutoplay, 'function');
  await session.appearance.setAvatarAutoplay(true);
  assert.equal(session.getSnapshot().state.appearance.presentationRevision, '2');
  assert.equal(session.getSnapshot().state.appearance.avatarAutoplay, true);

  assert.equal(typeof session.appearance.replaceAvatar, 'function');
  await session.appearance.replaceAvatar('vrm');
  assert.equal(session.getSnapshot().state.appearance.presentationRevision, '3');
  assert.equal(session.getSnapshot().state.appearance.backendKind, 'vrm');
  assert.equal(
    session.getSnapshot().state.appearance.avatarAssetRef,
    'vrm_039058c6f2c0',
  );
  assert.equal(session.getSnapshot().state.appearance.renderState, 'ready');

  const memoryId = session.getSnapshot().state.cognition.memory?.items[0]?.memoryId;
  assert.ok(memoryId);
  await session.correctMemory({ memoryId, correctedContent: '模拟伙伴记得你偏好完整但紧凑的回答。' });
  assert.equal(session.getSnapshot().state.cognition.memory?.items[0]?.content, '模拟伙伴记得你偏好完整但紧凑的回答。');
  await session.forgetMemory({ memoryIds: [memoryId], confirmed: true });
  assert.equal(session.getSnapshot().state.cognition.memory?.forgottenCount, 1);
  await session.setMemoryEnabled(false);
  assert.equal(session.getSnapshot().state.cognition.memory?.enabled, false);
  await session.deleteAllMemory({ confirmed: true });
  assert.equal(session.getSnapshot().state.cognition.memory?.items.length, 0);

  session.dispose();
  await assert.rejects(
    session.updateAutonomy({
      expectedRevision: '2',
      enabled: true,
      mode: 'low',
      dailyTokenBudget: 4_096,
      maxTokensPerHook: 512,
    }),
    /invalidated/u,
  );

  for (const dispose of cleanup.reverse()) await dispose();
});

test('Simulator Agent Center uses the canonical App factory, current conversation anchor, and handle-only configure client', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, '../src/simulator/bindings.ts'), 'utf8');
  const canonicalSource = await readFile(path.resolve(import.meta.dirname, '../src/renderer/agent-center-session.ts'), 'utf8');
  assert.doesNotMatch(source, /createAppAgentCenterSession/u);
  assert.match(canonicalSource, /createAppAgentCenterSession\(\{\s*handle: agentHandle,\s*client: binding\.client,\s*\.\.\.\(conversationAnchorId \? \{ conversationAnchorId \} : \{\}\),\s*hostMechanics: binding\.hostMechanics,?\s*\}\)/u);
  assert.doesNotMatch(source, /createFirstPartyAgentCenterSession|createAgentCenterShellAppearanceAdapter|RuntimeLocalAgentIdentityInput/u);
  const configureClient = source.slice(
    source.indexOf('const client: NimiLocalAppAgentConfigureClient'),
    source.indexOf('const hostMechanics: AgentCenterHostMechanics'),
  );
  assert.match(configureClient, /sharedAIConfig:[\s\S]*autonomy:[\s\S]*presentation:[\s\S]*memory:[\s\S]*manager:/u);
  assert.match(configureClient, /presentation:[\s\S]*readAsset\(input\)[\s\S]*presentationAssets\.get\(input\.assetRef\)/u);
  assert.match(configureClient, /kind === 'voice-assets'/u);
  assert.doesNotMatch(source, /voiceAssetsClient|AgentCenterVoiceAssetsClient/u);
  assert.doesNotMatch(configureClient, /ownerUserId|runtimeSourceRef|localAgentRef/u);
});

test('Simulator remints a rotated session handle by the exact previous Conversation anchor', async () => {
  const cleanup = [];
  const bindings = createZhiyuSimulatorBindings(simulatorContext(cleanup));
  const home = await bindings.app.projection.loadHome({
    selectedAgentHandle: `agent_ref_${'c'.repeat(43)}`,
    previousConversationAnchorId: `sim-conversation:agent_ref_${'a'.repeat(43)}`,
    isCurrent: () => true,
  });

  assert.equal(home.localAgent.agentHandle, `agent_ref_${'a'.repeat(43)}`);
  assert.equal(home.conversation.agentHandle, `agent_ref_${'a'.repeat(43)}`);
  assert.equal(home.conversation.conversationAnchorId, `sim-conversation:agent_ref_${'a'.repeat(43)}`);

  await assert.rejects(
    bindings.app.projection.loadHome({
      selectedAgentHandle: `agent_ref_${'c'.repeat(43)}`,
      previousConversationAnchorId: 'sim-conversation:missing',
      isCurrent: () => true,
    }),
    /ZHIYU_SIMULATOR_AGENT_REQUIRED/u,
  );

  for (const dispose of cleanup.reverse()) await dispose();
});

function simulatorContext(cleanup) {
  const scope = Object.freeze({
    domId: (localId) => `zhiyu-test--${localId}`,
    globalName: (localName) => `zhiyu-test--${localName}`,
  });
  const capabilities = readonlySet([]);
  const localization = Object.freeze({ locale: 'zh-CN', language: 'zh', direction: 'ltr' });
  const surfaceLifecycle = Object.freeze({ reportReadyCandidate() {} });
  const kit = Object.freeze({
    protocol: 'nimi.renderer.host/v1',
    scope,
    capabilities,
    localization,
    theme: Object.freeze({ getSnapshot: () => ({}), subscribe: () => () => undefined }),
    overlays: Object.freeze({
      target: Object.freeze({}),
      acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
    }),
    surfaceLifecycle,
    invoke: async () => ({}),
  });
  const projected = Object.freeze({
    protocolRevision: 1,
    scenario: Object.freeze({
      agents: Object.freeze([Object.freeze({
        agentHandle: `agent_ref_${'a'.repeat(43)}`,
        displayName: '模拟伙伴',
      })]),
      responseText: '模拟回复',
    }),
    turnSequence: 0,
    ecosystemReference: null,
    personaReference: null,
    handoff: null,
    carry: null,
  });
  const route = Object.freeze({ pathname: '/', search: Object.freeze([]), fragment: null });
  return Object.freeze({
    protocol: 'nimi.simulator.module/v1',
    moduleId: 'zhiyu',
    instanceId: 'zhiyu-test-instance',
    surfaceId: 'main',
    epoch: 1,
    abortSignal: new AbortController().signal,
    kit,
    commands: Object.freeze({
      async invoke() {
        return { ok: false, error: { code: 'UNEXPECTED_SIMULATOR_COMMAND' } };
      },
    }),
    events: Object.freeze({
      subscribe() {
        return { ok: true, value: () => undefined };
      },
    }),
    cleanup: Object.freeze({
      add(dispose) {
        cleanup.push(dispose);
        return { ok: true, value: { registrationId: `cleanup-${cleanup.length}` } };
      },
    }),
    projection: Object.freeze({
      get: () => projected,
      subscribe: () => () => undefined,
    }),
    route: Object.freeze({
      get: () => route,
      subscribe: () => () => undefined,
    }),
    clock: Object.freeze({ now: () => 1_750_000_000_000 }),
  });
}

function readonlySet(values) {
  const internal = new Set(values);
  let view;
  view = Object.freeze({
    get size() { return internal.size; },
    has: (value) => internal.has(value),
    entries: () => internal.entries(),
    keys: () => internal.keys(),
    values: () => internal.values(),
    forEach(callback, thisArg) {
      internal.forEach((value) => callback.call(thisArg, value, value, view));
    },
    [Symbol.iterator]: () => internal[Symbol.iterator](),
  });
  return view;
}
