import assert from 'node:assert/strict';
import test from 'node:test';
import type { TFunction } from 'i18next';

import {
  createDefaultAIScopeRef,
  createEmptyAIConfig,
  type AIConfig,
  type AISchedulingJudgement,
} from '@nimiplatform/sdk/mod';
import { getDesktopAIConfigService } from '../src/shell/renderer/app-shell/providers/desktop-ai-config-service.js';
import {
  resolveExecutionSchedulingGuardDecision,
} from '../src/shell/renderer/features/chat/chat-execution-scheduling-guard.js';
import {
  assertAiSubmitSchedulingAllowed,
} from '../src/shell/renderer/features/chat/chat-ai-shell-host-actions.js';
import {
  assertAgentSubmitSchedulingAllowed,
} from '../src/shell/renderer/features/chat/chat-agent-shell-host-actions.js';

function t(key: string, options?: Record<string, unknown>): string {
  const detail = String(options?.detail || '');
  switch (key) {
    case 'Chat.schedulingDeniedDetail':
      return `Cannot execute: ${detail}`;
    case 'Chat.schedulingQueueRequiredDetail':
      return `Queued execution. ${detail}`.trim();
    case 'Chat.schedulingPreemptionRiskDetail':
      return `Preemption risk. ${detail}`.trim();
    case 'Chat.schedulingSlowdownRiskDetail':
      return `Slowdown risk. ${detail}`.trim();
    case 'Chat.schedulingUnknownDetail':
      return `Scheduling assessment unavailable. ${detail}`.trim();
    default:
      return String(options?.defaultValue || key);
  }
}

const translate = t as unknown as TFunction;

function createLocalTextSubmitConfig(): AIConfig {
  const scopeRef = createDefaultAIScopeRef();
  const config = createEmptyAIConfig(scopeRef);
  return {
    ...config,
    capabilities: {
      ...config.capabilities,
      selectedBindings: {
        ...config.capabilities.selectedBindings,
        'text.generate': {
          source: 'local',
          connectorId: '',
          model: 'text-generate-local',
          provider: 'llama',
        },
      },
      localProfileRefs: {
        ...config.capabilities.localProfileRefs,
        'text.generate': {
          modId: 'core:runtime',
          profileId: 'text-local',
        },
      },
    },
  };
}

function createJudgement(
  state: AISchedulingJudgement['state'],
  detail: string,
): AISchedulingJudgement {
  return {
    state,
    detail,
    occupancy: {
      globalUsed: 1,
      globalCap: 2,
      appUsed: 1,
      appCap: 2,
    },
    resourceWarnings: state === 'slowdown_risk' ? ['VRAM near threshold'] : [],
  };
}

async function withProbeJudgement(
  judgement: AISchedulingJudgement | null,
  run: () => Promise<void>,
): Promise<void> {
  const surface = getDesktopAIConfigService();
  const originalProbe = surface.aiConfig.probeFeasibility;
  const originalTargetProbe = surface.aiConfig.probeSchedulingTarget;
  surface.aiConfig.probeFeasibility = async () => ({
    status: 'available',
    capabilityStatuses: {},
    schedulingJudgement: createJudgement('queue_required', 'scope aggregate should not be used'),
  });
  surface.aiConfig.probeSchedulingTarget = async () => judgement;
  try {
    await run();
  } finally {
    surface.aiConfig.probeFeasibility = originalProbe;
    surface.aiConfig.probeSchedulingTarget = originalTargetProbe;
  }
}

test('execution scheduling guard: denied disables submit and maps to error feedback', () => {
  const decision = resolveExecutionSchedulingGuardDecision({
    judgement: createJudgement('denied', 'GPU missing'),
    t: translate,
  });

  assert.equal(decision.disabled, true);
  assert.equal(decision.disabledReason, 'Cannot execute: GPU missing');
  assert.equal(decision.feedback?.kind, 'error');
  assert.equal(decision.feedback?.message, 'Cannot execute: GPU missing');
});

test('execution scheduling guard: advisory states stay submittable with typed feedback', () => {
  const queueDecision = resolveExecutionSchedulingGuardDecision({
    judgement: createJudgement('queue_required', '2 jobs ahead'),
    t: translate,
  });
  const preemptionDecision = resolveExecutionSchedulingGuardDecision({
    judgement: createJudgement('preemption_risk', 'another run may be degraded'),
    t: translate,
  });
  const slowdownDecision = resolveExecutionSchedulingGuardDecision({
    judgement: createJudgement('slowdown_risk', 'VRAM constrained'),
    t: translate,
  });
  const unknownDecision = resolveExecutionSchedulingGuardDecision({
    judgement: createJudgement('unknown', 'telemetry unavailable'),
    t: translate,
  });

  assert.equal(queueDecision.disabled, false);
  assert.equal(queueDecision.feedback?.kind, 'info');
  assert.match(queueDecision.feedback?.message || '', /Queued execution/);

  assert.equal(preemptionDecision.disabled, false);
  assert.equal(preemptionDecision.feedback?.kind, 'warning');
  assert.match(preemptionDecision.feedback?.message || '', /Preemption risk/);

  assert.equal(slowdownDecision.disabled, false);
  assert.equal(slowdownDecision.feedback?.kind, 'warning');
  assert.match(slowdownDecision.feedback?.message || '', /Slowdown risk/);

  assert.equal(unknownDecision.disabled, false);
  assert.equal(unknownDecision.feedback?.kind, 'warning');
  assert.match(unknownDecision.feedback?.message || '', /Scheduling assessment unavailable/);
});

test('AI submit: denied scheduling judgement blocks execution before submit proceeds', async () => {
  await withProbeJudgement(createJudgement('denied', 'GPU missing'), async () => {
    await assert.rejects(
      assertAiSubmitSchedulingAllowed({
        aiConfig: createLocalTextSubmitConfig(),
        t: translate,
      }),
      /GPU missing/,
    );
  });
});

test('Agent submit: denied scheduling judgement blocks execution before submit proceeds', async () => {
  await withProbeJudgement(createJudgement('denied', 'disk below safe threshold'), async () => {
    await assert.rejects(
      assertAgentSubmitSchedulingAllowed({
        aiConfig: createLocalTextSubmitConfig(),
        t: translate,
      }),
      /disk below safe threshold/,
    );
  });
});

test('AI submit: advisory scheduling states still allow submit preflight', async () => {
  const advisoryStates: Array<AISchedulingJudgement['state']> = [
    'queue_required',
    'preemption_risk',
    'slowdown_risk',
  ];

  for (const state of advisoryStates) {
    await withProbeJudgement(createJudgement(state, `${state}-detail`), async () => {
      await assert.doesNotReject(async () => {
          await assertAiSubmitSchedulingAllowed({
            aiConfig: createLocalTextSubmitConfig(),
            t: translate,
          });
      });
    });
  }
});

test('unknown scheduling judgement: submit stays allowed but does not masquerade as runnable', async () => {
  const decision = resolveExecutionSchedulingGuardDecision({
    judgement: createJudgement('unknown', 'telemetry unavailable'),
    t: translate,
  });

  assert.equal(decision.disabled, false);
  assert.equal(decision.feedback?.kind, 'warning');

  await withProbeJudgement(createJudgement('unknown', 'telemetry unavailable'), async () => {
    await assert.doesNotReject(async () => {
      await assertAgentSubmitSchedulingAllowed({
        aiConfig: createLocalTextSubmitConfig(),
        t: translate,
      });
    });
  });
});

test('submit guard uses target-scoped probe instead of scope aggregate probe', async () => {
  const surface = getDesktopAIConfigService();
  const originalProbe = surface.aiConfig.probeFeasibility;
  const originalTargetProbe = surface.aiConfig.probeSchedulingTarget;
  let scopeProbeCalls = 0;
  let targetProbeCalls = 0;
  surface.aiConfig.probeFeasibility = async () => {
    scopeProbeCalls++;
    return {
      status: 'available',
      capabilityStatuses: {},
      schedulingJudgement: createJudgement('denied', 'scope aggregate should be ignored'),
    };
  };
  surface.aiConfig.probeSchedulingTarget = async () => {
    targetProbeCalls++;
    return createJudgement('unknown', 'target scoped');
  };

  try {
    await assert.doesNotReject(async () => {
      await assertAiSubmitSchedulingAllowed({
        aiConfig: createLocalTextSubmitConfig(),
        t: translate,
      });
    });
    assert.equal(scopeProbeCalls, 0);
    assert.equal(targetProbeCalls, 1);
  } finally {
    surface.aiConfig.probeFeasibility = originalProbe;
    surface.aiConfig.probeSchedulingTarget = originalTargetProbe;
  }
});
