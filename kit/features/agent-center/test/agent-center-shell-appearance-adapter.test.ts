import type { RuntimeLocalAgentIdentityInput } from '@nimiplatform/kit/core/sdk-contract';
import { describe, expect, it, vi } from 'vitest';
import { createAgentCenterShellAppearanceAdapter } from '../src/shell-appearance-adapter.js';
import type {
  AgentCenterRuntimePresentationProfileMutationResult,
  AgentCenterRuntimePresentationProfilePatch,
} from '../src/types.js';

const identity = {
  ownerUserId: 'owner', runtimeSourceRef: 'source', localAgentRef: 'local-agent:test',
};
const material = {
  role: 'avatar' as const,
  backendKind: 'vrm' as const,
  fileName: 'avatar.vrm',
  mediaType: 'model/gltf-binary',
  content: Uint8Array.from([1, 2, 3]),
  sha256: 'a'.repeat(64),
  custodyRef: 'custody:new',
};
const emptyProfile = {
  backendKind: null, avatarAssetRef: null, expressionProfileRef: null, idlePreset: null,
  interactionPolicyRef: null, defaultVoiceReference: null, avatarAutoplay: false, backgroundAssetRef: null,
} as const;

function committed(input: {
  readonly ref: string;
  readonly revision: string;
  readonly previous?: AgentCenterRuntimePresentationProfileMutationResult['previousProfile'];
}): AgentCenterRuntimePresentationProfileMutationResult {
  return {
    profile: { ...emptyProfile, backendKind: 'vrm', avatarAssetRef: input.ref },
    previousProfile: input.previous ?? null,
    committedRevision: input.revision,
  };
}

describe('Agent Center appearance auto-save adapter', () => {
  it('atomically patches the avatar asset while preserving the committed profile fields', async () => {
    const currentProfile = {
      ...emptyProfile,
      defaultVoiceReference: 'preset_voice_id:serena',
      avatarAutoplay: true,
      backgroundAssetRef: 'background:current',
    } as const;
    const patchPresentationProfile = vi.fn(async (
      _identity: RuntimeLocalAgentIdentityInput,
      profile: AgentCenterRuntimePresentationProfilePatch | null,
      expectedRevision: string,
      importedAssets = [],
    ) => {
      expect(expectedRevision).toBe('0');
      expect(profile).toEqual({ backendKind: 'vrm' });
      expect(importedAssets).toEqual([{ role: 'avatar', fileName: 'avatar.vrm', mediaType: 'model/gltf-binary', content: material.content, sha256: material.sha256 }]);
      return {
        profile: { ...currentProfile, backendKind: 'vrm' as const, avatarAssetRef: 'vrm_runtime_official' },
        previousProfile: currentProfile,
        committedRevision: '1',
      };
    });
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account',
      snapshot: { inspect: {
        presentationProfile: currentProfile,
        presentationProfileRevision: '0',
      } as never },
      runtimePresentation: {
        async setPresentationProfile() { throw new Error('full presentation replacement must not run'); },
        patchPresentationProfile,
      },
      shell: { async pickAvatarAssetMaterial() { return material; } },
      avatarPreview: {
        async resolvePreview(input) {
          expect(input.avatarAssetRef).toBe('vrm_runtime_official');
          expect(input.previewMaterialRef).toBe('custody:new');
          return {
            state: 'ready', tier: 'avatar_preview_service', backendKind: 'vrm',
            avatarAssetRef: input.avatarAssetRef, previewMaterialRef: input.previewMaterialRef,
            previewImageRef: '/committed/avatar.png', visiblePixels: 42, nonPlaceholder: true, warnings: [],
          };
        },
      },
    });
    const projection = await adapter.replaceAvatar?.('vrm');
    expect(projection).toMatchObject({
      status: 'ready', presentationRevision: '1', avatarAssetRef: 'vrm_runtime_official',
      renderState: 'ready', renderImageRef: '/committed/avatar.png',
      defaultVoiceReference: 'preset_voice_id:serena', avatarAutoplay: true,
      backgroundRef: 'background:current',
    });
    expect(patchPresentationProfile).toHaveBeenCalledTimes(1);
  });

  it('leaves the committed appearance unchanged when Runtime validation fails', async () => {
    const failure = Object.assign(new Error('VRM structure is invalid'), {
      reasonCode: 'AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID', category: 'structure',
    });
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account',
      snapshot: { inspect: {
        presentationProfile: { ...emptyProfile, backendKind: 'vrm', avatarAssetRef: 'vrm_current' },
        presentationProfileRevision: '7',
      } as never },
      runtimePresentation: {
        async setPresentationProfile() { throw new Error('must not replace the presentation'); },
        async patchPresentationProfile() { throw failure; },
      },
      shell: { async pickAvatarAssetMaterial() { return material; } },
    });
    await expect(adapter.replaceAvatar?.('vrm')).rejects.toBe(failure);
    expect(await adapter.load()).toMatchObject({ avatarAssetRef: 'vrm_current', presentationRevision: '7' });
  });

  it('patches only avatar autoplay and preserves the committed default voice reference', async () => {
    const profile = {
      ...emptyProfile,
      defaultVoiceReference: 'voice_asset_id:voice-song-lian',
      avatarAutoplay: false,
    };
    const patchPresentationProfile = vi.fn(async (
      receivedIdentity: RuntimeLocalAgentIdentityInput,
      patch: AgentCenterRuntimePresentationProfilePatch,
      expectedRevision: string,
    ): Promise<AgentCenterRuntimePresentationProfileMutationResult> => {
      expect(receivedIdentity).toEqual(identity);
      expect(patch).toEqual({ avatarAutoplay: true });
      expect(expectedRevision).toBe('5');
      return {
        profile: { ...profile, avatarAutoplay: true },
        previousProfile: profile,
        committedRevision: '6',
      };
    });
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account',
      snapshot: { inspect: {
        presentationProfile: profile,
        presentationProfileRevision: '5',
      } as never },
      runtimePresentation: {
        async setPresentationProfile() { throw new Error('must not replace the presentation'); },
        patchPresentationProfile,
      },
    });
    await expect(adapter.setAvatarAutoplay?.(true)).resolves.toMatchObject({
      presentationRevision: '6',
      defaultVoiceReference: 'voice_asset_id:voice-song-lian',
      avatarAutoplay: true,
    });
    expect(patchPresentationProfile).toHaveBeenCalledTimes(1);
  });

  it('projects post-save render failure separately and restores previous as a new commit', async () => {
    const previous = {
      ...emptyProfile,
      backendKind: 'vrm' as const,
      avatarAssetRef: 'vrm_previous',
      defaultVoiceReference: 'preset_voice_id:serena',
      avatarAutoplay: true,
    };
    const adapter = createAgentCenterShellAppearanceAdapter({
      identity,
      accountId: 'account',
      snapshot: { inspect: {
        presentationProfile: previous, presentationProfileRevision: '1',
      } as never },
      runtimePresentation: {
        async setPresentationProfile(_identity, profile, expectedRevision) {
          expect(expectedRevision).toBe('2');
          expect(profile).toEqual({
            backendKind: 'vrm',
            avatarAssetRef: 'vrm_previous',
            defaultVoiceReference: 'preset_voice_id:serena',
            avatarAutoplay: true,
          });
          return {
            profile: previous,
            previousProfile: { ...emptyProfile, backendKind: 'vrm', avatarAssetRef: 'vrm_new' },
            committedRevision: '3',
          };
        },
        async patchPresentationProfile(_identity, profile, expectedRevision) {
          expect(expectedRevision).toBe('1');
          expect(profile).toEqual({ backendKind: 'vrm' });
          return committed({ ref: 'vrm_new', revision: '2', previous });
        },
      },
      shell: { async pickAvatarAssetMaterial() { return material; } },
      avatarPreview: {
        async resolvePreview(input) {
          return {
            state: 'failed', tier: 'avatar_preview_service', backendKind: input.backendKind,
            avatarAssetRef: input.avatarAssetRef, previewMaterialRef: input.previewMaterialRef,
            previewImageRef: null, visiblePixels: null, nonPlaceholder: false,
            reasonCode: 'avatar-render-failed', reason: 'renderer failed', warnings: [],
          };
        },
      },
    });
    expect(await adapter.replaceAvatar?.('vrm')).toMatchObject({
      avatarAssetRef: 'vrm_new', presentationRevision: '2', renderState: 'failed',
      previousSelection: { avatarAssetReference: 'vrm_previous' },
    });
    expect(await adapter.restorePreviousAppearance?.()).toMatchObject({
      avatarAssetRef: 'vrm_previous', presentationRevision: '3',
      defaultVoiceReference: 'preset_voice_id:serena', avatarAutoplay: true,
    });
  });
});
