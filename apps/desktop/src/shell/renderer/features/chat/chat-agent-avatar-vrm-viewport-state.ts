import type {
  AvatarAttentionState,
  AvatarVrmExpressionWeights,
  AvatarVrmViewportRenderInput,
  AvatarVrmViewportState,
} from '@nimiplatform/nimi-kit/features/avatar/vrm';
import {
  resolveAvatarVrmExpressionWeights,
  resolveAvatarVrmViewportState,
} from '@nimiplatform/nimi-kit/features/avatar/vrm';
import { convertTauriFileSrc, hasTauriRuntime } from '@runtime/tauri-api';
import type { ChatAgentAvatarAttentionState } from './chat-agent-avatar-attention-state';

export type ChatAgentAvatarVrmViewportState = AvatarVrmViewportState;

export type ChatAgentAvatarVrmExpressionWeights = AvatarVrmExpressionWeights;

export type DesktopAgentAvatarAssetRef = {
  resourceId: string;
  filename: string | null;
};

export function parseDesktopAgentAvatarAssetRef(assetRef: string): DesktopAgentAvatarAssetRef | null {
  const normalized = assetRef.trim();
  if (!normalized.startsWith('desktop-avatar://')) {
    return null;
  }
  const remainder = normalized.slice('desktop-avatar://'.length);
  if (!remainder) {
    return null;
  }
  const slashIndex = remainder.indexOf('/');
  const resourceId = (slashIndex >= 0 ? remainder.slice(0, slashIndex) : remainder).trim();
  const encodedFilename = slashIndex >= 0 ? remainder.slice(slashIndex + 1).trim() : '';
  if (!resourceId) {
    return null;
  }
  return {
    resourceId,
    filename: encodedFilename ? decodeURIComponent(encodedFilename) : null,
  };
}

export function resolveChatAgentAvatarVrmAssetUrl(assetRef: string): string | null {
  const normalized = assetRef.trim();
  if (!normalized || normalized.startsWith('fallback://') || normalized.startsWith('desktop-avatar://')) {
    return null;
  }
  if (normalized.toLowerCase().startsWith('file://') && hasTauriRuntime()) {
    try {
      const parsed = new URL(normalized);
      const pathname = decodeURIComponent(parsed.pathname || '');
      if (!pathname) {
        return normalized;
      }
      const resolvedPath = parsed.hostname
        ? `//${parsed.hostname}${pathname}`
        : pathname;
      return convertTauriFileSrc(resolvedPath);
    } catch {
      return normalized;
    }
  }
  return normalized;
}

export function resolveChatAgentAvatarVrmViewportState(
  input: AvatarVrmViewportRenderInput,
  attentionState?: ChatAgentAvatarAttentionState | null,
): ChatAgentAvatarVrmViewportState {
  return resolveAvatarVrmViewportState(
    input,
    attentionState as AvatarAttentionState | null | undefined,
  );
}

export function resolveChatAgentAvatarVrmExpressionWeights(
  input: AvatarVrmViewportRenderInput,
): ChatAgentAvatarVrmExpressionWeights {
  return resolveAvatarVrmExpressionWeights(input);
}
