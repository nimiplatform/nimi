import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/app/capability-room-state.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

const catalog = [
  descriptor('text.generate', 'chat', 'text', 'provider-capabilities', 'text.generate', 'turn'),
  descriptor('image.generate', 'image', 'image', 'provider-capabilities', 'image.generate', 'job'),
  descriptor('audio.synthesize', 'tts', 'audio-synthesize', 'provider-capabilities', 'audio.synthesize', 'job'),
];

const deferred = [
  {
    capability: 'chat',
    table: 'local-adapter-routing',
    reason: 'Runtime alias only.',
    sourceRule: 'P-CAPCAT-003',
  },
];

test('projects canonical catalog into fail-closed capability room state', async () => {
  const { projectZhiyuCapabilityRoomState } = await loadModule();

  const room = projectZhiyuCapabilityRoomState({
    evidence: evidence(),
    catalog,
    deferred,
  });

  assert.equal(room.title, '能力面板');
  assert.equal(room.activeCapabilityId, 'text.generate');
  assert.equal(room.catalogCount, 3);
  assert.equal(room.deferredCount, 1);
  assert.equal(room.readyCount, 0);
  assert.equal(room.blockedCount, 1);
  assert.equal(room.routeReady, false);
  assert.equal(room.routeReasonCode, 'zhiyu-ai-config-route-selection-required');
  assert.equal(room.routeActionHint, 'select_runtime_agent_route');
  assert.equal(room.executionBindingLabel, '等待模型配置');

  const active = room.items.find((item) => item.capabilityId === 'text.generate');
  assert.equal(active?.active, true);
  assert.equal(active?.state, 'needs-setup');
  assert.equal(active?.reasonCode, 'zhiyu-ai-config-route-selection-required');
  assert.equal(active?.actionHint, 'select_runtime_agent_route');
  assert.equal(active?.bindingRoute, null);
  assert.equal(active?.bindingModelId, null);

  const catalogOnly = room.items.find((item) => item.capabilityId === 'image.generate');
  assert.equal(catalogOnly?.active, false);
  assert.equal(catalogOnly?.state, 'catalog-only');
  assert.equal(catalogOnly?.reasonCode, 'zhiyu-capability-catalog-only');
  assert.equal(catalogOnly?.sourceTable, 'provider-capabilities');
  assert.equal(catalogOnly?.sourceCapability, 'image.generate');

  assert.deepEqual(room.owners.map((owner) => owner.key), ['catalog', 'route', 'model', 'memory']);
  assert.equal(room.owners[0]?.owner, '能力目录');
  assert.equal(room.owners[1]?.owner, '模型通路');
  assert.equal(room.owners[2]?.state, 'blocked');
  assert.equal(room.owners[3]?.state, 'not-admitted');
});

test('marks only the active routed capability ready when execution binding exists', async () => {
  const { projectZhiyuCapabilityRoomState } = await loadModule();

  const room = projectZhiyuCapabilityRoomState({
    evidence: evidence({
      route: {
        ...routeBlocked(),
        ready: true,
        reasonCode: 'runtime-route-ready',
        actionHint: 'send_runtime_agent_turn',
        selectedTargetRefKind: 'runtime-target',
        resolvedBindingRef: 'binding:1',
        executionBinding: {
          route: 'local',
          modelId: 'runtime-model:1',
        },
      },
    }),
    catalog,
    deferred,
  });

  const active = room.items.find((item) => item.capabilityId === 'text.generate');
  const inactive = room.items.find((item) => item.capabilityId === 'audio.synthesize');

  assert.equal(room.readyCount, 1);
  assert.equal(room.blockedCount, 0);
  assert.equal(room.executionBindingLabel, '本地模型已绑定');
  assert.equal(active?.state, 'ready');
  assert.equal(active?.bindingRoute, 'local');
  assert.equal(active?.bindingModelId, 'runtime-model:1');
  assert.equal(inactive?.state, 'catalog-only');
  assert.equal(room.owners[1]?.state, 'ready');
  assert.equal(room.owners[2]?.state, 'ready');
});

test('projects canonical capability governance without app-local consent truth', async () => {
  const { projectZhiyuCapabilityRoomState } = await loadModule();

  const room = projectZhiyuCapabilityRoomState({
    evidence: evidence(),
    catalog: [
      descriptor(
        'text.generate',
        'chat',
        'text',
        'provider-capabilities',
        'text.generate',
        'turn',
        {
          owner: 'Runtime route projection',
          dataMovement: 'local_or_cloud_by_route',
          retention: 'no_app_retention',
          revocation: 'route_or_permission_owner',
          auditSource: 'runtime-route-evidence',
        },
      ),
    ],
    deferred: [],
  });

  const active = room.items[0];
  assert.equal(active?.governance.owner, 'Runtime route projection');
  assert.equal(active?.governance.dataMovement, 'local_or_cloud_by_route');
  assert.equal(active?.governance.retention, 'no_app_retention');
  assert.equal(active?.governance.revocation, 'route_or_permission_owner');
  assert.equal(active?.governance.auditSource, 'runtime-route-evidence');
  assert.equal(active?.governance.source, 'canonical-capability-catalog');
  assert.equal(active?.matrix.ownerDomain, 'Runtime route projection');
  assert.equal(active?.matrix.currentState, 'needs-setup');
  assert.equal(active?.matrix.dataMovement, 'local_or_cloud_by_route');
  assert.equal(active?.matrix.retention, 'no_app_retention');
  assert.equal(active?.matrix.revocationPath, 'route_or_permission_owner');
  assert.equal(active?.matrix.auditSource, 'runtime-route-evidence');
  assert.equal(active?.matrix.auditRef, 'not_projected');
  assert.equal(active?.matrix.unsupportedReason, 'not_unsupported');
  assert.equal(active?.matrix.setupRequirement, 'select_runtime_agent_route');
  assert.equal(active?.matrix.source, 'canonical-capability-catalog');
});

test('classifies capability consent states from Runtime route evidence', async () => {
  const { projectZhiyuCapabilityRoomState } = await loadModule();
  const cases = [
    {
      reasonCode: 'runtime-route-permission-denied',
      actionHint: 'request_runtime_permission',
      state: 'denied',
      setupRequirement: 'restore_permission_or_route_access',
      unsupportedReason: 'not_unsupported',
    },
    {
      reasonCode: 'runtime-route-permission-revoked',
      actionHint: 'restore_runtime_permission',
      state: 'revoked',
      setupRequirement: 'restore_revoked_runtime_or_connector_access',
      unsupportedReason: 'not_unsupported',
    },
    {
      reasonCode: 'runtime-route-capability-unsupported',
      actionHint: 'choose_admitted_capability',
      state: 'unsupported',
      setupRequirement: 'choose_admitted_capability_or_route',
      unsupportedReason: 'runtime-route-capability-unsupported',
    },
    {
      reasonCode: 'runtime-route-projection-unavailable',
      actionHint: 'inspect_runtime_route_projection',
      state: 'unavailable',
      setupRequirement: 'inspect_runtime_route_projection',
      unsupportedReason: 'not_unsupported',
    },
  ];

  for (const itemCase of cases) {
    const room = projectZhiyuCapabilityRoomState({
      evidence: evidence({
        route: {
          ...routeBlocked(),
          reasonCode: itemCase.reasonCode,
          actionHint: itemCase.actionHint,
        },
      }),
      catalog,
      deferred,
    });
    const active = room.items.find((item) => item.capabilityId === 'text.generate');
    assert.equal(active?.state, itemCase.state);
    assert.equal(active?.matrix.currentState, itemCase.state);
    assert.equal(active?.matrix.setupRequirement, itemCase.setupRequirement);
    assert.equal(active?.matrix.unsupportedReason, itemCase.unsupportedReason);
    assert.equal(active?.matrix.auditRef, 'not_projected');
  }
});

function descriptor(capabilityId, section, editorKind, table, capability, runtimeEvidenceClass, governance = undefined) {
  return {
    capabilityId,
    section,
    editorKind,
    sourceRef: {
      table,
      capability,
    },
    runtimeEvidenceClass,
    ...(governance ? { governance } : {}),
  };
}

function evidence(overrides = {}) {
  return {
    appId: 'nimi.zhiyu',
    phase: 'electron-bootstrap',
    screen: 'home',
    runtime: status('electron-runtime-endpoint-unavailable'),
    auth: {
      ...status('electron-runtime-endpoint-unavailable'),
      state: 'unavailable',
      accountReasonCode: 'UNKNOWN',
      accountId: null,
      displayName: null,
      productionInert: false,
    },
    source: {
      ...status('zhiyu-admitted-source-projection-required'),
      ownerUserId: null,
      runtimeSourceRef: null,
      sourceRef: null,
    },
    inventory: {
      ...status('zhiyu-runtime-account-required'),
      ownerUserId: null,
      count: 0,
      localAgents: [],
    },
    localAgent: {
      ...status('zhiyu-runtime-source-required'),
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
    },
    conversation: {
      ...status('zhiyu-local-agent-required'),
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      conversationAnchorId: null,
    },
    route: routeBlocked(),
    turn: {
      ...status('zhiyu-conversation-anchor-required'),
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      conversationAnchorId: null,
      requestId: null,
      messageId: null,
    },
    composer: {
      submitState: 'blocked',
      draftLength: 0,
      reasonCode: 'not-probed',
      actionHint: 'enter_runtime_agent_turn_text',
      source: 'renderer',
      message: 'Runtime Agent composer has not been used.',
    },
    productRegions: ['presence', 'conversation', 'memory', 'capability', 'proposal', 'delegation', 'identity', 'companion', 'avatar', 'diagnostics'],
    ...overrides,
  };
}

function routeBlocked() {
  return {
    transport: 'electron-ipc',
    ready: false,
    capability: 'text.generate',
    reasonCode: 'zhiyu-ai-config-route-selection-required',
    actionHint: 'select_runtime_agent_route',
    source: 'sdk',
    message: 'Zhiyu requires an admitted AIConfig route selection before sending Runtime Agent turns.',
    selectedTargetRefKind: null,
    resolvedBindingRef: null,
    executionBinding: null,
  };
}

function status(reasonCode, ready = false, source = 'renderer', actionHint = `action:${reasonCode}`) {
  return {
    transport: 'electron-ipc',
    ready,
    reasonCode,
    actionHint,
    source,
    message: `message:${reasonCode}`,
  };
}
