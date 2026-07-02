import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectNimiRuntimeAgentIdentitySafety,
  type NimiRuntimeAgentDelegatedCapabilityDiagnosticProjection,
} from './index';
import {
  ReasonCode,
  type CanonicalMemoryRejection,
} from '../core-generated/runtime-typed-client';

test('Runtime Agent identity safety projection keeps missing upstream conflict taxonomy explicit', () => {
  const projection = projectNimiRuntimeAgentIdentitySafety({
    identity: {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:source-1',
    },
    conversationAnchorId: 'anchor-1',
  });

  assert.equal(projection.state, 'ready');
  assert.equal(projection.identity.state, 'ready');
  assert.equal(projection.identityConflict.state, 'not_projected');
  assert.equal(projection.identityConflict.reasonCode, 'runtime-agent-identity-conflict-event-not-projected');
  assert.equal(projection.memoryAdmission.state, 'not_projected');
  assert.equal(projection.outputFirewall.state, 'not_projected');
  assert.deepEqual(projection.unsupportedProjectionFields, [
    'identityConflictEvent',
    'firewallThreatIndicators',
    'firewallNormalizedOutputDiff',
  ]);
});

test('Runtime Agent identity safety projection surfaces canonical memory admission rejection', () => {
  const rejection: CanonicalMemoryRejection = {
    sourceEventId: 'turn-1',
    reasonCode: ReasonCode.PROTOCOL_DOMAIN_FIELD_CONFLICT,
    message: 'memory candidate conflicts with local identity boundary',
  };

  const projection = projectNimiRuntimeAgentIdentitySafety({
    identity: {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:source-1',
    },
    memoryRejections: [rejection],
  });

  assert.equal(projection.state, 'warning');
  assert.equal(projection.memoryAdmission.state, 'rejected');
  assert.equal(projection.memoryAdmission.reasonCode, 'PROTOCOL_DOMAIN_FIELD_CONFLICT');
  assert.equal(projection.memoryAdmission.sourceEventId, 'turn-1');
  assert.equal(projection.memoryAdmission.identityConflictRelated, true);
  assert.equal(projection.identityConflict.state, 'detected');
  assert.equal(projection.identityConflict.source, 'runtime-agent-memory-admission');
});

test('Runtime Agent identity safety projection surfaces delegated firewall block and suppression posture', () => {
  const diagnostic: NimiRuntimeAgentDelegatedCapabilityDiagnosticProjection = {
    diagnosticId: 'diag-1',
    agentId: 'local-agent:source-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    firewallInputId: 'firewall-input-1',
    firewallVerdict: 'POLICY_BLOCKED',
    runtimeDecision: 'blocked',
    reasonCode: 'DELEG_FIREWALL_QUARANTINED',
  };

  const projection = projectNimiRuntimeAgentIdentitySafety({
    identity: {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:source-1',
    },
    delegatedDiagnostics: [diagnostic],
  });

  assert.equal(projection.state, 'blocked');
  assert.equal(projection.outputFirewall.state, 'blocked');
  assert.equal(projection.outputFirewall.firewallInputId, 'firewall-input-1');
  assert.equal(projection.outputFirewall.reasonCode, 'DELEG_FIREWALL_QUARANTINED');
  assert.equal(projection.promptInjection.state, 'suppressed');
  assert.equal(projection.promptInjection.reasonCode, 'DELEG_FIREWALL_QUARANTINED');
  assert.equal(projection.promptInjection.source, 'runtime-delegation-firewall');
});
