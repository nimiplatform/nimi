import path from 'node:path';
import { repoRoot } from './registry.mjs';

const runtimeRoot = path.join(repoRoot, 'runtime');
const realmRoot = path.resolve(repoRoot, '..');
const realmBackendRoot = path.join(realmRoot, 'nimi-backend');

function runtimeStep(stepId, testNames, checkpointMarkers) {
  return {
    stepId,
    owner: 'runtime',
    command: 'go',
    args: [
      'test',
      './internal/services/runtimeagent',
      '-run',
      `^(${testNames.join('|')})$`,
      '-count=1',
      '-v',
    ],
    cwd: runtimeRoot,
    checkpointMarkers,
  };
}

function realmAccessStep() {
  const privateMarker = 'fails closed for private source delegated access before packet or proof issuance';
  const staleMarker = 'fails closed for stale source hash before packet or proof issuance';
  return {
    stepId: 'realm-access-denials',
    owner: 'realm',
    command: 'pnpm',
    args: [
      '--dir',
      realmBackendRoot,
      'exec',
      'vitest',
      'run',
      'libs/domains/world/src/source-materialization.service.spec.ts',
      '-t',
      'fails closed for (private source delegated access|stale source hash) before packet or proof issuance',
      '--reporter=verbose',
    ],
    cwd: realmRoot,
    checkpointMarkers: {
      'private-persona-denied': [privateMarker],
      'stale-source-denied': [staleMarker],
    },
  };
}

export const extendedCommandPlans = Object.freeze({
  'access-denial': Object.freeze({
    processStarts: { provider: 1, realm: 1, runtime: 1, desktop: 1, zhiyu: 0 },
    steps: [
      {
        stepId: 'desktop-nonconnectable-action',
        owner: 'desktop',
        kind: 'desktop-disabled-action',
        checkpointMarkers: {
          'nonconnectable-action-disabled': ['CHECKPOINT nonconnectable-action-disabled'],
        },
      },
      realmAccessStep(),
      runtimeStep('runtime-access-denials', [
        'TestSourceMaterializationDetachedRS256ProofAndBoundedRefresh',
        'TestSourceMaterializationDetachedProofFailsClosedWithoutRefreshForKnownInvalidKey',
        'TestSourceMaterializationRequestContextAccountMustMatchAuthenticatedSubject',
        'TestRuntimeAgentLocalAgentRefIsolatesTwoOwnersForSameRuntimeSource',
        'TestRuntimeAgentConversationAnchorRejectsOwnerMismatch',
      ], {
        'forged-proof-denied': ['TestSourceMaterializationDetachedProofFailsClosedWithoutRefreshForKnownInvalidKey'],
        'issuer-key-denied': [
          'TestSourceMaterializationDetachedRS256ProofAndBoundedRefresh',
          'TestSourceMaterializationDetachedProofFailsClosedWithoutRefreshForKnownInvalidKey',
        ],
        'account-binding-denied': ['TestSourceMaterializationRequestContextAccountMustMatchAuthenticatedSubject'],
        'cross-account-hidden': [
          'TestRuntimeAgentLocalAgentRefIsolatesTwoOwnersForSameRuntimeSource',
          'TestRuntimeAgentConversationAnchorRejectsOwnerMismatch',
        ],
      }),
    ],
  }),
  'source-revision-no-rebase': Object.freeze({
    processStarts: { provider: 0, realm: 0, runtime: 1, desktop: 0, zhiyu: 0 },
    steps: [runtimeStep('runtime-source-revision', [
      'TestSourceRevisionMaterializesWithoutRebasingExistingLocalAgent',
    ], {
      'old-agent-stays-pinned': ['CHECKPOINT old-agent-stays-pinned'],
      'new-revision-isolated': ['CHECKPOINT new-revision-isolated'],
    })],
  }),
  'destructive-termination': Object.freeze({
    processStarts: { provider: 0, realm: 0, runtime: 1, desktop: 0, zhiyu: 0 },
    steps: [runtimeStep('runtime-destructive-termination', [
      'TestTerminateMaterializedProductRollsBackThenAtomicallyHardDeletes',
      'TestTerminateAgentHardDeletesProjectionAndAgentScopedMemory',
      'TestTerminateAgentIdempotentTypedNoOpForAbsentRef',
      'TestTerminateAgentSubstrateFailureFailsClosed',
    ], {
      'active-agent-atomic-delete': [
        'TestTerminateMaterializedProductRollsBackThenAtomicallyHardDeletes',
        'TestTerminateAgentHardDeletesProjectionAndAgentScopedMemory',
      ],
      'absent-agent-idempotent': ['TestTerminateAgentIdempotentTypedNoOpForAbsentRef'],
      'delete-failure-rollback': [
        'TestTerminateMaterializedProductRollsBackThenAtomicallyHardDeletes',
        'TestTerminateAgentSubstrateFailureFailsClosed',
      ],
    })],
  }),
  'challenge-replay-concurrency': Object.freeze({
    processStarts: { provider: 0, realm: 0, runtime: 1, desktop: 0, zhiyu: 0 },
    steps: [runtimeStep('runtime-challenge-replay-concurrency', [
      'TestVerifySourceMaterializationBeginControlV2FailsClosed',
      'TestSourceMaterializationChallengeRequiresAuthAndIsRequestIdempotent',
      'TestSourceMaterializationBeginAndPutRequestConflictsFailClosed',
      'TestSourceMaterializationAbortIsExactIdempotentAndClearsRawBytes',
      'TestSourceMaterializationNonceReplayLedgerRejectsNewChallengeAcrossRestart',
      'TestSourceMaterializationCommitAtomicallyCreatesCharacterAndPersona',
      'TestSourceMaterializationConcurrentCommitAndAbortHaveOneWinner',
    ], {
      'wrong-challenge-denied': ['TestVerifySourceMaterializationBeginControlV2FailsClosed'],
      'nonce-replay-after-restart': ['TestSourceMaterializationNonceReplayLedgerRejectsNewChallengeAcrossRestart'],
      'put-conflict-cleanup': ['TestSourceMaterializationBeginAndPutRequestConflictsFailClosed'],
      'begin-conflict-denied': [
        'TestSourceMaterializationChallengeRequiresAuthAndIsRequestIdempotent',
        'TestSourceMaterializationBeginAndPutRequestConflictsFailClosed',
      ],
      'commit-single-winner': [
        'TestSourceMaterializationCommitAtomicallyCreatesCharacterAndPersona',
        'TestSourceMaterializationConcurrentCommitAndAbortHaveOneWinner',
      ],
      'abort-commit-single-winner': [
        'TestSourceMaterializationAbortIsExactIdempotentAndClearsRawBytes',
        'TestSourceMaterializationConcurrentCommitAndAbortHaveOneWinner',
      ],
    })],
  }),
  'crash-recovery': Object.freeze({
    processStarts: { provider: 0, realm: 0, runtime: 1, desktop: 0, zhiyu: 0 },
    steps: [runtimeStep('runtime-crash-recovery', [
      'TestSourceMaterializationRestartPreservesIssuedAndInvalidatesOpenUpload',
    ], {
      'open-upload-crash-recovery': ['TestSourceMaterializationRestartPreservesIssuedAndInvalidatesOpenUpload'],
    })],
  }),
});

export function validateExtendedCommandPlan(journey, plan) {
  const failures = [];
  if (!plan) return [`missing extended command plan for ${journey.journey_id}`];
  if (JSON.stringify(plan.processStarts) !== JSON.stringify(journey.environment.start_limits)) {
    failures.push(`${journey.journey_id} process starts drift from Journey registry`);
  }
  const mapped = new Map();
  for (const step of plan.steps) {
    for (const [checkpointId, markers] of Object.entries(step.checkpointMarkers || {})) {
      if (mapped.has(checkpointId)) failures.push(`${journey.journey_id} checkpoint ${checkpointId} has multiple command owners`);
      mapped.set(checkpointId, markers);
      if (!Array.isArray(markers) || markers.length === 0) failures.push(`${journey.journey_id} checkpoint ${checkpointId} has no observed marker`);
    }
  }
  for (const checkpoint of journey.checkpoints) {
    if (!mapped.has(checkpoint.checkpoint_id)) failures.push(`${journey.journey_id} checkpoint ${checkpoint.checkpoint_id} has no command mapping`);
  }
  for (const checkpointId of mapped.keys()) {
    if (!journey.checkpoints.some((checkpoint) => checkpoint.checkpoint_id === checkpointId)) failures.push(`${journey.journey_id} command plan has orphan checkpoint ${checkpointId}`);
  }
  const leafCount = journey.checkpoints.reduce((count, checkpoint) => count + checkpoint.covered_leaf_ids.length, 0);
  if (plan.steps.length >= leafCount && leafCount > 1) failures.push(`${journey.journey_id} command scheduling regressed to leaf-per-process`);
  return failures;
}
