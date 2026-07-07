import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadCompanionModule() {
  const sourcePath = path.join(root, 'src/shell/agent/companion-state.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

function localAgentReady() {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'local-agent-discovered',
    actionHint: 'open_runtime_agent_home',
    source: 'runtime',
    message: 'Runtime-owned LocalAgent was discovered.',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
  };
}

function proactiveEvent(overrides = {}) {
  return {
    family: 'suggested',
    projectionId: 'proactive:1',
    projectionKind: 'proactive_interruptibility_v1',
    ownerDomain: 'runtime',
    triggerSource: 'life-track-cadence',
    effectClass: 'in-app-companion-surface',
    deliveryChannel: 'in-app-surface',
    mode: 'low',
    optInState: 'granted',
    quietHoursState: 'inactive',
    frequencyCapState: 'within-cap',
    suppressionReason: null,
    reasonCode: 'runtime-agent-proactive-suggested',
    auditRef: 'audit:proactive:1',
    sourceHookId: null,
    sourceCadenceId: 'cadence:1',
    conversationAnchorId: 'conversation:1',
    originatingTurnId: null,
    originatingStreamId: null,
    observedAt: '2026-07-02T00:00:01.000Z',
    unsupportedFields: [],
    ...overrides,
  };
}

function proactiveProjection(overrides = {}) {
  return {
    projectionId: 'proactive:1',
    projectionKind: 'proactive_interruptibility_v1',
    mode: 'low',
    optInState: 'granted',
    deliveryChannel: 'in-app-surface',
    quietHoursState: 'inactive',
    frequencyCapState: 'within-cap',
    suggestedEvent: proactiveEvent(),
    lastDeliveredEvent: null,
    lastSuppressedEvent: null,
    auditRefs: ['audit:proactive:1'],
    unsupportedFields: [],
    ...overrides,
  };
}

function runtimeStateSnapshot(proactiveInterruptibility) {
  return {
    executionState: 'chat-active',
    statusText: 'Runtime Agent state projected.',
    activeWorldId: 'world-1',
    activeUserId: 'user-1',
    updatedAt: '2026-07-02T00:00:02.000Z',
    currentEmotion: 'focused',
    proactiveInterruptibility,
  };
}

async function projectProactive(proactiveInterruptibility) {
  const { probeZhiyuRuntimeCompanionState } = await loadCompanionModule();
  const companion = await probeZhiyuRuntimeCompanionState(localAgentReady(), {
    observedAt: '2026-07-02T00:00:03.000Z',
    readAgentState: async () => runtimeStateSnapshot(proactiveInterruptibility),
  });
  return companion.proactiveInterruptibility;
}

test('projects proactive interruptibility default off without pseudo delivery', async () => {
  const proactive = await projectProactive(proactiveProjection({
    mode: 'off',
    optInState: 'off',
    suggestedEvent: null,
    auditRefs: [],
    unsupportedFields: ['event', 'audit_refs'],
  }));

  assert.equal(proactive.ready, true);
  assert.equal(proactive.state, 'off');
  assert.equal(proactive.mode, 'off');
  assert.equal(proactive.optInState, 'off');
  assert.equal(proactive.deliveryReady, false);
  assert.equal(proactive.lastDeliveredReasonCode, null);
  assert.equal(proactive.reasonCode, 'runtime-agent-proactive-default-off');
  assert.deepEqual(proactive.auditRefs, []);
});

test('projects proactive interruptibility quiet hours suppression with audit evidence', async () => {
  const proactive = await projectProactive(proactiveProjection({
    quietHoursState: 'active',
    lastSuppressedEvent: proactiveEvent({
      family: 'suppressed',
      quietHoursState: 'active',
      suppressionReason: 'quiet-hours-active',
      reasonCode: 'runtime-agent-proactive-quiet-hours-active',
      auditRef: 'audit:quiet-hours',
    }),
    auditRefs: ['audit:quiet-hours'],
  }));

  assert.equal(proactive.state, 'quiet-hours-active');
  assert.equal(proactive.deliveryReady, false);
  assert.equal(proactive.quietHoursState, 'active');
  assert.equal(proactive.lastSuppressionReason, 'quiet-hours-active');
  assert.equal(proactive.lastSuppressedReasonCode, 'runtime-agent-proactive-quiet-hours-active');
  assert.deepEqual(proactive.auditRefs, ['audit:quiet-hours', 'audit:proactive:1']);
});

test('projects proactive interruptibility suggested but not delivered state', async () => {
  const proactive = await projectProactive(proactiveProjection({
    suggestedEvent: proactiveEvent({
      family: 'suggested',
      reasonCode: 'runtime-agent-proactive-suggested-by-hook',
      sourceHookId: 'hook:follow-up',
      auditRef: 'audit:suggested',
    }),
    auditRefs: ['audit:suggested'],
  }));

  assert.equal(proactive.state, 'suggested');
  assert.equal(proactive.deliveryReady, false);
  assert.equal(proactive.suggestedReasonCode, 'runtime-agent-proactive-suggested-by-hook');
  assert.equal(proactive.sourceHookId, 'hook:follow-up');
  assert.deepEqual(proactive.auditRefs, ['audit:suggested']);
});

test('projects proactive interruptibility delivered event with reason and audit ref', async () => {
  const proactive = await projectProactive(proactiveProjection({
    lastDeliveredEvent: proactiveEvent({
      family: 'delivered',
      reasonCode: 'runtime-agent-proactive-delivered-in-app',
      auditRef: 'audit:delivered',
    }),
    auditRefs: ['audit:delivered'],
  }));

  assert.equal(proactive.state, 'delivered');
  assert.equal(proactive.deliveryReady, true);
  assert.equal(proactive.lastDeliveredReasonCode, 'runtime-agent-proactive-delivered-in-app');
  assert.equal(proactive.deliveryChannel, 'in-app-surface');
  assert.deepEqual(proactive.auditRefs, ['audit:delivered', 'audit:proactive:1']);
});

test('projects proactive interruptibility suppressed event with reason and audit ref', async () => {
  const proactive = await projectProactive(proactiveProjection({
    lastSuppressedEvent: proactiveEvent({
      family: 'suppressed',
      suppressionReason: 'scheduler-denied',
      reasonCode: 'runtime-agent-proactive-scheduler-denied',
      auditRef: 'audit:suppressed',
    }),
    auditRefs: ['audit:suppressed'],
  }));

  assert.equal(proactive.state, 'suppressed');
  assert.equal(proactive.deliveryReady, false);
  assert.equal(proactive.lastSuppressionReason, 'scheduler-denied');
  assert.equal(proactive.lastSuppressedReasonCode, 'runtime-agent-proactive-scheduler-denied');
  assert.deepEqual(proactive.auditRefs, ['audit:suppressed', 'audit:proactive:1']);
});

for (const [optInState, suppressionReason, expectedState] of [
  ['denied', 'permission-denied', 'permission-denied'],
  ['revoked', 'permission-revoked', 'permission-revoked'],
]) {
  test(`projects proactive interruptibility ${optInState} permission without app-local grant truth`, async () => {
    const proactive = await projectProactive(proactiveProjection({
      optInState,
      lastSuppressedEvent: proactiveEvent({
        family: 'suppressed',
        optInState,
        suppressionReason,
        reasonCode: `runtime-agent-proactive-${suppressionReason}`,
        auditRef: `audit:${suppressionReason}`,
      }),
      auditRefs: [`audit:${suppressionReason}`],
    }));

    assert.equal(proactive.state, expectedState);
    assert.equal(proactive.deliveryReady, false);
    assert.equal(proactive.optInState, optInState);
    assert.equal(proactive.lastSuppressionReason, suppressionReason);
    assert.deepEqual(proactive.auditRefs, [`audit:${suppressionReason}`, 'audit:proactive:1']);
  });
}

test('companion state keeps proactive interruptibility evidence without a retired UI section', () => {
  const source = [
    readFileSync(path.join(root, 'src/shell/agent-chat/ZhiyuAgentChatSurface.tsx'), 'utf8'),
    readFileSync(path.join(root, 'src/shell/app/evidence.ts'), 'utf8'),
    readFileSync(path.join(root, 'src/shell/agent/companion-state.ts'), 'utf8'),
  ].join('\n');

  assert.match(source, /projectZhiyuProactiveInterruptibility/);
  assert.match(source, /proactiveInterruptibility/);
  assert.match(source, /deliveryChannel/);
  assert.match(source, /quietHoursState/);
  assert.match(source, /frequencyCapState/);
  assert.match(source, /lastSuppressionReason/);
  assert.match(source, /auditRefs/);
  assert.doesNotMatch(source, /data-zhiyu-proactive-/);
  assert.doesNotMatch(source, /setTimeout|setInterval|Notification\.|new Notification|notificationBridge|permissionStore|proactiveScheduler/);
  assert.doesNotMatch(source, /runtime\/internal|apps\/desktop|apiKey|providerId/);
});
