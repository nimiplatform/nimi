import { describe, expect, it } from 'vitest';
import { ReasonCode } from '@nimiplatform/sdk/types';
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
      agentHandle: 'agent-1',
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
  it('keeps mock driver selection inside the ready shell composition', () => {
    const state = deriveCompositionState(input({
      model: {
        modelPath: 'fixture://vrm-render-recovery',
        modelId: 'vrm1-constraint-twist',
        loadState: 'loaded',
        error: null,
      },
      consume: {
        mode: 'mock',
        authority: 'fixture',
        fixtureId: 'vrm-render-recovery',
        fixturePlaying: true,
        avatarInstanceId: 'fixture-avatar-vrm-render-recovery',
        conversationAnchorId: 'fixture-anchor-vrm-render-recovery',
        agentHandle: 'fixture-agent-vrm-render-recovery',
        worldId: 'world-mock-vrm-render-recovery',
      },
    }));

    expect(state).toMatchObject({
      state: 'ready',
      variant: 'live',
      reason: null,
      ready: true,
    });
  });

  it('does not let mock driver selection bypass an unavailable Runtime binding', () => {
    const state = deriveCompositionState(input({
      consume: {
        mode: 'mock',
        authority: 'fixture',
        fixtureId: 'default',
        fixturePlaying: true,
        avatarInstanceId: 'fixture-avatar-default',
        conversationAnchorId: 'fixture-anchor-default',
        agentHandle: 'fixture-agent-default',
        worldId: 'world-mock-default',
      },
      runtimeBinding: {
        status: 'unavailable',
        reason: 'runtime binding unavailable',
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
      reason: 'runtime binding unavailable',
      ready: false,
    });
  });

  it('still fails closed when a mock driver is not running', () => {
    const state = deriveCompositionState(input({
      consume: {
        mode: 'mock',
        authority: 'fixture',
        fixtureId: 'default',
        fixturePlaying: true,
        avatarInstanceId: null,
        conversationAnchorId: null,
        agentHandle: null,
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

  it('keeps every driver mode gated by the Runtime binding', () => {
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

  it('classifies only the explicit Runtime-mediated Realm transport failure as Cloud offline', () => {
    const state = deriveCompositionState(input({
      runtimeBinding: {
        status: 'unavailable',
        reason: 'realm_connectivity: REALM_UNAVAILABLE / retry_realm_operation_when_available',
        reasonCode: ReasonCode.REALM_UNAVAILABLE,
        accountReasonCode: 'BROKER_REALM_UNAVAILABLE',
        actionHint: 'retry_realm_operation_when_available',
        stage: 'realm_connectivity',
        source: 'realm',
        retryable: true,
      },
    }));

    expect(state).toMatchObject({
      state: 'degraded_cloud_offline',
      variant: 'degraded',
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      source: 'realm',
      ready: false,
    });
  });

  it.each([
    ['realm rate limit', 'REALM_RATE_LIMITED', 'realm_connectivity', 'realm'],
    ['realm permission', 'PRINCIPAL_UNAUTHORIZED', 'realm_connectivity', 'realm'],
    ['runtime carrier unavailable', 'RUNTIME_UNAVAILABLE', 'runtime_client_ready', 'runtime'],
  ])('does not classify %s as Cloud offline', (_label, reasonCode, stage, source) => {
    const state = deriveCompositionState(input({
      runtimeBinding: {
        status: 'unavailable',
        reason: `${stage}: ${reasonCode}`,
        reasonCode,
        accountReasonCode: null,
        actionHint: null,
        stage,
        source,
        retryable: true,
      },
    }));

    expect(state.state).not.toBe('degraded_cloud_offline');
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
        agentHandle: 'fixture-agent-default',
        worldId: 'world-mock-default',
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
