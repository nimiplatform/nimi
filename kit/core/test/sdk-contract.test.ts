import { describe, expect, it } from 'vitest';

import {
  createNimiHostRuntimeAgentInspectSurface,
  type NimiRuntimeAgentAIConfigModule,
  type NimiRuntimeAgentAIConfigReadinessSnapshotProjection,
  type NimiRuntimeAgentInspectSnapshot,
  type NimiRuntimeAgentInspectSurface,
  type NimiRuntimeAgentMemoryObservatorySnapshot,
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
    const agentAIConfig = null as unknown as NimiRuntimeAgentAIConfigModule;
    const readiness = null as unknown as NimiRuntimeAgentAIConfigReadinessSnapshotProjection;
    const inspect = null as unknown as NimiRuntimeAgentInspectSnapshot;
    const inspectSurface = null as unknown as NimiRuntimeAgentInspectSurface;
    const memory = null as unknown as NimiRuntimeAgentMemoryObservatorySnapshot;

    expect(identity.localAgentRef).toBe('local-agent:owner:agent');
    expect(agentAIConfig).toBeNull();
    expect(readiness).toBeNull();
    expect(inspect).toBeNull();
    expect(inspectSurface).toBeNull();
    expect(memory).toBeNull();
  });
});
