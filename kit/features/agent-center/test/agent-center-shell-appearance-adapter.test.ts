import { describe, expect, it } from 'vitest';

import {
  createAgentCenterShellAppearanceAdapter,
  type AgentCenterShellAppearanceBridge,
} from '../src/headless.js';
import type {
  AgentCenterRuntimePresentationProfileMutationResult,
  AgentCenterRuntimePresentationProfilePatch,
  AgentCenterRuntimeSnapshot,
} from '../src/types.js';

const identity = {
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'runtime-source:local',
  localAgentRef: 'local-agent:ren',
};

type PresentationProfile = NonNullable<AgentCenterRuntimeSnapshot['inspect']>['presentationProfile'];

function snapshot(profile: PresentationProfile, presentationProfileRevision = '1'): AgentCenterRuntimeSnapshot {
  return {
    inspect: {
      lifecycleStatus: 'active',
      executionState: 'idle',
      statusText: 'ready',
      activeWorldId: null,
      activeUserId: null,
      updatedAt: null,
      currentEmotion: 'calm',
      proactiveInterruptibility: null,
      presentationProfile: profile,
      presentationProfileRevision,
      autonomyMode: null,
      autonomyEnabled: null,
      autonomyBudgetExhausted: null,
      autonomyUsedTokensInWindow: null,
      autonomyDailyTokenBudget: null,
      autonomyMaxTokensPerHook: null,
      autonomyWindowStartedAt: null,
      autonomySuspendedUntil: null,
      pendingHooksCount: 0,
      nextScheduledFor: null,
      pendingHooks: [],
      recentTerminalHooks: [],
      recentCanonicalMemories: [],
    } as never,
  };
}

function mutationResult(
  patch: AgentCenterRuntimePresentationProfilePatch,
  committedRevision = '2',
): AgentCenterRuntimePresentationProfileMutationResult {
  return {
    profile: {
      backendKind: normalizeMutationBackendKind(patch.backendKind),
      avatarAssetRef: normalizeMutationText(patch.avatarAssetRef),
      expressionProfileRef: normalizeMutationText(patch.expressionProfileRef),
      idlePreset: normalizeMutationText(patch.idlePreset),
      interactionPolicyRef: normalizeMutationText(patch.interactionPolicyRef),
      defaultVoiceReference: normalizeMutationText(patch.defaultVoiceReference),
      avatarAutoplay: patch.avatarAutoplay ?? false,
      backgroundAssetRef: normalizeMutationText(patch.backgroundAssetRef),
    },
    committedRevision,
  };
}

function normalizeMutationBackendKind(
  value: string | null | undefined,
): 'live2d' | 'vrm' | 'sprite2d' | 'canvas2d' | 'video' | null {
  return value === 'live2d'
    || value === 'vrm'
    || value === 'sprite2d'
    || value === 'canvas2d'
    || value === 'video'
    ? value
    : null;
}

function normalizeMutationText(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function shellBridge(overrides: Partial<AgentCenterShellAppearanceBridge> = {}): AgentCenterShellAppearanceBridge {
  return {
    importLive2dAvatarAsset: async () => ({
      avatarAssetRef: 'live2d_111111111111',
      backendKind: 'live2d',
      validationStatus: 'valid',
    }),
    importVrmAvatarAsset: async () => ({
      avatarAssetRef: 'vrm_222222222222',
      backendKind: 'vrm',
      validationStatus: 'valid',
    }),
    validateAvatarAsset: async ({ avatarAssetRef }) => ({
      avatarAssetRef,
      backendKind: avatarAssetRef.startsWith('vrm_') ? 'vrm' : 'live2d',
      validationStatus: 'valid',
      backendCapabilityProfileRef: `avatar.backend_profile:${avatarAssetRef}`,
    }),
    importLive2dAdapterManifest: async ({ avatarAssetRef }) => ({
      avatarAssetRef,
      live2dAdapterManifestRef: 'live2d_adapter_111111111111',
      live2dAdapterManifestSource: 'external_sidecar_manifest',
    }),
    importBackground: async () => ({
      backgroundAssetRef: 'bg_111111111111',
      validationStatus: 'valid',
    }),
    validateBackground: async ({ backgroundAssetRef }) => ({
      backgroundAssetRef,
      validationStatus: 'valid',
    }),
    removeBackground: async ({ backgroundAssetRef }) => ({ removed: true, backgroundAssetRef }),
    removeAgentResources: async () => ({ removed: true }),
    removeAccountResources: async () => ({ removed: true }),
    resolveAvatarAssetPreview: async ({ avatarAssetRef }) => ({
      avatarAssetRef,
      backendKind: avatarAssetRef.startsWith('vrm_') ? 'vrm' : 'live2d',
      previewArtifactRef: `agent-center-preview:${avatarAssetRef}`,
      validationStatus: 'valid',
      warnings: ['preview rendered through avatar service'],
    }),
    ...overrides,
  };
}

describe('createAgentCenterShellAppearanceAdapter', () => {
  it('passes complete Runtime identity through Shell custody calls', async () => {
    const calls: unknown[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          return mutationResult(patch);
        },
      },
      shell: shellBridge({
        importLive2dAvatarAsset: async (scope) => {
          calls.push(scope);
          return {
            avatarAssetRef: 'live2d_111111111111',
            backendKind: 'live2d',
            validationStatus: 'valid',
          };
        },
      }),
      snapshot: snapshot(null),
    });

    await adapter.importAvatarAsset?.('live2d');

    expect(calls).toEqual([{
      hostScope: 'local-agent',
      accountId: 'account-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'runtime-source:local',
      localAgentRef: 'local-agent:ren',
    }]);
  });

  it('passes explicit account scope through account resource cleanup', async () => {
    const calls: unknown[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          return mutationResult(patch);
        },
      },
      shell: shellBridge({
        removeAccountResources: async (scope) => {
          calls.push(scope);
          return { removed: true };
        },
      }),
      snapshot: snapshot(null),
    });

    await adapter.removeAccountResources?.();

    expect(calls).toEqual([{
      hostScope: 'account',
      accountId: 'account-1',
    }]);
  });

  it('composes Runtime presentation selection with Shell validation custody', async () => {
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          return mutationResult(patch);
        },
      },
      shell: shellBridge(),
      snapshot: snapshot({
        backendKind: 'vrm',
        avatarAssetRef: 'vrm_222222222222',
        expressionProfileRef: null,
        idlePreset: null,
        interactionPolicyRef: null,
        defaultVoiceReference: 'preset_voice_id:zh-CN',
        avatarAutoplay: true,
        backgroundAssetRef: 'bg_111111111111',
      }),
    });

    await expect(adapter.load()).resolves.toMatchObject({
      status: 'ready',
      backendKind: 'vrm',
      avatarAssetRef: 'vrm_222222222222',
      avatarAssetValid: true,
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      previewArtifactRef: 'agent-center-preview:vrm_222222222222',
      backgroundRef: 'bg_111111111111',
      backgroundValid: true,
      defaultVoiceReference: 'preset_voice_id:zh-CN',
      avatarAutoplay: true,
    });
  });

  it('projects Avatar-owned preview service evidence without local placeholder success', async () => {
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          return mutationResult(patch);
        },
      },
      shell: shellBridge(),
      snapshot: snapshot({
        backendKind: 'live2d',
        avatarAssetRef: 'live2d_111111111111',
        expressionProfileRef: null,
        idlePreset: null,
        interactionPolicyRef: null,
        defaultVoiceReference: null,
        avatarAutoplay: false,
        backgroundAssetRef: null,
      }),
    });

    await expect(adapter.load()).resolves.toMatchObject({
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      previewArtifactRef: 'agent-center-preview:live2d_111111111111',
      previewWarnings: ['preview rendered through avatar service'],
    });
  });

  it('imports through Shell custody before committing Runtime presentation selection', async () => {
    const patches: AgentCenterRuntimePresentationProfilePatch[] = [];
    const expectedRevisions: string[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch, expectedRevision) {
          patches.push(patch);
          expectedRevisions.push(expectedRevision);
          return mutationResult(patch);
        },
      },
      shell: shellBridge(),
      snapshot: snapshot(null),
    });

    const projection = await adapter.importAvatarAsset?.('live2d');

    expect(patches).toEqual([{ backendKind: 'live2d', avatarAssetRef: 'live2d_111111111111' }]);
    expect(expectedRevisions).toEqual(['1']);
    expect(projection).toMatchObject({
      status: 'ready',
      avatarAssetRef: 'live2d_111111111111',
      backendKind: 'live2d',
    });
  });

  it('does not return a locally selected pseudo-success when Runtime presentation write fails', async () => {
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile() {
          throw new Error('runtime write rejected');
        },
      },
      shell: shellBridge(),
      snapshot: snapshot(null),
    });

    await expect(adapter.importAvatarAsset?.('vrm')).rejects.toThrow(/runtime write rejected/u);
  });

  it('patches Runtime avatar autoplay without local config fields', async () => {
    const patches: AgentCenterRuntimePresentationProfilePatch[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          patches.push(patch);
          return mutationResult(patch);
        },
      },
      shell: shellBridge(),
      snapshot: snapshot(null),
    });

    await adapter.setAvatarAutoplay?.(true);

    expect(patches).toEqual([{ avatarAutoplay: true }]);
  });

  it('keeps Runtime selection writes available while Shell custody bridge is unavailable', async () => {
    const patches: AgentCenterRuntimePresentationProfilePatch[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          patches.push(patch);
          return mutationResult(patch);
        },
      },
      shell: null,
      snapshot: snapshot({
        backendKind: 'live2d',
        avatarAssetRef: 'live2d_111111111111',
        expressionProfileRef: null,
        idlePreset: null,
        interactionPolicyRef: null,
        defaultVoiceReference: null,
        avatarAutoplay: false,
        backgroundAssetRef: null,
      }),
    });

    const loaded = await adapter.load();
    expect(adapter.importAvatarAsset).toBeUndefined();
    expect(loaded.avatarImportDisabled).toBe(true);

    await adapter.setAvatarAutoplay?.(true);
    expect(patches).toEqual([{ avatarAutoplay: true }]);
  });

  it('returns a cancelled import projection without committing Runtime selection', async () => {
    const patches: AgentCenterRuntimePresentationProfilePatch[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          patches.push(patch);
          return mutationResult(patch);
        },
      },
      shell: shellBridge({
        importLive2dAvatarAsset: async () => null,
      }),
      snapshot: snapshot(null),
    });

    const projection = await adapter.importAvatarAsset?.('live2d');

    expect(patches).toEqual([]);
    expect(projection).toMatchObject({
      status: 'not_configured',
      avatarImportError: 'Avatar import was cancelled before a source was selected.',
    });
  });

  it('rejects backend mismatches before writing Runtime profile', async () => {
    const patches: AgentCenterRuntimePresentationProfilePatch[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          patches.push(patch);
          return mutationResult(patch);
        },
      },
      shell: shellBridge({
        importVrmAvatarAsset: async () => ({
          avatarAssetRef: 'live2d_111111111111',
          backendKind: 'live2d',
          validationStatus: 'valid',
        }),
      }),
      snapshot: snapshot(null),
    });

    await expect(adapter.importAvatarAsset?.('vrm')).rejects.toThrow(/returned live2d for vrm/u);
    expect(patches).toEqual([]);
  });

  it('removes background custody then clears Runtime background ref', async () => {
    const calls: string[] = [];
    const patches: AgentCenterRuntimePresentationProfilePatch[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          patches.push(patch);
          return mutationResult(patch);
        },
      },
      shell: shellBridge({
        removeBackground: async ({ backgroundAssetRef }) => {
          calls.push(`remove:${backgroundAssetRef}`);
          return { removed: true, backgroundAssetRef };
        },
      }),
      snapshot: snapshot({
        backendKind: 'live2d',
        avatarAssetRef: 'live2d_111111111111',
        expressionProfileRef: null,
        idlePreset: null,
        interactionPolicyRef: null,
        defaultVoiceReference: null,
        avatarAutoplay: false,
        backgroundAssetRef: 'bg_111111111111',
      }),
    });

    await adapter.clearBackground?.();

    expect(calls).toEqual(['remove:bg_111111111111']);
    expect(patches).toEqual([{ backgroundAssetRef: '' }]);
  });
});
