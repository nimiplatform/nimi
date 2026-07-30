import type {
  AgentCenterAvatarPreviewAdapter,
  AgentCenterAvatarPreviewAdapterResult,
  AgentCenterAvatarPreviewResolveInput,
} from '@nimiplatform/kit/features/agent-center/headless';
import { resolveAgentCenterAvatarPreviewServiceResult } from '@nimiplatform/kit/features/avatar/headless';
import type { DesktopRendererAvatarHandoffPort } from '../../renderer/avatar-handoff-port.js';

export function createDesktopAgentCenterAvatarPreviewAdapter(input: {
  readonly avatarHandoff: DesktopRendererAvatarHandoffPort;
}): AgentCenterAvatarPreviewAdapter {
  let currentPreviewImageRef: string | null = null;
  const releaseCurrentPreview = (): void => {
    if (currentPreviewImageRef?.startsWith('blob:')) {
      URL.revokeObjectURL(currentPreviewImageRef);
    }
    currentPreviewImageRef = null;
  };

  return Object.freeze({
    async resolvePreview(
      previewInput: AgentCenterAvatarPreviewResolveInput,
    ): Promise<AgentCenterAvatarPreviewAdapterResult> {
      const base = {
        tier: 'avatar_preview_service' as const,
        avatarAssetRef: previewInput.avatarAssetRef,
        backendKind: previewInput.backendKind,
        previewMaterialRef: previewInput.previewMaterialRef,
        previewImageRef: null,
        visiblePixels: null,
        nonPlaceholder: false as const,
        warnings: [] as readonly string[],
      };
      if (!input.avatarHandoff.available()) {
        releaseCurrentPreview();
        return unavailable(base, 'Desktop Avatar handoff is unavailable, so no renderer preview projection can be requested.');
      }
      if (typeof input.avatarHandoff.preview !== 'function') {
        releaseCurrentPreview();
        return unavailable(base, 'Desktop Avatar handoff does not expose the Avatar preview projection carrier.');
      }
      const localAgentRef = typeof previewInput.identity.localAgentRef === 'string'
        ? previewInput.identity.localAgentRef.trim()
        : '';
      if (!localAgentRef) {
        releaseCurrentPreview();
        return unavailable(base, 'Desktop Avatar preview requires a Runtime Local Agent reference.');
      }
      try {
        const carrierResult = await input.avatarHandoff.preview({
          agentId: localAgentRef,
          avatarAssetRef: previewInput.avatarAssetRef,
          backendKind: previewInput.backendKind,
          previewMaterialRef: previewInput.previewMaterialRef,
          backendCapabilityProfileRef: previewInput.backendCapabilityProfileRef,
        });
        const resolved = resolveAgentCenterAvatarPreviewServiceResult({
          previewState: carrierResult.state,
          previewTier: carrierResult.tier,
          backendKind: carrierResult.backendKind,
          avatarAssetRef: carrierResult.avatarAssetRef,
          previewMaterialRef: carrierResult.previewMaterialRef,
          previewImageRef: carrierResult.previewImageRef,
          previewVisiblePixels: carrierResult.visiblePixels,
          previewFailureReason: carrierResult.state === 'ready' ? null : carrierResult.reason,
          previewWarnings: carrierResult.warnings,
        });
        if (carrierResult.state === 'ready' && resolved.state === 'ready') {
          releaseCurrentPreview();
          currentPreviewImageRef = carrierResult.previewImageRef;
          return {
            ...resolved,
            backendKind: previewInput.backendKind,
            previewMaterialRef: carrierResult.previewMaterialRef,
          };
        }
        releaseCurrentPreview();
        if (carrierResult.state === 'ready') {
          return {
            ...base,
            state: 'failed',
            reason: 'Avatar preview carrier returned a surface ref that is not controlled by the current Desktop origin.',
            warnings: carrierResult.warnings ?? [],
          };
        }
        return {
          ...base,
          state: carrierResult.state,
          avatarAssetRef: carrierResult.avatarAssetRef ?? previewInput.avatarAssetRef,
          backendKind: carrierResult.backendKind ?? previewInput.backendKind,
          previewMaterialRef: carrierResult.previewMaterialRef ?? previewInput.previewMaterialRef,
          reason: carrierResult.reason,
          warnings: carrierResult.warnings ?? [],
        };
      } catch (error) {
        releaseCurrentPreview();
        return {
          ...base,
          state: 'failed',
          reason: error instanceof Error && error.message.trim()
            ? `Desktop Avatar preview projection failed: ${error.message}`
            : 'Desktop Avatar preview projection failed with an internal error.',
        };
      }
    },
  });
}

function unavailable(
  base: {
    readonly tier: 'avatar_preview_service';
    readonly avatarAssetRef: string;
    readonly backendKind: 'live2d' | 'vrm';
    readonly previewMaterialRef: string;
    readonly previewImageRef: null;
    readonly visiblePixels: null;
    readonly nonPlaceholder: false;
    readonly warnings: readonly string[];
  },
  reason: string,
): AgentCenterAvatarPreviewAdapterResult {
  return {
    ...base,
    state: 'unavailable',
    reason,
  };
}
