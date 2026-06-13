import { describe, expect, it } from 'vitest';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { deriveCompositionState, type CompositionInput } from './composition-state.js';

function input(overrides: Partial<CompositionInput> = {}): CompositionInput {
  return {
    bootstrapError: null,
    bootstrapComplete: true,
    shellReady: true,
    consume: {
      mode: 'sdk',
      authority: 'runtime',
      fixtureId: null,
      fixturePlaying: false,
      avatarInstanceId: 'avatar-1',
      conversationAnchorId: 'anchor-1',
      agentId: 'agent-1',
      worldId: 'world-1',
    },
    runtimeBinding: {
      status: 'active',
      reason: null,
      reasonCode: null,
      accountReasonCode: null,
      actionHint: null,
      stage: null,
      source: null,
      retryable: null,
    },
    driver: {
      status: 'running',
    },
    launchContext: null,
    relaunchPending: false,
    ...overrides,
  };
}

describe('deriveCompositionState', () => {
  it('fails closed for mock fixture playback without a live runtime binding', () => {
    const state = deriveCompositionState(input({
      consume: {
        mode: 'mock',
        authority: 'fixture',
        fixtureId: 'default',
        fixturePlaying: true,
        avatarInstanceId: null,
        conversationAnchorId: null,
        agentId: null,
        worldId: null,
      },
      runtimeBinding: {
        status: 'unavailable',
        reason: 'runtime_not_required_for_fixture',
        reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
        accountReasonCode: null,
        actionHint: null,
        stage: 'binding',
        source: 'runtime',
        retryable: true,
      },
    }));

    expect(state).toMatchObject({
      state: 'degraded_runtime_unavailable',
      variant: 'degraded',
      reason: 'runtime_not_required_for_fixture',
      ready: false,
    });
  });

  it('still fails closed when fixture mode has no running driver', () => {
    const state = deriveCompositionState(input({
      consume: {
        mode: 'mock',
        authority: 'fixture',
        fixtureId: 'default',
        fixturePlaying: true,
        avatarInstanceId: null,
        conversationAnchorId: null,
        agentId: null,
        worldId: null,
      },
      driver: {
        status: 'stopped',
      },
    }));

    expect(state).toMatchObject({
      state: 'degraded_runtime_unavailable',
      variant: 'degraded',
      reason: 'driver_stopped',
      ready: false,
    });
  });

  it('keeps live consume gated by the runtime binding', () => {
    const state = deriveCompositionState(input({
      runtimeBinding: {
        status: 'unavailable',
        reason: 'runtime binding unavailable',
        reasonCode: 'RUNTIME_BINDING_UNAVAILABLE',
        accountReasonCode: null,
        actionHint: 'retry',
        stage: 'binding',
        source: 'runtime',
        retryable: true,
      },
    }));

    expect(state).toMatchObject({
      state: 'degraded_runtime_unavailable',
      variant: 'degraded',
      reason: 'runtime binding unavailable',
      ready: false,
    });
  });
});
