import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/app/home-product-state.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
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

function evidence(overrides = {}) {
  return {
    appId: 'nimi.zhiyu',
    phase: 'electron-bootstrap',
    screen: 'home',
    runtime: status('electron-runtime-endpoint-unavailable', false, 'renderer', 'restart_zhiyu_electron_shell'),
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
    companion: {
      ...status('zhiyu-local-agent-required'),
      state: 'blocked',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      observedAt: null,
      stateUpdatedAt: null,
      executionState: null,
      statusText: null,
      activeWorldId: null,
      activeUserId: null,
      currentEmotion: null,
      currentEmotionId: null,
      currentEmotionCue: null,
      currentEmotionIntensity: null,
      emotionViolation: null,
      participationMode: 'not_projected',
      participationSource: null,
      projectedFields: [],
      unsupportedExplainabilityFields: [
        'posture',
        'postureSource',
        'stateConfidence',
        'whyThisState',
        'relationshipContext',
        'stateChangeHistory',
      ],
      proactiveInterruptibility: {
        transport: 'electron-ipc',
        ready: false,
        deliveryReady: false,
        state: 'blocked',
        reasonCode: 'not-probed',
        actionHint: 'probe_runtime_agent_proactive_interruptibility',
        source: 'renderer',
        message: 'Runtime Agent proactive interruptibility has not been probed.',
        ownerUserId: null,
        runtimeSourceRef: null,
        localAgentRef: null,
        observedAt: null,
        projectionId: null,
        projectionKind: null,
        mode: null,
        optInState: null,
        deliveryChannel: null,
        quietHoursState: null,
        frequencyCapState: null,
        suggestedReasonCode: null,
        lastDeliveredReasonCode: null,
        lastSuppressedReasonCode: null,
        lastSuppressionReason: null,
        sourceHookId: null,
        sourceCadenceId: null,
        auditRefs: [],
        unsupportedFields: ['proactive_interruptibility'],
      },
    },
    delegation: {
      ...status('not-probed'),
      state: 'blocked',
    },
    proposal: {
      transport: 'sdk-proposal-intake',
      ready: false,
      state: 'blocked',
      reasonCode: 'not-probed',
      actionHint: 'connect_platform_proposal_intake',
      source: 'renderer',
      message: 'Platform proposal intake has not been probed.',
      proposalId: null,
      proposalKind: 'capability_proposal',
      sourceConversationAnchorId: null,
      requesterSubjectRef: null,
      ownerDomain: 'Platform',
      requestedCapabilityRef: 'capability:text.generate.assistant',
      riskTier: 'medium',
      requiredPermissionRefs: ['permission:runtime.agent.turn.write'],
      nextReviewStep: 'platform_review_capability_proposal',
      auditRef: null,
      createdAt: null,
    },
    avatar: {
      ...status('zhiyu-avatar-facade-projection-unavailable'),
      state: 'blocked',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      projectionRef: null,
      configurationRef: null,
      backendKind: null,
      visualReadiness: 'not_projected',
      voiceReadiness: 'not_projected',
      launchAvailable: false,
      manageAvailable: false,
      unsupportedFields: [
        'configurationId',
        'displayName',
        'compatibilityTier',
        'readinessState',
        'liveInstanceBinding',
        'presentationHandoffState',
        'avatarDiagnosticCode',
        'assetManifestPath',
        'motionState',
        'expressionState',
      ],
    },
    route: {
      ...status('zhiyu-ai-config-route-selection-required'),
      capability: 'text.generate',
      selectedTargetRefKind: null,
      resolvedBindingRef: null,
      executionBinding: null,
    },
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

test('projects no-runtime home stage without inventing success', async () => {
  const { projectZhiyuHomeProductState } = await loadModule();
  const product = projectZhiyuHomeProductState(evidence());

  assert.equal(product.stage, 'runtime-unavailable');
  assert.equal(product.readyCount, 0);
  assert.equal(product.totalCount, 8);
  assert.equal(product.readinessScore, '0/8');
  assert.equal(product.primaryTitle, '需要先连接本地服务');
  assert.equal(product.primaryActionHint, '先确认桌面本地服务已经启动。');
  assert.equal(product.statusCards.length, 8);
  assert.equal(product.statusCards[0]?.key, 'runtime');
  assert.equal(product.statusCards[0]?.tone, 'danger');
  assert.equal(product.gatedSurfaces.length, 7);
  assert.equal(product.gatedSurfaces[0]?.title, '记忆观测');
  assert.equal(product.gatedSurfaces[1]?.title, '能力面板');
  assert.equal(product.gatedSurfaces[2]?.title, '能力申请');
  assert.equal(product.gatedSurfaces[2]?.reasonCode, 'not-probed');
  assert.equal(product.gatedSurfaces[3]?.title, '委托审批');
  assert.equal(product.gatedSurfaces[3]?.reasonCode, 'not-probed');
  assert.equal(product.gatedSurfaces[4]?.title, '身份安全');
  assert.equal(product.gatedSurfaces[5]?.title, '相处状态');
  assert.equal(product.gatedSurfaces[6]?.title, '形象状态');
});

test('projects ready stage only when Runtime Agent turn is ready', async () => {
  const { projectZhiyuHomeProductState } = await loadModule();
  const readyEvidence = evidence({
    runtime: status('runtime-ready', true, 'runtime'),
    auth: {
      ...status('runtime-account-ready', true, 'runtime'),
      state: 'authenticated',
      accountReasonCode: 'OK',
      accountId: 'account-1',
      displayName: 'User',
      productionInert: false,
    },
    source: {
      ...status('source-ready', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: null,
      sourceRef: {
        kind: 'worldCharacter',
        worldId: 'world-1',
        id: 'source-1',
        sourceHash: 'a'.repeat(64),
      },
    },
    inventory: {
      ...status('runtime-local-agent-inventory-ready', true, 'runtime'),
      ownerUserId: 'user-1',
      count: 1,
      localAgents: [],
    },
    localAgent: {
      ...status('local-agent-discovered', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:1',
    },
    conversation: {
      ...status('conversation-ready', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:1',
      conversationAnchorId: 'conversation:1',
    },
    route: {
      ...status('runtime-route-ready', true, 'sdk'),
      capability: 'text.generate',
      selectedTargetRefKind: 'runtime-target',
      resolvedBindingRef: 'binding:1',
      executionBinding: {
        route: 'local',
        modelId: 'runtime-model:1',
      },
    },
    turn: {
      ...status('runtime-turn-ready', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:1',
      conversationAnchorId: 'conversation:1',
      requestId: null,
      messageId: null,
    },
  });
  const product = projectZhiyuHomeProductState(readyEvidence);

  assert.equal(product.stage, 'ready');
  assert.equal(product.readyCount, 8);
  assert.equal(product.readinessScore, '8/8');
  assert.equal(product.primaryTitle, '当前伙伴已准备好');
  assert.equal(product.statusCards.every((card) => card.tone === 'success'), true);
});

test('projects explicit Runtime inventory selection as current partner without source projection', async () => {
  const { projectZhiyuHomeProductState } = await loadModule();
  const product = projectZhiyuHomeProductState(evidence({
    runtime: status('runtime-ready', true, 'runtime'),
    auth: {
      ...status('runtime-account-ready', true, 'runtime'),
      state: 'authenticated',
      accountReasonCode: 'OK',
      accountId: 'account-1',
      displayName: 'User',
      productionInert: false,
    },
    source: {
      ...status('zhiyu-admitted-source-projection-required', false, 'renderer'),
      ownerUserId: null,
      runtimeSourceRef: null,
      sourceRef: null,
    },
    inventory: {
      ...status('runtime-local-agent-inventory-ready', true, 'runtime'),
      ownerUserId: 'user-1',
      count: 1,
      localAgents: [{
        localAgentRef: 'local-agent:1',
        ownerUserId: 'user-1',
        runtimeSourceRef: 'runtime-source:1',
        displayName: '颜真卿',
        sourceKind: 'worldCharacter',
        sourceWorldId: 'world-1',
        sourceWorldName: '唐代文人世界',
        sourceId: 'source-1',
        sourceHash: 'a'.repeat(64),
      }],
    },
    localAgent: {
      ...status('runtime-local-agent-selected', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:1',
      localAgentRef: 'local-agent:1',
    },
    conversation: {
      ...status('conversation-ready', true, 'runtime'),
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:1',
      localAgentRef: 'local-agent:1',
      conversationAnchorId: 'conversation:1',
    },
  }));

  assert.equal(product.stage, 'turn-required');
  assert.equal(product.statusCards.find((card) => card.key === 'source')?.ready, false);
  assert.equal(product.statusCards.find((card) => card.key === 'localAgent')?.ready, true);
});
