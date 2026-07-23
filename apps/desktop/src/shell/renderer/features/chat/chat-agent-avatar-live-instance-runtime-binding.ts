import { createNimiRuntimeAgentConsumeClient } from '@nimiplatform/sdk/runtime';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { normalizeText } from './chat-agent-shell-core';

export async function registerDesktopAvatarLiveInstanceBinding(input: {
  target: AgentLocalTargetSnapshot;
  avatarInstanceId: string;
  conversationAnchorId: string;
  subjectUserId: string;
  sdk: DesktopRendererSdkPort;
}): Promise<void> {
  const avatarInstanceId = normalizeText(input.avatarInstanceId);
  const conversationAnchorId = normalizeText(input.conversationAnchorId);
  if (!avatarInstanceId || !conversationAnchorId) {
    throw new Error('desktop avatar launch requires avatarInstanceId and conversationAnchorId');
  }
  const runtimeAgent = createNimiRuntimeAgentConsumeClient({
    runtime: { agents: input.sdk.accountProduct().agents },
    runtimeAppId: input.sdk.appId(),
  });
  const subjectUserId = normalizeText(input.subjectUserId);
  if (!subjectUserId) {
    throw new Error('desktop avatar launch requires authenticated subject user id for runtime.agent');
  }
  await runtimeAgent.anchors.registerAvatarLiveInstance({
    ownerUserId: input.target.ownerUserId,
    runtimeSourceRef: input.target.runtimeSourceRef,
    localAgentRef: input.target.localAgentRef,
    avatarInstanceId,
    conversationAnchorId,
    subjectUserId,
  });
}
