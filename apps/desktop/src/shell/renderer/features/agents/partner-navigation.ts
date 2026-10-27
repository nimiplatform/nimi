import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types.js';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import { isSameCharacter, projectPartnerRecord } from './partner-directory-model.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r006
export async function openPartnerConversation(input: {
  sdk: DesktopRendererSdkPort; accountId: string; localAgentRef: string;
  expectedSource?: CharacterSourceRefV3; isCurrent(): boolean;
}): Promise<AgentLocalTargetSnapshot | null> {
  const read = await input.sdk.withRuntimeProtectedScopes(['runtime.agent.read'], options => input.sdk.accountProduct().agents.getAgent({ agentId: input.localAgentRef }, options));
  if (!input.isCurrent()) return null;
  if (!read.agent || read.agent.localAgentRef !== input.localAgentRef) throw new Error('Partner not found.');
  const partner = projectPartnerRecord(read.agent, input.accountId);
  if (!partner || partner.lifecycle !== AgentLifecycleStatus.ACTIVE || (input.expectedSource && !isSameCharacter(partner.sourceRef, input.expectedSource))) throw new Error('Partner is unavailable.');
  const { reference } = await input.sdk.resolveDesktopAgentReference({ localAgentRef: partner.localAgentRef });
  if (!reference || !input.isCurrent()) return null;
  const opened = await input.sdk.conversation().open({ agentHandle: reference.agentHandle as NimiLocalAppAgentHandle });
  if (!input.isCurrent()) return null;
  return { agentHandle: reference.agentHandle, conversationAnchorId: opened.conversationAnchorId,
    displayName: reference.displayName, avatarUrl: reference.avatarUrl ?? null, handle: '', worldId: null, worldName: null,
    bio: null, ownershipType: null, greeting: null, builtinDocsContext: null };
}
