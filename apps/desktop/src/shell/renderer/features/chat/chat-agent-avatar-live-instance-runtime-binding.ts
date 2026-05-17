import { getPlatformClient } from '@nimiplatform/sdk';
import { createRuntimeProtectedScopeHelper } from '@nimiplatform/sdk/runtime';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import { normalizeText } from './chat-agent-shell-core';

let runtimeProtectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

function requireRuntimeSubjectUserId(): string {
  const subjectUserId = normalizeText((useAppStore.getState().auth.user as Record<string, unknown> | null)?.id);
  if (!subjectUserId) {
    throw new Error('desktop avatar launch requires authenticated subject user id for runtime.agent');
  }
  return subjectUserId;
}

function getRuntimeProtectedAccess() {
  if (runtimeProtectedAccess) {
    return runtimeProtectedAccess;
  }
  const runtime = getPlatformClient().runtime;
  runtimeProtectedAccess = createRuntimeProtectedScopeHelper({
    runtime,
    getSubjectUserId: async () => requireRuntimeSubjectUserId(),
  });
  return runtimeProtectedAccess;
}

export async function registerDesktopAvatarLiveInstanceBinding(input: {
  target: AgentLocalTargetSnapshot;
  avatarInstanceId: string;
  conversationAnchorId: string;
  subjectUserId?: string | null;
}): Promise<void> {
  const avatarInstanceId = normalizeText(input.avatarInstanceId);
  const conversationAnchorId = normalizeText(input.conversationAnchorId);
  if (!avatarInstanceId || !conversationAnchorId) {
    throw new Error('desktop avatar launch requires avatarInstanceId and conversationAnchorId');
  }
  const runtime = getPlatformClient().runtime;
  const protectedAccess = getRuntimeProtectedAccess();
  await protectedAccess.withScopes(['runtime.agent.write'], (options) => runtime.agent.anchors.registerAvatarLiveInstance({
    ownerUserId: input.target.ownerUserId,
    realmAgentId: input.target.realmAgentId,
    localAgentRef: input.target.localAgentRef,
    avatarInstanceId,
    conversationAnchorId,
    subjectUserId: normalizeText(input.subjectUserId) || input.target.ownerUserId,
  }, options));
}
