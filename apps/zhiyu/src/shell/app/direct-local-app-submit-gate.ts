import type { ZhiyuCanonicalRendererBindings } from '../../renderer/contract';
import type { ZhiyuEvidence } from './evidence';

export function isZhiyuDirectLocalAppSubmitEnabled(input: {
  readonly evidence: Pick<ZhiyuEvidence, 'conversation' | 'turn' | 'chat' | 'composer'>;
  readonly draft: string;
}): boolean {
  const { evidence } = input;
  const recoverableFailedTurn = evidence.chat.state === 'failed'
    && evidence.chat.source === 'runtime'
    && evidence.turn.source === 'runtime'
    && Boolean(evidence.turn.requestId)
    && evidence.chat.requestId === evidence.turn.requestId
    && Boolean(evidence.turn.messageId);
  const recoverableCanceledTurn = evidence.chat.state === 'canceled'
    && evidence.chat.reasonCode === 'runtime-agent-chat-user-canceled'
    && evidence.turn.reasonCode === 'runtime-agent-chat-user-canceled'
    && Boolean(evidence.chat.requestId)
    && evidence.chat.requestId === evidence.turn.requestId;
  return evidence.conversation.ready
    && (evidence.turn.ready || recoverableFailedTurn || recoverableCanceledTurn)
    && evidence.chat.state !== 'streaming'
    && evidence.composer.submitState !== 'submitting'
    && input.draft.trim().length > 0;
}

export async function refreshZhiyuDirectLocalAppSubmitGate(input: {
  readonly conversation: ZhiyuEvidence['conversation'];
  readonly loadAgentInventory: ZhiyuCanonicalRendererBindings['app']['projection']['loadAgentInventory'];
  readonly projectTurnReadiness: ZhiyuCanonicalRendererBindings['app']['projection']['projectTurnReadiness'];
}): Promise<{
  readonly inventory: ZhiyuEvidence['inventory'];
  readonly turn: ZhiyuEvidence['turn'];
}> {
  const inventory = await input.loadAgentInventory();
  return {
    inventory,
    turn: input.projectTurnReadiness(input.conversation, inventory),
  };
}
