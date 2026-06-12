import type {
  AvatarAttentionState,
  AvatarVrmExpressionWeights,
  AvatarVrmViewportRenderInput,
  AvatarVrmViewportState,
} from '@nimiplatform/kit/features/avatar/vrm';
import {
  resolveAvatarVrmExpressionWeights,
  resolveAvatarVrmViewportState,
} from '@nimiplatform/kit/features/avatar/vrm';
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
  void normalized;
  return null;
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
