import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CompanionParticipationStatus,
  CompanionParticipationSurfaceKind,
  CompanionParticipationTriggerSource,
} from '../core-generated/runtime-typed-client';
import { decodeNimiRuntimeAgentCompanionParticipationProjection } from './index';

test('Runtime Agent companion projection decoder fails closed on required candidate and commit refs', () => {
  assert.equal(decodeNimiRuntimeAgentCompanionParticipationProjection({
    projectionId: 'projection-candidate',
    agentId: 'local-agent:owner-1:agent-1',
    surfaceKind: CompanionParticipationSurfaceKind.AVATAR_COMPANION,
    profileRef: 'profile-1',
    triggerSource: CompanionParticipationTriggerSource.DOMAIN_EVENT,
    status: CompanionParticipationStatus.CANDIDATE_READY,
    candidateRef: 'candidate-1',
    commitRef: '',
    refusalReason: '',
    presentationRef: '',
    auditRef: 'audit-1',
    conversationAnchorId: 'anchor-1',
    turnId: '',
    streamId: '',
  }).candidateRef, 'candidate-1');
  assert.equal(decodeNimiRuntimeAgentCompanionParticipationProjection({
    projectionId: 'projection-commit',
    agentId: 'local-agent:owner-1:agent-1',
    surfaceKind: CompanionParticipationSurfaceKind.AVATAR_COMPANION,
    profileRef: 'profile-1',
    triggerSource: CompanionParticipationTriggerSource.DOMAIN_EVENT,
    status: CompanionParticipationStatus.COMMITTED_BY_OWNER,
    candidateRef: '',
    commitRef: 'commit-1',
    refusalReason: '',
    presentationRef: '',
    auditRef: 'audit-1',
    conversationAnchorId: 'anchor-1',
    turnId: '',
    streamId: '',
  }).commitRef, 'commit-1');
  assert.throws(
    () => decodeNimiRuntimeAgentCompanionParticipationProjection(undefined),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_RESPONSE_INVALID');
      return true;
    },
  );
  assert.throws(
    () => decodeNimiRuntimeAgentCompanionParticipationProjection({
      projectionId: 'projection-candidate',
      agentId: 'local-agent:owner-1:agent-1',
      surfaceKind: CompanionParticipationSurfaceKind.AVATAR_COMPANION,
      profileRef: 'profile-1',
      triggerSource: CompanionParticipationTriggerSource.DOMAIN_EVENT,
      status: CompanionParticipationStatus.CANDIDATE_READY,
      candidateRef: '',
      commitRef: '',
      refusalReason: '',
      presentationRef: '',
      auditRef: 'audit-1',
      conversationAnchorId: 'anchor-1',
      turnId: '',
      streamId: '',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_RESPONSE_INVALID');
      return true;
    },
  );
  assert.throws(
    () => decodeNimiRuntimeAgentCompanionParticipationProjection({
      projectionId: 'projection-commit',
      agentId: 'local-agent:owner-1:agent-1',
      surfaceKind: CompanionParticipationSurfaceKind.AVATAR_COMPANION,
      profileRef: 'profile-1',
      triggerSource: CompanionParticipationTriggerSource.DOMAIN_EVENT,
      status: CompanionParticipationStatus.COMMITTED_BY_OWNER,
      candidateRef: '',
      commitRef: '',
      refusalReason: '',
      presentationRef: '',
      auditRef: 'audit-1',
      conversationAnchorId: 'anchor-1',
      turnId: '',
      streamId: '',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_RESPONSE_INVALID');
      return true;
    },
  );
});
