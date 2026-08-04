import { describe, expect, it } from 'vitest';

import {
  NIMI_RUNTIME_AGENT_RESOLVED_STATUS_CUE_MOODS,
  assertNimiRuntimeAgentContextProjectionCorrelation,
  createNimiHostRuntimeAgentInspectSurface,
  decodeNimiRuntimeAgentSourceContextStatus,
  decodeNimiRuntimeAgentTurnContextSummary,
  type NimiRuntimeAgentInspectSnapshot,
  type NimiRuntimeAgentInspectSurface,
  type NimiRuntimeAgentMemoryObservatorySnapshot,
  type NimiRuntimeAgentResolvedStatusCueMood,
  type NimiRuntimeAgentSourceContextStatus,
  type NimiRuntimeAgentTurnContextSummary,
  type RuntimeLocalAgentIdentityInput,
} from '../src/sdk-contract.js';

describe('kit sdk-contract', () => {
  it('re-exports Runtime Agent surfaces required by Kit Agent Center', () => {
    expect(typeof createNimiHostRuntimeAgentInspectSurface).toBe('function');

    const identity: RuntimeLocalAgentIdentityInput = {
      ownerUserId: 'owner',
      runtimeSourceRef: 'agent',
      localAgentRef: 'local-agent:owner:agent',
    };
    const inspect = null as unknown as NimiRuntimeAgentInspectSnapshot;
    const inspectSurface = null as unknown as NimiRuntimeAgentInspectSurface;
    const memory = null as unknown as NimiRuntimeAgentMemoryObservatorySnapshot;
    const mood: NimiRuntimeAgentResolvedStatusCueMood = 'neutral';
    const sourceContext = null as unknown as NimiRuntimeAgentSourceContextStatus;
    const turnContext = null as unknown as NimiRuntimeAgentTurnContextSummary;

    expect(identity.localAgentRef).toBe('local-agent:owner:agent');
    expect(inspect).toBeNull();
    expect(inspectSurface).toBeNull();
    expect(memory).toBeNull();
    expect(mood).toBe('neutral');
    expect(NIMI_RUNTIME_AGENT_RESOLVED_STATUS_CUE_MOODS).toContain('ext:grateful');
    expect(sourceContext).toBeNull();
    expect(turnContext).toBeNull();
    expect(typeof decodeNimiRuntimeAgentSourceContextStatus).toBe('function');
    expect(typeof decodeNimiRuntimeAgentTurnContextSummary).toBe('function');
    expect(typeof assertNimiRuntimeAgentContextProjectionCorrelation).toBe('function');
  });
});
