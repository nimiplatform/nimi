import { createNimiRuntimeAgentConsumeClient } from '@nimiplatform/sdk/runtime';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { normalizeText } from './chat-agent-shell-core';

export type DesktopAvatarPresentationBinding = {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
};

export async function resolveDesktopAvatarPresentationBinding(input: {
  readonly agentHandle: string;
  readonly sdk: DesktopRendererSdkPort;
}): Promise<DesktopAvatarPresentationBinding> {
  const agentHandle = normalizeText(input.agentHandle);
  if (!agentHandle) throw new Error('desktop avatar presentation requires a canonical Agent handle');
  const response = await input.sdk.accountProduct().agents.getLocalAppAgentPresentationSnapshot({ agentHandle });
  const binding = response.privateBinding;
  const ownerUserId = normalizeText(binding?.ownerUserId);
  const runtimeSourceRef = normalizeText(binding?.runtimeSourceRef);
  const localAgentRef = normalizeText(binding?.localAgentRef);
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef) {
    throw new Error('Runtime did not return the protected Avatar presentation binding.');
  }
  return Object.freeze({ ownerUserId, runtimeSourceRef, localAgentRef });
}

export async function registerDesktopAvatarLiveInstanceBinding(input: {
  target: AgentLocalTargetSnapshot;
  avatarInstanceId: string;
  conversationAnchorId: string;
  subjectUserId: string;
  sdk: DesktopRendererSdkPort;
}): Promise<DesktopAvatarPresentationBinding> {
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
  const binding = await resolveDesktopAvatarPresentationBinding({
    agentHandle: normalizeText(input.target.agentHandle),
    sdk: input.sdk,
  });
  await runtimeAgent.anchors.registerAvatarLiveInstance({
    ownerUserId: binding.ownerUserId,
    runtimeSourceRef: binding.runtimeSourceRef,
    localAgentRef: binding.localAgentRef,
    avatarInstanceId,
    conversationAnchorId,
    subjectUserId,
  });
  return binding;
}
