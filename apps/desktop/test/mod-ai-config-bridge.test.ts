import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAIConfigEvidence,
  createCanonicalModAIScopeRef,
  createDefaultAIScopeRef,
  createEmptyAIConfig,
  type AIScopeRef,
  type AISchedulingEvaluationTarget,
  type AISnapshot,
  type RuntimeRouteBinding,
} from '@nimiplatform/sdk/mod';
import {
  clearInternalModSdkHost,
  setInternalModSdkHost,
} from '../src/runtime/mod';
import { buildRuntimeHostCapabilities } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.js';
import {
  getDesktopAIConfigService,
  recordDesktopAISnapshot,
} from '../src/shell/renderer/app-shell/providers/desktop-ai-config-service.js';
import {
  setConversationCapabilityRouteRuntime,
  type ConversationCapabilityRouteRuntime,
} from '../src/shell/renderer/features/chat/conversation-capability.js';

function createHost() {
  return buildRuntimeHostCapabilities({
    checkLocalLlmHealth: async () => ({ healthy: true, status: 'healthy', detail: 'ok' }) as never,
    executeLocalKernelTurn: async () => ({ outputText: '' }) as never,
    withOpenApiContextLock: async (_context, task) => task(),
    getRuntimeHookRuntime: () => ({
      setModLocalProfileSnapshotResolver: () => undefined,
      authorizeRuntimeCapability: () => undefined,
    }) as never,
  });
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

function createSchedulerSdkHost(
  peek: (input: { appId: string; targets: AISchedulingEvaluationTarget[] }) => Promise<{
    occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
    aggregateJudgement: {
      state: string;
      detail: string;
      occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
      resourceWarnings: string[];
    } | null;
    targetJudgements: Array<{
      target: AISchedulingEvaluationTarget;
      judgement: {
        state: string;
        detail: string;
        occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
        resourceWarnings: string[];
      };
    }>;
  }>,
) {
  return {
    runtime: {
      getRuntimeHookRuntime: () => ({ setModLocalProfileSnapshotResolver: () => undefined }),
      scheduler: {
        peek,
      },
    },
    ui: {
      useAppStore: () => undefined as never,
      SlotHost: (() => null) as never,
      useUiExtensionContext: () => ({
        isAuthenticated: false,
        activeTab: 'mods',
        setActiveTab: () => undefined,
        runtimeFields: {},
        setRuntimeFields: () => undefined,
      }),
    },
    logging: {
      emitRuntimeLog: () => undefined,
      createRendererFlowId: (prefix: string) => `${prefix}-test`,
      logRendererEvent: () => undefined,
    },
  };
}

function updateConfig(
  scopeRef: AIScopeRef,
  bindings: Record<string, RuntimeRouteBinding>,
  localProfileRefs: Record<string, { modId: string; profileId: string } | null> = {},
): void {
  const service = getDesktopAIConfigService();
  const base = service.aiConfig.get(scopeRef);
  service.aiConfig.update(scopeRef, {
    ...base,
    capabilities: {
      ...base.capabilities,
      selectedBindings: {
        ...base.capabilities.selectedBindings,
        ...bindings,
      },
      localProfileRefs: {
        ...base.capabilities.localProfileRefs,
        ...localProfileRefs,
      },
    },
  });
}

function createSnapshot(executionId: string, scopeRef: AIScopeRef): AISnapshot {
  return {
    executionId,
    scopeRef,
    configEvidence: createAIConfigEvidence(createEmptyAIConfig(scopeRef)),
    conversationCapabilitySlice: {
      executionId,
      createdAt: new Date().toISOString(),
      capability: 'text.generate',
      selectedBinding: null,
      resolvedBinding: null,
      health: null,
      metadata: null,
      agentResolution: null,
    },
    runtimeEvidence: null,
    createdAt: new Date().toISOString(),
  };
}

test('desktop mod aiConfig bridge lists and reads only canonical mod workspace scope', () => {
  const host = createHost();
  const modId = 'world.nimi.bridge.desktop.scope-list';
  const modScope = createCanonicalModAIScopeRef(modId);
  const chatScope = createDefaultAIScopeRef();
  const nonCanonicalScope = { kind: 'mod', ownerId: modId, surfaceId: 'other' } as const;

  updateConfig(chatScope, {
    'text.generate': { source: 'cloud', connectorId: 'chat-conn', provider: 'openai', model: 'chat-model' },
  });
  updateConfig(nonCanonicalScope, {
    'text.generate': { source: 'cloud', connectorId: 'other-conn', provider: 'openai', model: 'other-model' },
  });
  host.runtime.aiConfig.update({
    modId,
    scopeRef: modScope,
    config: createEmptyAIConfig(modScope),
  });

  const scopes = host.runtime.aiConfig.listScopes({ modId });
  const config = host.runtime.aiConfig.get({ modId, scopeRef: modScope });

  assert.deepEqual(scopes, [modScope]);
  assert.deepEqual(config.scopeRef, modScope);
});

test('desktop mod aiConfig bridge requires explicit canonical mod scope and never falls back to chat scope', () => {
  const host = createHost();
  const modId = 'world.nimi.bridge.desktop.explicit';

  updateConfig(createDefaultAIScopeRef(), {
    'text.generate': { source: 'cloud', connectorId: 'chat-conn', provider: 'openai', model: 'chat-model' },
  });

  assert.throws(
    () => host.runtime.aiConfig.get({ modId, scopeRef: undefined as never }),
    /scopeRef is required/,
  );
  assert.throws(
    () => host.runtime.aiConfig.get({
      modId,
      scopeRef: createDefaultAIScopeRef(),
    }),
    /must equal mod:/,
  );
});

test('desktop mod aiConfig bridge forwards feasibility and target probes through shared desktop host service', async () => {
  const modId = 'world.nimi.bridge.desktop.probe';
  const modScope = createCanonicalModAIScopeRef(modId);
  const host = createHost();
  const peekCalls: Array<{ appId: string; targets: AISchedulingEvaluationTarget[] }> = [];

  setInternalModSdkHost(createSchedulerSdkHost(async (input) => {
    peekCalls.push(input);
    const occupancy = { globalUsed: 1, globalCap: 8, appUsed: 1, appCap: 2 };
    return {
      occupancy,
      aggregateJudgement: {
        state: 'queue_required',
        detail: 'slots occupied',
        occupancy,
        resourceWarnings: [],
      },
      targetJudgements: input.targets.map((target) => ({
        target,
        judgement: {
          state: 'denied',
          detail: 'blocked',
          occupancy,
          resourceWarnings: [],
        },
      })),
    };
  }) as never);
  setConversationCapabilityRouteRuntime(createHealthyRouteRuntime());

  try {
    host.runtime.aiConfig.update({
      modId,
      scopeRef: modScope,
      config: {
        ...createEmptyAIConfig(modScope),
        capabilities: {
          selectedBindings: {
            'text.generate': { source: 'local', connectorId: '', provider: 'llama', model: 'text-local' },
          },
          localProfileRefs: {
            'text.generate': { modId: 'core:runtime', profileId: 'text-local' },
          },
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });

    const feasibility = await host.runtime.aiConfig.probeFeasibility({
      modId,
      scopeRef: modScope,
    });
    const targetJudgement = await host.runtime.aiConfig.probeSchedulingTarget({
      modId,
      scopeRef: modScope,
      target: {
        capability: 'text.generate',
        modId: 'core:runtime',
        profileId: 'text-local',
      },
    });

    assert.equal(feasibility.schedulingJudgement?.state, 'queue_required');
    assert.equal(targetJudgement?.state, 'denied');
    assert.equal(peekCalls.length, 2);
    assert.equal(peekCalls[0]?.appId, 'nimi.desktop');
    assert.equal(peekCalls[1]?.appId, 'nimi.desktop');
    assert.deepEqual(peekCalls[0]?.targets, [{
      capability: 'text.generate',
      modId: 'core:runtime',
      profileId: 'text-local',
      resourceHint: null,
    }]);
  } finally {
    clearInternalModSdkHost();
    setConversationCapabilityRouteRuntime(null);
  }
});

test('desktop mod aiSnapshot bridge reads caller scope and blocks chat-scope snapshot access', () => {
  const host = createHost();
  const modId = 'world.nimi.bridge.desktop.snapshot';
  const modScope = createCanonicalModAIScopeRef(modId);
  const chatScope = createDefaultAIScopeRef();

  host.runtime.aiSnapshot.record({
    modId,
    scopeRef: modScope,
    snapshot: createSnapshot('mod-snapshot-001', modScope),
  });
  recordDesktopAISnapshot({
    ...createSnapshot('chat-snapshot-001', modScope),
    executionId: 'chat-snapshot-001',
    scopeRef: chatScope,
  });

  const latest = host.runtime.aiSnapshot.getLatest({
    modId,
    scopeRef: modScope,
  });

  assert.ok(latest);
  assert.equal(latest.executionId, 'mod-snapshot-001');
  assert.equal(host.runtime.aiSnapshot.get({ modId, executionId: 'missing-snapshot-001' }), null);
  assert.throws(
    () => host.runtime.aiSnapshot.get({ modId, executionId: 'chat-snapshot-001' }),
    /does not belong to mod/,
  );
});

test('desktop mod aiSnapshot bridge requires explicit canonical mod scope for record', () => {
  const host = createHost();
  const modId = 'world.nimi.bridge.desktop.snapshot.explicit';

  assert.throws(
    () => host.runtime.aiSnapshot.record({
      modId,
      scopeRef: createDefaultAIScopeRef(),
      snapshot: createSnapshot('chat-scope-record-001', createDefaultAIScopeRef()),
    }),
    /must equal mod:/,
  );
});
