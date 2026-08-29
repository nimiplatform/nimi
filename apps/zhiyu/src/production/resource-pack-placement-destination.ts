import type { NimiLocalAppAgentHandle, NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { getZhiyuLocalAppClient } from '../shell/auth/runtime-platform.js';

export type ZhiyuResourcePackPlacementTarget = Readonly<{
  agentHandle: NimiLocalAppAgentHandle;
  conversationAnchorId: string;
}>;

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-041a
export async function resolveZhiyuResourcePackPlacementTarget(input: {
  readonly agentHandle: string;
  readonly isCurrent?: () => boolean;
  readonly client?: Pick<NimiLocalAppClient, 'agents' | 'auth' | 'conversation'>;
}): Promise<ZhiyuResourcePackPlacementTarget> {
  const client = input.client ?? getZhiyuLocalAppClient();
  const session = await client.auth.status();
  if (!session.sessionBound) {
    throw Object.assign(new Error('Zhiyu protected App session is unavailable for Resource Pack placement.'), {
      code: 'ZHIYU_RESOURCE_PACK_PLACEMENT_SESSION_UNAVAILABLE',
      reasonCode: session.reasonCode,
      actionHint: session.actionHint,
    });
  }
  const references = await client.agents.listReferences();
  if (input.isCurrent && !input.isCurrent()) {
    throw Object.assign(new Error('Zhiyu Resource Pack placement is stale.'), {
      code: 'ZHIYU_RESOURCE_PACK_PLACEMENT_AGENT_UNAVAILABLE',
    });
  }
  const reference = references.find((candidate) => candidate.agentHandle === input.agentHandle);
  if (!reference) {
    throw Object.assign(new Error('No current Zhiyu Agent owns the requested Conversation.'), {
      code: 'ZHIYU_RESOURCE_PACK_PLACEMENT_AGENT_UNAVAILABLE',
      reasonCode: 'zhiyu-resource-pack-placement-agent-not-current',
      actionHint: 'retry_zhiyu_resource_pack_placement',
    });
  }
  const opened = await client.conversation.open({ agentHandle: reference.agentHandle });
  if (input.isCurrent && !input.isCurrent()) {
    throw Object.assign(new Error('Zhiyu Resource Pack placement changed while opening Conversation.'), {
      code: 'ZHIYU_RESOURCE_PACK_PLACEMENT_AGENT_UNAVAILABLE',
    });
  }
  return Object.freeze({
    agentHandle: reference.agentHandle,
    conversationAnchorId: opened.conversationAnchorId,
  });
}
