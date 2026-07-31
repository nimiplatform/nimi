import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const groups = ['interact', 'configure', 'memory', 'voice', 'delegate'];

for (const reason of ['reserved_not_admitted', 'unknown', 'not_granted', 'request_pending', 'grant_denied', 'grant_revoked']) {
  test(`Agent Center binding preserves SDK action reason ${reason}`, async () => {
    const { mapZhiyuAgentCenterActionPosture } = await loadBindingModule();
    const mapped = mapZhiyuAgentCenterActionPosture(sdkPosture({ posture: 'unavailable', reason }));
    assert.equal(mapped.updateModelSettings.reason, reason);
    assert.equal(mapped.updateAutonomy.reason, reason);
    assert.equal(mapped.replaceAppearance.reason, reason);
  });
}

test('Agent Center binding routes all non-persistent rejection history back to request', async () => {
  const { mapZhiyuAgentCenterActionPosture } = await loadBindingModule();
  for (const input of [
    { posture: 'prompt', reason: 'not_granted' },
    { posture: 'denied', reason: 'grant_denied' },
    { posture: 'revoked', reason: 'grant_revoked' },
  ]) {
    const projection = mapZhiyuAgentCenterActionPosture(sdkPosture(input));
    assert.equal(projection.requestPermission.state, 'available');
    assert.equal(projection.openPermissionSettings.state, 'unavailable');
  }
});

test('Agent Center binding maps carrier failure to runtime_offline without throwing', async () => {
  const { loadZhiyuAgentCenterActionPosture } = await loadBindingModule();
  const mapped = await loadZhiyuAgentCenterActionPosture(async () => { throw new Error('offline'); });
  assert.equal(mapped.readModelSettings.reason, 'runtime_offline');
});

test('reserved configure posture performs no reserved reads', async () => {
  const { createZhiyuAgentCenterPermissionedSdkSurface } = await loadBindingModule();
  const calls = [];
  const surface = createZhiyuAgentCenterPermissionedSdkSurface({
    agentConfigure: configureClient(calls),
    permissions: permissionClient(calls),
    loadPosture: async () => sdkPosture({ posture: 'unavailable', reason: 'reserved_not_admitted' }),
  });
  assert.deepEqual(await surface.read('opaque-handle'), {});
  assert.deepEqual(calls, []);
});

test('binding composes revisions and preserves blocked, failed, and unavailable readiness', async () => {
  const { createZhiyuAgentCenterPermissionedSdkSurface } = await loadBindingModule();
  for (const state of ['blocked', 'failed', 'unavailable']) {
    const surface = createZhiyuAgentCenterPermissionedSdkSurface({
      agentConfigure: configureClient([], state),
      permissions: permissionClient([]),
      loadPosture: async () => sdkPosture({ posture: 'granted', reason: null }),
    });
    const projection = await surface.read('opaque-handle');
    assert.equal(projection.modelSettings.configurationRevision, '7');
    assert.equal(projection.modelSettings.readiness[0].state, state);
    assert.equal(projection.modelSettings.routeOptions[0].model, 'local/model-b');
    assert.equal(projection.modelSettings.routeOptions[0].label, 'Local model B');
    assert.equal(projection.autonomy.revision, '11');
    assert.equal(projection.appearance.presentationRevision, '13');
  }
});

test('binding routes model, autonomy, and atomic appearance mutations', async () => {
  const { createZhiyuAgentCenterPermissionedSdkSurface } = await loadBindingModule();
  const calls = [];
  const surface = createZhiyuAgentCenterPermissionedSdkSurface({
    agentConfigure: configureClient(calls),
    permissions: permissionClient(calls),
    loadPosture: async () => sdkPosture({ posture: 'granted', reason: null }),
  });
  await surface.updateConfiguration('opaque-handle', {
    expectedConfigurationRevision: '7',
    routeIntents: [{ capability: 'text.generate', routePolicy: 'cloud', provider: 'connector-b', model: 'model-b' }],
  });
  await surface.updateAutonomy('opaque-handle', {
    expectedRevision: '11', enabled: false, mode: 'low', dailyTokenBudget: 600, maxTokensPerHook: 60,
  });
  await surface.replaceAppearance('opaque-handle', {
    expectedRevision: '13', intent: { backgroundAssetReference: 'background:new' }, importedAssets: [],
  });
  assert.ok(calls.includes('updateConfiguration:7:connector-b:model-b'));
  assert.ok(calls.includes('updateAutonomy:11:low:600:60'));
  assert.ok(calls.includes('commitPresentation:13:background:new'));
  assert.ok(!calls.some((entry) => entry.startsWith('previewPresentation')));
});

test('configure request action uses the public SDK permission request shape', async () => {
  const { createZhiyuAgentCenterPermissionedSdkSurface, ZHIYU_AGENTS_CONFIGURE_REASON } = await loadBindingModule();
  const calls = [];
  const surface = createZhiyuAgentCenterPermissionedSdkSurface({
    agentConfigure: configureClient(calls),
    permissions: permissionClient(calls),
    loadPosture: async () => sdkPosture({ posture: 'prompt', reason: 'not_granted' }),
  });
  await surface.requestPermission('opaque-handle');
  const actionCalls = calls.filter((call) => typeof call !== 'string' || !call.includes('Snapshot'));
  assert.equal(actionCalls[0].permissionId, 'agents.configure');
  assert.equal(actionCalls[0].reason, ZHIYU_AGENTS_CONFIGURE_REASON);
  const manifest = await readFile(path.join(root, 'nimi.app.yaml'), 'utf8');
  const manifestReason = manifest.match(/- id: agents\.configure\r?\n\s+reason:\s*(.+)$/mu)?.[1]?.trim();
  assert.equal(manifestReason, ZHIYU_AGENTS_CONFIGURE_REASON);
  assert.deepEqual(Object.keys(actionCalls[0]).sort(), ['permissionId', 'reason']);
  assert.equal(actionCalls.length, 1);
});

test('scripted SDK posture events project granted to prompt requestability', async () => {
  const { createZhiyuAgentCenterPermissionedSdkSurface } = await loadBindingModule();
  const calls = [];
  let emit;
  const surface = createZhiyuAgentCenterPermissionedSdkSurface({
    agentConfigure: configureClient(calls),
    permissions: permissionClient(calls, (listener) => { emit = listener; }),
    loadPosture: async () => sdkPosture({ posture: 'granted', reason: null }),
  });
  const events = [];
  const unsubscribe = surface.subscribeActionPosture('opaque-handle', (posture) => events.push(posture));
  emit(sdkPosture({ posture: 'granted', reason: null }));
  emit(sdkPosture({ posture: 'prompt', reason: 'not_granted' }));
  assert.deepEqual(events.map((event) => event.updateModelSettings), [
    { state: 'available', reason: null },
    { state: 'unavailable', reason: 'not_granted' },
  ]);
  assert.equal(events[1].requestPermission.state, 'available');
  unsubscribe();
  assert.ok(calls.includes('unsubscribePermissionPosture'));
});

test('production path returns a sealed Manager Session only for an authorized opaque handle', async () => {
  const { createZhiyuProductionAgentCenterSession } = await loadFactoryModule();
  const { projectZhiyuAuthorizedAgentCenterHandle } = await loadHandleModule();
  globalThis.__zhiyuAgentCenterClient = {
    permissions: {
      ...permissionClient([]),
      agentCapabilityPosture: async () => sdkPosture({ posture: 'unavailable', reason: 'reserved_not_admitted' }),
    },
    agentConfigure: configureClient([]),
  };
  const authorizedHandle = projectZhiyuAuthorizedAgentCenterHandle(resolvedEvidence());
  const updatedEvidenceHandle = projectZhiyuAuthorizedAgentCenterHandle({
    ...resolvedEvidence(),
    chat: { state: 'streaming' },
  });
  assert.equal(authorizedHandle, 'opaque-handle');
  assert.equal(updatedEvidenceHandle, authorizedHandle);
  assert.equal(createZhiyuProductionAgentCenterSession(authorizedHandle).kind, 'manager-session');
  assert.equal(
    createZhiyuProductionAgentCenterSession(
      projectZhiyuAuthorizedAgentCenterHandle(resolvedEvidence({ inventory: { localAgents: [] } })),
    ),
    null,
  );
});

test('production Agent Center path has no private capability stub or dual adapter path', async () => {
  const source = await readFile(path.join(root, 'src/production/agent-center-adapters.ts'), 'utf8');
  assert.doesNotMatch(source, /requireZhiyuLocalAppCapability|runtimeAdapter|permissionedAdapter|permissionPosture/u);
  assert.match(source, /createPermissionedAgentCenterSession/u);
});

async function loadBindingModule() { return loadModule('src/production/agent-center-permissioned-binding.ts'); }
async function loadFactoryModule() { return loadModule('src/production/agent-center-adapters.ts'); }
async function loadHandleModule() { return loadModule('src/shell/agent/agent-center-handle.ts'); }

async function loadModule(entry) {
  const output = (await build({
    entryPoints: [path.join(root, entry)], bundle: true, format: 'esm', platform: 'node', target: 'node22',
    write: false, logLevel: 'silent', plugins: [workspaceStubPlugin()],
  })).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Math.random()}`);
}

function workspaceStubPlugin() {
  return {
    name: 'zhiyu-agent-center-session-stubs',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@nimiplatform\/kit\/features\/agent-center$/ }, () => ({ path: 'kit-stub', namespace: 'stub' }));
      buildApi.onLoad({ filter: /^kit-stub$/, namespace: 'stub' }, () => ({
        loader: 'js',
        contents: `
          export function sealAgentCenterPermissionedSdkSurface(surface) { return Object.freeze(surface); }
          export function createPermissionedAgentCenterSession({handle, surface}) { return {kind:'manager-session', handle, surface}; }
        `,
      }));
      buildApi.onResolve({ filter: /auth\/runtime-platform(?:\.js)?$/ }, () => ({ path: 'runtime-stub', namespace: 'stub' }));
      buildApi.onLoad({ filter: /^runtime-stub$/, namespace: 'stub' }, () => ({
        loader: 'js', contents: 'export function getZhiyuLocalAppClient(){return globalThis.__zhiyuAgentCenterClient;}',
      }));
    },
  };
}

function sdkPosture({ posture, reason }) {
  return Object.fromEntries(groups.map((group) => [group, {
    permissionId: group === 'configure' ? 'agents.configure' : group === 'memory' ? 'memory.read' : 'agents.interact',
    posture, reason, agents: posture === 'granted' ? [{ agentHandle: 'opaque-handle', displayName: '伙伴' }] : [],
  }]));
}

function permissionClient(calls, onSubscribe = null) {
  return {
    async request(input) {
      calls.push(input);
      return { permissionId: input.permissionId, posture: 'pending', canRequest: false, agents: [] };
    },
    subscribeAgentCapabilityPosture(listener) {
      calls.push('subscribePermissionPosture');
      onSubscribe?.(listener);
      return () => { calls.push('unsubscribePermissionPosture'); };
    },
  };
}

function configureClient(calls, readinessState = 'ready') {
  const configuration = {
    capabilities: ['text.generate'],
    routeIntents: [{ capability: 'text.generate', provider: 'connector-a', model: 'model-a', routePolicy: 'cloud' }],
    routeOptions: [{
      capability: 'text.generate', provider: '', model: 'local/model-b',
      routePolicy: 'local', label: 'Local model B', availability: 'ready',
    }],
    readiness: [], configurationRevision: '7',
  };
  const readiness = {
    capabilities: [{ capability: 'text.generate', state: readinessState, reason: readinessState, observedAt: { seconds: '1', nanos: 0 } }],
    configurationRevision: '7',
  };
  const autonomy = {
    enabled: true, config: { dailyTokenBudget: 900, maxTokensPerHook: 90, mode: 'medium' },
    usedTokensInWindow: 50, budgetExhausted: false, autonomyRevision: '11',
  };
  const presentation = {
    profile: {
      backendKind: 'live2d', avatarAssetRef: 'avatar:opaque', expressionProfileRef: 'expression:opaque',
      idlePreset: 'idle:opaque', interactionPolicyRef: 'interaction:opaque', defaultVoiceReference: 'voice:opaque',
      avatarAutoplay: true, backgroundAssetRef: 'background:opaque', revision: '13',
    },
    defaultVoiceReference: 'voice:opaque', presentationRevision: '13',
  };
  return {
    async configurationSnapshot({ agentHandle }) { calls.push(`configurationSnapshot:${agentHandle}`); return configuration; },
    async updateConfiguration(input) { calls.push(`updateConfiguration:${input.expectedConfigurationRevision}:${input.routeIntents[0].provider}:${input.routeIntents[0].model}`); return { outcome: 'updated', projection: { ...configuration, routeIntents: input.routeIntents } }; },
    async readinessSnapshot({ agentHandle }) { calls.push(`readinessSnapshot:${agentHandle}`); return readiness; },
    async autonomySnapshot({ agentHandle }) { calls.push(`autonomySnapshot:${agentHandle}`); return autonomy; },
    async updateAutonomy(input) { calls.push(`updateAutonomy:${input.expectedAutonomyRevision}:${input.intent.config.mode}:${input.intent.config.dailyTokenBudget}:${input.intent.config.maxTokensPerHook}`); return { outcome: 'updated', projection: { ...autonomy, enabled: input.intent.enabled, config: input.intent.config } }; },
    async presentationSnapshot({ agentHandle }) { calls.push(`presentationSnapshot:${agentHandle}`); return presentation; },
    async commitPresentation(input) { calls.push(`commitPresentation:${input.expectedPresentationRevision}:${input.intent.backgroundAssetRef}`); return { outcome: 'committed', projection: { ...presentation, profile: { ...presentation.profile, ...input.intent } } }; },
  };
}

function resolvedEvidence(overrides = {}) {
  return {
    conversation: { agentHandle: 'opaque-handle', ...(overrides.conversation || {}) },
    localAgent: { agentHandle: 'opaque-handle', ...(overrides.localAgent || {}) },
    inventory: { localAgents: [{ agentHandle: 'opaque-handle', displayName: '伙伴' }], ...(overrides.inventory || {}) },
  };
}
