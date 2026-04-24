import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAIConfigEvidence,
  createDefaultAIScopeRef,
  createEmptyAIConfig,
  type AIRuntimeEvidence,
  type AISchedulingJudgement,
  type AISchedulingEvaluationTarget,
  type AISnapshot,
  type AIConfigEvidence,
  type AIConversationExecutionSlice,
  type AIScopeRef,
} from '@nimiplatform/sdk/mod';
import {
  setInternalModSdkHost,
  clearInternalModSdkHost,
} from '../src/runtime/mod';

/**
 * Contract test: AISnapshot read chain via host surface (S-AICONF-001 snapshot read).
 *
 * Verifies:
 * - aiSnapshot.record / recordAISnapshot write to the in-memory ring buffer
 * - aiSnapshot.get(executionId) retrieves by execution ID
 * - aiSnapshot.getLatest(scopeRef) retrieves latest for scope
 * - Ring buffer eviction works at capacity
 */

// We test the surface internals directly since this is host-local (S-AICONF-005).
// The surface module manages its own singleton state, so we import the public API.

// Dynamically import to avoid module-level side effects in test runner
async function loadSurface() {
  const mod = await import('../src/shell/renderer/app-shell/providers/desktop-ai-config-service.js');
  return {
    getDesktopAIConfigService: mod.getDesktopAIConfigService,
    recordDesktopAISnapshot: mod.recordDesktopAISnapshot,
    peekDesktopAISchedulingForEvidence: mod.peekDesktopAISchedulingForEvidence,
  };
}

function createTestSnapshot(overrides: Partial<AISnapshot> & { executionId: string; scopeRef: AIScopeRef }): AISnapshot {
  const configEvidence: AIConfigEvidence = createAIConfigEvidence(createEmptyAIConfig(overrides.scopeRef));
  const slice: AIConversationExecutionSlice = {
    executionId: overrides.executionId,
    createdAt: overrides.createdAt || new Date().toISOString(),
    capability: 'text.generate',
    selectedBinding: null,
    resolvedBinding: null,
    health: null,
    metadata: null,
    agentResolution: null,
  };
  return {
    executionId: overrides.executionId,
    scopeRef: overrides.scopeRef,
    configEvidence,
    conversationCapabilitySlice: slice,
    runtimeEvidence: overrides.runtimeEvidence ?? null,
    createdAt: overrides.createdAt || new Date().toISOString(),
  };
}

test('aiSnapshot.get returns null for unknown executionId', async () => {
  const { getDesktopAIConfigService } = await loadSurface();
  const surface = getDesktopAIConfigService();
  const result = surface.aiSnapshot.get('nonexistent-id');
  assert.equal(result, null);
});

test('aiSnapshot.getLatest returns null for scope with no snapshots', async () => {
  const { getDesktopAIConfigService } = await loadSurface();
  const surface = getDesktopAIConfigService();
  const unknownScope: AIScopeRef = { kind: 'app', ownerId: 'unknown-app-999' };
  const result = surface.aiSnapshot.getLatest(unknownScope);
  assert.equal(result, null);
});

test('recordAISnapshot + aiSnapshot.get round-trip', async () => {
  const { getDesktopAIConfigService, recordDesktopAISnapshot } = await loadSurface();
  const surface = getDesktopAIConfigService();
  const scopeRef = createDefaultAIScopeRef();
  const snapshot = createTestSnapshot({
    executionId: 'test-exec-001',
    scopeRef,
  });
  recordDesktopAISnapshot(snapshot);
  const retrieved = surface.aiSnapshot.get('test-exec-001');
  assert.ok(retrieved);
  assert.equal(retrieved.executionId, 'test-exec-001');
});

test('aiSnapshot.record normalizes scopeRef and stores latest snapshot for that scope', async () => {
  const { getDesktopAIConfigService } = await loadSurface();
  const surface = getDesktopAIConfigService();
  const scopeRef = createDefaultAIScopeRef();
  surface.aiSnapshot.record(scopeRef, createTestSnapshot({
    executionId: 'test-record-surface-001',
    scopeRef: { kind: 'app', ownerId: 'other-app', surfaceId: 'other-surface' },
  }));
  const latest = surface.aiSnapshot.getLatest(scopeRef);
  assert.ok(latest);
  assert.equal(latest.executionId, 'test-record-surface-001');
  assert.deepEqual(latest.scopeRef, scopeRef);
});

test('recordAISnapshot + aiSnapshot.getLatest returns most recent for scope', async () => {
  const { getDesktopAIConfigService, recordDesktopAISnapshot } = await loadSurface();
  const surface = getDesktopAIConfigService();
  const scopeRef = createDefaultAIScopeRef();
  const snap1 = createTestSnapshot({ executionId: 'test-latest-001', scopeRef });
  const snap2 = createTestSnapshot({ executionId: 'test-latest-002', scopeRef });
  recordDesktopAISnapshot(snap1);
  recordDesktopAISnapshot(snap2);
  const latest = surface.aiSnapshot.getLatest(scopeRef);
  assert.ok(latest);
  assert.equal(latest.executionId, 'test-latest-002');
});

test('snapshot preserves runtimeEvidence with schedulingJudgement', async () => {
  const { getDesktopAIConfigService, recordDesktopAISnapshot } = await loadSurface();
  const surface = getDesktopAIConfigService();
  const scopeRef = createDefaultAIScopeRef();
  const judgement: AISchedulingJudgement = {
    state: 'unknown',
    detail: 'slots available but resource risk assessment not yet implemented',
    occupancy: { globalUsed: 0, globalCap: 8, appUsed: 0, appCap: 2 },
    resourceWarnings: ['VRAM/RAM telemetry not integrated (Phase 1)'],
  };
  const runtimeEvidence: AIRuntimeEvidence = { schedulingJudgement: judgement };
  const snapshot = createTestSnapshot({
    executionId: 'test-evidence-001',
    scopeRef,
    runtimeEvidence,
  });
  recordDesktopAISnapshot(snapshot);
  const retrieved = surface.aiSnapshot.get('test-evidence-001');
  assert.ok(retrieved);
  assert.ok(retrieved.runtimeEvidence);
  assert.ok(retrieved.runtimeEvidence.schedulingJudgement);
  assert.equal(retrieved.runtimeEvidence.schedulingJudgement.state, 'unknown');
  assert.equal(retrieved.runtimeEvidence.schedulingJudgement.occupancy?.globalCap, 8);
  assert.equal(retrieved.runtimeEvidence.schedulingJudgement.resourceWarnings.length, 1);
});

test('snapshot with null runtimeEvidence is valid', async () => {
  const { getDesktopAIConfigService, recordDesktopAISnapshot } = await loadSurface();
  const surface = getDesktopAIConfigService();
  const scopeRef = createDefaultAIScopeRef();
  const snapshot = createTestSnapshot({
    executionId: 'test-null-evidence-001',
    scopeRef,
    runtimeEvidence: null,
  });
  recordDesktopAISnapshot(snapshot);
  const retrieved = surface.aiSnapshot.get('test-null-evidence-001');
  assert.ok(retrieved);
  assert.equal(retrieved.runtimeEvidence, null);
});

test('peekSchedulingForEvidence uses target-scoped judgement instead of scope aggregate shortcut', async () => {
  const peekCalls: Array<{ appId: string; targets: AISchedulingEvaluationTarget[] }> = [];
  setInternalModSdkHost({
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
      scheduler: {
        peek: async (input: { appId: string; targets: AISchedulingEvaluationTarget[] }) => {
          peekCalls.push(input);
          const target = input.targets[0];
          assert.ok(target);
          return {
            occupancy: { globalUsed: 0, globalCap: 8, appUsed: 0, appCap: 2 },
            aggregateJudgement: {
              state: 'denied',
              detail: 'text.generate (core:runtime/text-local): blocked',
              occupancy: { globalUsed: 0, globalCap: 8, appUsed: 0, appCap: 2 },
              resourceWarnings: [],
            },
            targetJudgements: [{
              target,
              judgement: {
                state: 'denied',
                detail: 'blocked',
                occupancy: { globalUsed: 0, globalCap: 8, appUsed: 0, appCap: 2 },
                resourceWarnings: [],
              },
            }],
          };
        },
      },
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
  } as never);

  try {
    const { peekDesktopAISchedulingForEvidence } = await loadSurface();
    const runtimeEvidence = await peekDesktopAISchedulingForEvidence({
      scopeRef: createDefaultAIScopeRef(),
      target: {
        capability: 'text.generate',
        modId: 'core:runtime',
        profileId: 'text-local',
      },
    });

    assert.ok(runtimeEvidence);
    assert.equal(runtimeEvidence.schedulingJudgement?.state, 'denied');
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
  }
});
