import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultAIScopeRef,
  type AIConfig,
  type AIRuntimeLocalProfileRef,
  type AIScopeRef,
  type AISchedulingEvaluationTarget,
  type RuntimeRouteBinding,
} from '@nimiplatform/sdk/mod';
import {
  setInternalModSdkHost,
  clearInternalModSdkHost,
} from '../src/runtime/mod';
import {
  setConversationCapabilityRouteRuntime,
  type ConversationCapabilityRouteRuntime,
} from '../src/shell/renderer/features/chat/conversation-capability';

type PeekJudgement = {
  state: string;
  detail: string;
  occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
  resourceWarnings: string[];
};

type PeekResult = {
  occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
  aggregateJudgement: PeekJudgement | null;
  targetJudgements: Array<{
    target: AISchedulingEvaluationTarget;
    judgement: PeekJudgement;
  }>;
};

function createMockModSdkHost(
  peekFn: (input: { appId: string; targets: AISchedulingEvaluationTarget[] }) => Promise<PeekResult>,
) {
  return {
    runtime: {
      checkLocalLlmHealth: async () => ({ healthy: false, status: 'unavailable', detail: 'test' }),
      getRuntimeHookRuntime: () => ({ setModLocalProfileSnapshotResolver: () => {} }),
      getModLocalProfileSnapshot: async () => ({
        modId: 'core:runtime',
        status: 'missing',
        routeSource: 'unknown',
        warnings: [],
        entries: [],
        repairActions: [],
        updatedAt: new Date().toISOString(),
      }),
      route: {
        listOptions: async () => { throw new Error('not implemented'); },
        resolve: async () => { throw new Error('not implemented'); },
        checkHealth: async () => ({ healthy: true, status: 'healthy', detail: 'ok' }),
        describe: async () => { throw new Error('not implemented'); },
      },
      scheduler: { peek: peekFn },
      local: {
        listAssets: async () => [],
        listProfiles: async () => [],
        requestProfileInstall: async () => { throw new Error('not implemented'); },
        getProfileInstallStatus: async () => { throw new Error('not implemented'); },
      },
      ai: { text: { generate: async () => { throw new Error(); }, stream: async () => { throw new Error(); } }, embedding: { generate: async () => { throw new Error(); } } },
      media: { image: { generate: async () => { throw new Error(); }, stream: async () => { throw new Error(); } }, video: { generate: async () => { throw new Error(); }, stream: async () => { throw new Error(); } }, tts: { synthesize: async () => { throw new Error(); }, stream: async () => { throw new Error(); }, listVoices: async () => { throw new Error(); } }, stt: { transcribe: async () => { throw new Error(); } }, jobs: { submit: async () => { throw new Error(); }, get: async () => { throw new Error(); }, cancel: async () => { throw new Error(); }, subscribe: async () => { throw new Error(); }, getArtifacts: async () => { throw new Error(); } } },
      voice: { getAsset: async () => { throw new Error(); }, listAssets: async () => { throw new Error(); }, deleteAsset: async () => { throw new Error(); }, listPresetVoices: async () => { throw new Error(); } },
    },
    ui: {
      useAppStore: () => undefined as never,
      SlotHost: (() => null) as never,
      useUiExtensionContext: () => ({ isAuthenticated: false, activeTab: 'mods', setActiveTab: () => {}, runtimeFields: {}, setRuntimeFields: () => {} }),
    },
    logging: { emitRuntimeLog: () => {}, createRendererFlowId: (p: string) => `${p}-test`, logRendererEvent: () => {} },
  };
}

function createHealthyRouteRuntime(): ConversationCapabilityRouteRuntime {
  return {
    resolve: async () => ({
      capability: 'text.generate' as const,
      source: 'cloud' as const,
      provider: 'openai',
      model: 'gpt-4o',
      connectorId: 'conn-1',
      endpoint: 'https://api.openai.com/v1',
      resolvedBindingRef: 'ref-1',
    }),
    checkHealth: async () => ({
      healthy: true,
      status: 'healthy' as const,
      detail: 'ok',
    }),
    describe: async () => ({
      capability: 'text.generate' as const,
      metadataKind: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'ref-1',
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    }),
  };
}

function createBatchResult(
  state: string,
  detail: string,
  targets: AISchedulingEvaluationTarget[],
): PeekResult {
  const occupancy = { globalUsed: 0, globalCap: 8, appUsed: 0, appCap: 2 };
  return {
    occupancy,
    aggregateJudgement: {
      state,
      detail,
      occupancy,
      resourceWarnings: state === 'unknown' ? ['telemetry unavailable'] : [],
    },
    targetJudgements: targets.map((target) => ({
      target,
      judgement: {
        state,
        detail: `${target.capability}:${detail}`,
        occupancy,
        resourceWarnings: [],
      },
    })),
  };
}

async function loadSurface() {
  const mod = await import('../src/shell/renderer/app-shell/providers/desktop-ai-config-service.js');
  return {
    getDesktopAIConfigService: mod.getDesktopAIConfigService,
  };
}

function ensureConfigWithBindings(
  surface: ReturnType<Awaited<ReturnType<typeof loadSurface>>['getDesktopAIConfigService']>,
  scopeRef: AIScopeRef,
  bindings: Array<{
    capability: string;
    source: 'cloud' | 'local';
    modId?: string;
    profileId?: string;
  }>,
): void {
  const config = surface.aiConfig.get(scopeRef);
  const selectedBindings: AIConfig['capabilities']['selectedBindings'] = {};
  const localProfileRefs: AIConfig['capabilities']['localProfileRefs'] = {};
  for (const binding of bindings) {
    const selectedBinding: RuntimeRouteBinding = binding.source === 'local'
      ? { source: 'local', model: `${binding.capability}-local`, provider: 'llama', connectorId: '' }
      : { source: 'cloud', connectorId: 'conn-1', model: 'gpt-4o', provider: 'openai' };
    selectedBindings[binding.capability] = selectedBinding;
    if (binding.modId || binding.profileId) {
      const localProfileRef: AIRuntimeLocalProfileRef = {
        modId: String(binding.modId || ''),
        profileId: String(binding.profileId || ''),
      };
      localProfileRefs[binding.capability] = localProfileRef;
    }
  }
  surface.aiConfig.update(scopeRef, {
    ...config,
    capabilities: {
      ...config.capabilities,
      selectedBindings: {
        ...config.capabilities.selectedBindings,
        ...selectedBindings,
      },
      localProfileRefs: {
        ...config.capabilities.localProfileRefs,
        ...localProfileRefs,
      },
    },
  });
}

test('probeFeasibility derives scope aggregate targets from selected local bindings without primary-profile shortcut', async () => {
  const peekCalls: Array<{ appId: string; targets: AISchedulingEvaluationTarget[] }> = [];
  const host = createMockModSdkHost(async (input) => {
    peekCalls.push(input);
    return createBatchResult('queue_required', 'slots occupied', input.targets);
  });

  setInternalModSdkHost(host as never);
  setConversationCapabilityRouteRuntime(createHealthyRouteRuntime());

  try {
    const { getDesktopAIConfigService } = await loadSurface();
    const surface = getDesktopAIConfigService();
    const scopeRef = createDefaultAIScopeRef();
    ensureConfigWithBindings(surface, scopeRef, [
      { capability: 'text.generate', source: 'local', modId: 'core:runtime', profileId: 'text-local' },
      { capability: 'image.generate', source: 'local', modId: 'core:runtime', profileId: 'image-local' },
      { capability: 'video.generate', source: 'cloud' },
    ]);

    const result = await surface.aiConfig.probeFeasibility(scopeRef);

    assert.ok(result.schedulingJudgement);
    assert.equal(result.schedulingJudgement.state, 'queue_required');
    assert.equal(peekCalls.length, 1);
    const firstPeek = peekCalls[0];
    assert.ok(firstPeek);
    assert.equal(firstPeek.appId, 'nimi.desktop');
    assert.deepEqual(
      firstPeek.targets.map((target) => ({
        capability: target.capability,
        modId: target.modId || null,
        profileId: target.profileId || null,
      })),
      [
        { capability: 'image.generate', modId: 'core:runtime', profileId: 'image-local' },
        { capability: 'text.generate', modId: 'core:runtime', profileId: 'text-local' },
      ],
    );
  } finally {
    clearInternalModSdkHost();
    setConversationCapabilityRouteRuntime(null);
  }
});

test('probeSchedulingTarget uses a single target batch and returns the exact target judgement', async () => {
  const peekCalls: Array<{ appId: string; targets: AISchedulingEvaluationTarget[] }> = [];
  const host = createMockModSdkHost(async (input) => {
    peekCalls.push(input);
    const target = input.targets[0];
    assert.ok(target);
    return {
      occupancy: { globalUsed: 1, globalCap: 8, appUsed: 1, appCap: 2 },
      aggregateJudgement: {
        state: 'denied',
        detail: 'text.generate (core:runtime/text-local): blocked',
        occupancy: { globalUsed: 1, globalCap: 8, appUsed: 1, appCap: 2 },
        resourceWarnings: [],
      },
      targetJudgements: [{
        target,
        judgement: {
          state: 'denied',
          detail: 'blocked',
          occupancy: { globalUsed: 1, globalCap: 8, appUsed: 1, appCap: 2 },
          resourceWarnings: [],
        },
      }],
    };
  });

  setInternalModSdkHost(host as never);
  setConversationCapabilityRouteRuntime(createHealthyRouteRuntime());

  try {
    const { getDesktopAIConfigService } = await loadSurface();
    const surface = getDesktopAIConfigService();
    const scopeRef = createDefaultAIScopeRef();
    const result = await surface.aiConfig.probeSchedulingTarget(scopeRef, {
      capability: 'text.generate',
      modId: 'core:runtime',
      profileId: 'text-local',
    });

    assert.ok(result);
    assert.equal(result.state, 'denied');
    assert.equal(result.detail, 'blocked');
    assert.equal(peekCalls.length, 1);
    const firstPeek = peekCalls[0];
    assert.ok(firstPeek);
    assert.equal(firstPeek.appId, 'nimi.desktop');
    assert.equal(firstPeek.targets.length, 1);
    const firstTarget = firstPeek.targets[0];
    assert.ok(firstTarget);
    assert.equal(firstTarget.capability, 'text.generate');
  } finally {
    clearInternalModSdkHost();
    setConversationCapabilityRouteRuntime(null);
  }
});

test('probeFeasibility returns denied -> unavailable aggregate status', async () => {
  const host = createMockModSdkHost(async (input) => createBatchResult('denied', 'device has no GPU available', input.targets));

  setInternalModSdkHost(host as never);
  setConversationCapabilityRouteRuntime(createHealthyRouteRuntime());

  try {
    const { getDesktopAIConfigService } = await loadSurface();
    const surface = getDesktopAIConfigService();
    const scopeRef = createDefaultAIScopeRef();
    ensureConfigWithBindings(surface, scopeRef, [
      { capability: 'text.generate', source: 'local', modId: 'core:runtime', profileId: 'text-local' },
    ]);

    const result = await surface.aiConfig.probeFeasibility(scopeRef);

    assert.ok(result.schedulingJudgement);
    assert.equal(result.schedulingJudgement.state, 'denied');
    assert.equal(result.status, 'unavailable');
  } finally {
    clearInternalModSdkHost();
    setConversationCapabilityRouteRuntime(null);
  }
});

test('probeFeasibility returns null schedulingJudgement when batch peek throws', async () => {
  const host = createMockModSdkHost(async () => {
    throw new Error('runtime not available');
  });

  setInternalModSdkHost(host as never);
  setConversationCapabilityRouteRuntime(createHealthyRouteRuntime());

  try {
    const { getDesktopAIConfigService } = await loadSurface();
    const surface = getDesktopAIConfigService();
    const scopeRef = createDefaultAIScopeRef();
    ensureConfigWithBindings(surface, scopeRef, [
      { capability: 'text.generate', source: 'local', modId: 'core:runtime', profileId: 'text-local' },
    ]);

    const result = await surface.aiConfig.probeFeasibility(scopeRef);

    assert.equal(result.schedulingJudgement, null);
    assert.equal(result.status, 'degraded');
  } finally {
    clearInternalModSdkHost();
    setConversationCapabilityRouteRuntime(null);
  }
});
