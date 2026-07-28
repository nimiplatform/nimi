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
      previewMaterialRef: `agent-center-avatar-asset:account-1:local-agent-ren:${avatarAssetRef}`,
      validationStatus: 'valid',
      warnings: [],
    }),
    ...overrides,
  };
}

function avatarPreviewAdapter() {
  return {
    async resolvePreview(input: {
      readonly avatarAssetRef: string;
      readonly backendKind: 'live2d' | 'vrm';
      readonly previewMaterialRef: string;
    }) {
      return {
        state: 'ready' as const,
        tier: 'avatar_preview_service' as const,
        backendKind: input.backendKind,
        avatarAssetRef: input.avatarAssetRef,
        previewMaterialRef: input.previewMaterialRef,
        previewImageRef: `/__nimi/avatar-preview/${input.backendKind}/123`,
        visiblePixels: 32,
        nonPlaceholder: true as const,
        warnings: ['preview rendered through avatar service'],
      };
    },
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

  it('does not expose account-wide cleanup through a single-agent transaction adapter', async () => {
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

    expect((adapter as unknown as Record<string, unknown>).removeAccountResources).toBeUndefined();
    expect(calls).toEqual([]);
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
      avatarPreview: avatarPreviewAdapter(),
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
      previewMaterialRef: expect.stringContaining('vrm_222222222222'),
      previewImageRef: '/__nimi/avatar-preview/vrm/123',
      previewVisiblePixels: 32,
      backgroundRef: 'bg_111111111111',
      backgroundValid: true,
      defaultVoiceReference: 'preset_voice_id:zh-CN',
      avatarAutoplay: true,
    });
  });

  it('projects Avatar-owned renderer output without local placeholder success', async () => {
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          return mutationResult(patch);
        },
      },
      shell: shellBridge(),
      avatarPreview: avatarPreviewAdapter(),
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
      previewMaterialRef: expect.stringContaining('live2d_111111111111'),
      previewImageRef: '/__nimi/avatar-preview/live2d/123',
      previewVisiblePixels: 32,
      previewWarnings: ['preview rendered through avatar service'],
    });
  });

  it('never upgrades Shell preview material into Avatar render success', async () => {
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
      status: 'invalid',
      previewMaterialRef: expect.stringContaining('live2d_111111111111'),
      previewState: 'unavailable',
      previewTier: 'avatar_preview_service',
      previewImageRef: null,
      previewFailureReason: 'Avatar preview service adapter is unavailable.',
    });
  });

  it('fails closed for a foreign renderer image', async () => {
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          return mutationResult(patch);
        },
      },
      shell: shellBridge(),
      avatarPreview: {
        async resolvePreview(input) {
          return {
            state: 'ready' as const,
            tier: 'avatar_preview_service' as const,
            backendKind: input.backendKind,
            avatarAssetRef: input.avatarAssetRef,
            previewMaterialRef: input.previewMaterialRef,
            previewImageRef: 'blob:https://foreign-origin.example/preview-id',
            visiblePixels: 32,
            nonPlaceholder: true as const,
          };
        },
      },
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
      status: 'invalid',
      previewState: 'failed',
      previewImageRef: null,
    });
  });

  it('fails closed when Avatar preview output does not match selected material', async () => {
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          return mutationResult(patch);
        },
      },
      shell: shellBridge(),
      avatarPreview: {
        async resolvePreview() {
          return {
            state: 'ready' as const,
            tier: 'avatar_preview_service' as const,
            backendKind: 'vrm' as const,
            avatarAssetRef: 'vrm_other',
            previewMaterialRef: 'agent-center-avatar-asset:other',
            previewImageRef: '/__nimi/avatar-preview/vrm/other',
            visiblePixels: 32,
            nonPlaceholder: true as const,
          };
        },
      },
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
      previewState: 'failed',
      previewImageRef: null,
      previewFailureReason: expect.any(String),
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

    expect(patches).toEqual([{
      backendKind: 'live2d',
      avatarAssetRef: 'live2d_111111111111',
      expressionProfileRef: null,
      idlePreset: null,
      interactionPolicyRef: null,
    }]);
    expect(expectedRevisions).toEqual(['1']);
    expect(projection).toMatchObject({
      status: 'invalid',
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

  it('does not rewind committed state to the constructor snapshot after a cancelled import', async () => {
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          return mutationResult(patch);
        },
      },
      shell: shellBridge({ importLive2dAvatarAsset: async () => null }),
      snapshot: snapshot(null),
    });

    await adapter.setAvatarAutoplay?.(true);
    await expect(adapter.importAvatarAsset?.('live2d')).resolves.toMatchObject({
      avatarAutoplay: true,
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

  it('clears Runtime background ref before removing background custody', async () => {
    const calls: string[] = [];
    const patches: AgentCenterRuntimePresentationProfilePatch[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          calls.push('runtime-clear');
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

    expect(calls).toEqual(['runtime-clear', 'remove:bg_111111111111']);
    expect(patches).toEqual([{ backgroundAssetRef: '' }]);
  });

  it.each([
    ['missing Shell bridge', null],
    ['missing background removal capability', shellBridge({ removeBackground: undefined })],
  ])('surfaces cleanup debt when clearing a background with %s', async (_name, shell) => {
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          return mutationResult(patch);
        },
      },
      shell,
      snapshot: snapshot({
        backendKind: null,
        avatarAssetRef: null,
        expressionProfileRef: null,
        idlePreset: null,
        interactionPolicyRef: null,
        defaultVoiceReference: null,
        avatarAutoplay: false,
        backgroundAssetRef: 'bg_111111111111',
      }),
    });

    await expect(adapter.clearBackground?.()).resolves.toMatchObject({
      backgroundRef: null,
      resourceCleanupError: expect.stringMatching(/bg_111111111111.*unavailable/u),
    });
  });

  it('serializes concurrent Runtime mutations against the latest committed revision', async () => {
    const expectedRevisions: string[] = [];
    let revision = 1;
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch, expectedRevision) {
          expectedRevisions.push(expectedRevision);
          await Promise.resolve();
          revision += 1;
          return mutationResult(patch, String(revision));
        },
      },
      shell: shellBridge(),
      snapshot: snapshot(null),
    });

    await Promise.all([
      adapter.setAvatarAutoplay?.(true),
      adapter.importBackground?.(),
    ]);

    expect(expectedRevisions).toEqual(['1', '2']);
  });

  it('clears Runtime selection before Shell cleanup and preserves committed clear on cleanup failure', async () => {
    const calls: string[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          calls.push('runtime-clear');
          return mutationResult(patch);
        },
      },
      shell: shellBridge({
        async removeBackground() {
          calls.push('shell-remove');
          throw new Error('custody delete failed');
        },
      }),
      snapshot: snapshot({
        backendKind: null,
        avatarAssetRef: null,
        expressionProfileRef: null,
        idlePreset: null,
        interactionPolicyRef: null,
        defaultVoiceReference: null,
        avatarAutoplay: false,
        backgroundAssetRef: 'bg_111111111111',
      }),
    });

    await expect(adapter.clearBackground?.()).resolves.toMatchObject({
      backgroundRef: null,
      resourceCleanupError: 'custody delete failed',
    });
    expect(calls).toEqual(['runtime-clear', 'shell-remove']);
  });

  it('clears backend-dependent fields with the selected avatar', async () => {
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
      snapshot: snapshot({
        backendKind: 'live2d',
        avatarAssetRef: 'live2d_111111111111',
        expressionProfileRef: 'expression-profile:one',
        idlePreset: 'idle-preset:one',
        interactionPolicyRef: 'interaction-policy:one',
        defaultVoiceReference: 'preset_voice_id:zh-CN',
        avatarAutoplay: true,
        backgroundAssetRef: 'bg_111111111111',
      }),
    });

    await adapter.clearAvatarAsset?.();

    expect(patches).toEqual([{
      backendKind: null,
      avatarAssetRef: '',
      expressionProfileRef: null,
      idlePreset: null,
      interactionPolicyRef: null,
    }]);
    expect((adapter as unknown as Record<string, unknown>).removeAccountResources).toBeUndefined();
  });

  it('returns committed invalid state when post-commit Shell validation fails', async () => {
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          return mutationResult(patch);
        },
      },
      shell: shellBridge({
        async validateAvatarAsset() {
          throw new Error('custody validation unavailable');
        },
      }),
      snapshot: snapshot(null),
    });

    await expect(adapter.importAvatarAsset?.('live2d')).resolves.toMatchObject({
      status: 'invalid',
      avatarAssetRef: 'live2d_111111111111',
      validationStatus: 'invalid',
      validationMessage: 'custody validation unavailable',
    });
  });

  it('commits agent selection clear before agent custody cleanup', async () => {
    const calls: string[] = [];
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account-1',
      runtimePresentation: {
        async patchPresentationProfile(_identity, patch) {
          calls.push('runtime-clear');
          return mutationResult(patch);
        },
      },
      shell: shellBridge({
        async removeAgentResources() {
          calls.push('shell-cleanup');
          throw new Error('agent custody cleanup failed');
        },
      }),
      snapshot: snapshot({
        backendKind: 'live2d',
        avatarAssetRef: 'live2d_111111111111',
        expressionProfileRef: 'expression-profile:one',
        idlePreset: 'idle-preset:one',
        interactionPolicyRef: 'interaction-policy:one',
        defaultVoiceReference: 'preset_voice_id:zh-CN',
        avatarAutoplay: true,
        backgroundAssetRef: 'bg_111111111111',
      }),
    });

    await expect(adapter.removeAgentResources?.()).resolves.toMatchObject({
      status: 'not_configured',
      avatarAssetRef: null,
      backgroundRef: null,
      resourceCleanupError: 'agent custody cleanup failed',
    });
    expect(calls).toEqual(['runtime-clear', 'shell-cleanup']);
  });
});
