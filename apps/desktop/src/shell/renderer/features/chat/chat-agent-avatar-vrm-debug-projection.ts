import type { ChatAgentAvatarVrmDiagnostic } from './chat-agent-avatar-vrm-diagnostics';
import type { ChatAgentAvatarVrmRuntimeLifecycleState } from './chat-agent-avatar-vrm-runtime';
import type { ChatAgentAvatarVrmViewportState } from './chat-agent-avatar-vrm-viewport-state';

export function buildChatAgentAvatarVrmDebugLines(input: {
  chrome: 'default' | 'minimal';
  diagnostic: ChatAgentAvatarVrmDiagnostic;
  resolvedStatus: string;
  state: ChatAgentAvatarVrmViewportState;
}): string[] {
  const { chrome, diagnostic, resolvedStatus, state } = input;
  if (chrome !== 'minimal' || resolvedStatus === 'ready') {
    return [];
  }

  return [
    `status: ${diagnostic.status}`,
    `stage: ${diagnostic.stage}`,
    `phase: ${state.phase}`,
    `posture: ${state.posture}`,
    `speakingEnergy: ${state.speakingEnergy.toFixed(2)}`,
    `source: ${diagnostic.source}`,
    `assetRef: ${diagnostic.assetRef || 'none'}`,
    diagnostic.assetLabel ? `assetLabel: ${diagnostic.assetLabel}` : null,
    diagnostic.resourceId ? `resourceId: ${diagnostic.resourceId}` : null,
    `assetUrl: ${diagnostic.assetUrl || 'none'}`,
    diagnostic.networkAssetUrl ? `networkAssetUrl: ${diagnostic.networkAssetUrl}` : null,
    diagnostic.posterUrl ? `posterUrl: ${diagnostic.posterUrl}` : null,
    `resizePosture: ${diagnostic.resizePosture}`,
    `hostRenderable: ${diagnostic.hostRenderable ? 'true' : 'false'}`,
    `viewport: ${diagnostic.viewportWidth}x${diagnostic.viewportHeight}`,
    `canvasEpoch: ${diagnostic.canvasEpoch}`,
    diagnostic.recoveryReason ? `recoveryReason: ${diagnostic.recoveryReason}` : null,
    diagnostic.recoveryAttemptCount > 0 ? `recoveryAttemptCount: ${diagnostic.recoveryAttemptCount}` : null,
    diagnostic.error ? `error: ${diagnostic.error}` : null,
  ].filter((line): line is string => Boolean(line));
}

export function shouldShowChatAgentAvatarVrmPosterFallback(input: {
  chrome: 'default' | 'minimal';
  posterUrl?: string | null;
  runtimeReason: ChatAgentAvatarVrmRuntimeLifecycleState['reason'];
  status: string;
}): boolean {
  return input.chrome === 'minimal'
    && input.status !== 'ready'
    && input.runtimeReason !== 'webgl-context-lost'
    && input.runtimeReason !== 'webgl-context-restored'
    && Boolean(input.posterUrl);
}
