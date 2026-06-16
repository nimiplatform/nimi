import { describe, expect, it } from 'vitest';
import { deriveCompositionState, type CompositionInput } from './composition-state.js';

function input(overrides: Partial<CompositionInput> = {}): CompositionInput {
  return {
    bootstrapError: null,
    bootstrapComplete: true,
    shellReady: true,
    model: {
      modelPath: null,
      modelId: null,
      loadState: 'idle',
      error: null,
    },
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
      error: null,
    },
    launchContext: null,
    relaunchPending: false,
    ...overrides,
  };
}

describe('deriveCompositionState', () => {
  it('enters fixture active for mock fixture playback without a live runtime binding', () => {
    const state = deriveCompositionState(input({
      model: {
        modelPath: 'fixture://vrm-lifecycle',
        modelId: 'vrm1-constraint-twist',
        loadState: 'loaded',
        error: null,
      },
      consume: {
        mode: 'mock',
        authority: 'fixture',
        fixtureId: 'vrm-lifecycle',
        fixturePlaying: true,
        avatarInstanceId: 'fixture-avatar-vrm-lifecycle',
        conversationAnchorId: 'fixture-anchor-vrm-lifecycle',
        agentId: 'fixture-agent-vrm-lifecycle',
        worldId: 'world-mock-vrm-lifecycle',
      },
      runtimeBinding: {
        status: 'unavailable',
        reason: 'runtime_not_required_for_fixture',
        reasonCode: 'RUNTIME_UNAVAILABLE',
        accountReasonCode: null,
        actionHint: null,
        stage: 'binding',
        source: 'runtime',
        retryable: true,
      },
    }));

    expect(state).toMatchObject({
      state: 'fixture_active',
      variant: 'fixture',
      reason: null,
      ready: true,
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
        error: null,
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

  it('fails closed when fixture visual model loading fails', () => {
    const state = deriveCompositionState(input({
      model: {
        modelPath: 'fixture://missing.vrm',
        modelId: null,
        loadState: 'error',
        error: 'mock fixture "default" does not declare a visual model manifest',
      },
      consume: {
        mode: 'mock',
        authority: 'fixture',
        fixtureId: 'default',
        fixturePlaying: true,
        avatarInstanceId: 'fixture-avatar-default',
        conversationAnchorId: 'fixture-anchor-default',
        agentId: 'fixture-agent-default',
        worldId: 'world-mock-default',
      },
      runtimeBinding: {
        status: 'unavailable',
        reason: 'runtime_not_required_for_fixture',
        reasonCode: 'RUNTIME_UNAVAILABLE',
        accountReasonCode: null,
        actionHint: null,
        stage: 'binding',
        source: 'runtime',
        retryable: false,
      },
    }));

    expect(state).toMatchObject({
      state: 'degraded_runtime_unavailable',
      variant: 'degraded',
      reason: 'mock fixture "default" does not declare a visual model manifest',
      reasonCode: 'AVATAR_MODEL_LOAD_FAILED',
      ready: false,
    });
  });

  it('surfaces the driver error detail when runtime consumption fails after startup', () => {
    const state = deriveCompositionState(input({
      driver: {
        status: 'error',
        error: 'avatar runtime event stream closed unexpectedly',
      },
    }));

    expect(state).toMatchObject({
      state: 'degraded_runtime_unavailable',
      variant: 'degraded',
      reason: 'driver_error: avatar runtime event stream closed unexpectedly',
      ready: false,
    });
  });

  it('surfaces model load failures after runtime and driver are ready', () => {
    const state = deriveCompositionState(input({
      model: {
        modelPath: 'C:/avatars/broken.vrm',
        modelId: 'avatar-broken',
        loadState: 'error',
        error: 'VRM scene graph is missing a humanoid root',
      },
    }));

    expect(state).toMatchObject({
      state: 'degraded_runtime_unavailable',
      variant: 'degraded',
      reason: 'VRM scene graph is missing a humanoid root',
      reasonCode: 'AVATAR_MODEL_LOAD_FAILED',
      actionHint: 'inspect_or_reimport_avatar_asset',
      stage: 'model_load',
      source: 'avatar_visual_carrier',
      retryable: false,
      ready: false,
      modelDiagnostics: {
        loadState: 'error',
        modelId: 'avatar-broken',
        modelPath: 'C:/avatars/broken.vrm',
        error: 'VRM scene graph is missing a humanoid root',
      },
    });
  });

  it('keeps runtime binding failures as the primary degraded reason while carrying model diagnostics', () => {
    const state = deriveCompositionState(input({
      model: {
        modelPath: 'C:/avatars/broken.vrm',
        modelId: 'avatar-broken',
        loadState: 'error',
        error: 'VRM scene graph is missing a humanoid root',
      },
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
      reasonCode: 'RUNTIME_BINDING_UNAVAILABLE',
      ready: false,
      modelDiagnostics: {
        loadState: 'error',
        modelId: 'avatar-broken',
        modelPath: 'C:/avatars/broken.vrm',
        error: 'VRM scene graph is missing a humanoid root',
      },
    });
  });
});
