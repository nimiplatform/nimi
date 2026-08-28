import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createZhiyuSimulatorBindings } from '../src/simulator/bindings.ts';

test('Simulator Agent Center keeps configuration in memory with CAS and fail-closed validation', async () => {
  const cleanup = [];
  const context = simulatorContext(cleanup);
  const bindings = createZhiyuSimulatorBindings(context);
  const home = await bindings.app.projection.loadHome({ selectedAgentHandle: null });
  const agentHandle = home.localAgent.agentHandle;
  assert.ok(agentHandle);
  assert.equal(bindings.app.projection.agentCenterSession('wrong-handle'), null);

  const session = bindings.app.projection.agentCenterSession(agentHandle);
  assert.ok(session);
  await session.refresh();
  assert.equal(session.getSnapshot().phase, 'ready');
  assert.equal(session.getSnapshot().state.autonomy.revision, '1');
  assert.equal(session.getSnapshot().state.appearance.presentationRevision, '1');
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

test('Simulator Agent Center uses the canonical App factory and handle-only configure client', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, '../src/simulator/bindings.ts'), 'utf8');
  assert.match(source, /createAppAgentCenterSession\(\{ handle: agentHandle, client, hostMechanics \}\)/u);
  assert.doesNotMatch(source, /createFirstPartyAgentCenterSession|createAgentCenterShellAppearanceAdapter|RuntimeLocalAgentIdentityInput/u);
  const configureClient = source.slice(
    source.indexOf('const client: NimiLocalAppAgentConfigureClient'),
    source.indexOf('const hostMechanics: AgentCenterHostMechanics'),
  );
  assert.match(configureClient, /sharedAIConfig:[\s\S]*autonomy:[\s\S]*presentation:[\s\S]*memory:[\s\S]*manager:/u);
  assert.doesNotMatch(configureClient, /ownerUserId|runtimeSourceRef|localAgentRef/u);
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
      ownerUserId: 'sim-owner-1',
      agents: Object.freeze([Object.freeze({
        localAgentRef: 'sim-local-agent-1',
        runtimeSourceRef: 'sim-runtime-source-1',
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
