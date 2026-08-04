import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import type { TFunction } from 'i18next';

import {
  isBusySlowdownRisk,
  resolveExecutionSchedulingGuardDecision,
  schedulingDetailKeyForJudgement,
} from '../src/shell/renderer/features/chat/chat-shared-execution-scheduling-guard.js';

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
    case 'Chat.schedulingSlowdownRiskBusyDetail':
      return `Device busy. ${detail}`.trim();
    case 'Chat.schedulingUnknownDetail':
      return `Scheduling assessment unavailable. ${detail}`.trim();
    default:
      return String(options?.defaultValue || key);
  }
}

const translate = t as unknown as TFunction;
type SchedulingJudgement = NonNullable<
  Parameters<typeof resolveExecutionSchedulingGuardDecision>[0]['judgement']
>;

function createJudgement(
  state: SchedulingJudgement['state'],
  detail: string,
): SchedulingJudgement {
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

test('execution scheduling guard: busy slowdown risk uses busy-specific detail key', () => {
  const judgement = {
    ...createJudgement('slowdown_risk', 'active local executions are consuming device resources; execution may be slow'),
    resourceWarnings: [
      'active local executions currently occupy scheduler slots',
      'available RAM 1000000000 bytes below threshold 2147483648 bytes',
    ],
  };

  assert.equal(isBusySlowdownRisk(judgement), true);
  assert.equal(schedulingDetailKeyForJudgement(judgement), 'Chat.schedulingSlowdownRiskBusyDetail');

  const decision = resolveExecutionSchedulingGuardDecision({
    judgement,
    t: translate,
  });
  assert.equal(decision.feedback?.kind, 'warning');
  assert.match(decision.feedback?.message || '', /Device busy/);
});

test('Agent submit delegates scheduling admission to Runtime turn execution', async () => {
  const submitSource = await readFile(path.resolve(
    import.meta.dirname,
    '../src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.ts',
  ), 'utf8');

  assert.doesNotMatch(submitSource, /assertAgentSubmitSchedulingAllowed|probeExecutionSchedulingGuard/u);
  assert.match(submitSource, /runActiveAgentSubmit\(\{/u);
});

test('unknown scheduling judgement stays advisory without masquerading as runnable', () => {
  const decision = resolveExecutionSchedulingGuardDecision({
    judgement: createJudgement('unknown', 'telemetry unavailable'),
    t: translate,
  });

  assert.equal(decision.disabled, false);
  assert.equal(decision.feedback?.kind, 'warning');
});
