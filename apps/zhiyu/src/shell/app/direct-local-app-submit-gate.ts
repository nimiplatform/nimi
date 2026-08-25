import type { ZhiyuCanonicalRendererBindings } from '../../renderer/contract';
import type { ZhiyuEvidence } from './evidence';

export function isZhiyuDirectLocalAppSubmitEnabled(input: {
  readonly evidence: Pick<ZhiyuEvidence, 'conversation' | 'turn' | 'chat' | 'composer'>;
  readonly draft: string;
}): boolean {
  const { evidence } = input;
  const recoverableTerminalTurn = isZhiyuRecoverableTerminalTurn(evidence);
  return evidence.conversation.ready
    && (evidence.turn.ready || recoverableTerminalTurn)
    && evidence.chat.state !== 'streaming'
    && evidence.chat.actionHint !== 'reselect_local_partner'
    && evidence.composer.submitState !== 'submitting'
    && input.draft.trim().length > 0;
}

export function isZhiyuRecoverableTerminalTurn(
  evidence: Pick<ZhiyuEvidence, 'turn' | 'chat'>,
): boolean {
  const runtimeTerminal = (evidence.chat.state === 'failed' || evidence.chat.state === 'canceled')
    && evidence.chat.source === 'runtime'
    && evidence.turn.source === 'runtime'
    && Boolean(evidence.turn.runtimeTurnId);
  const callerCanceled = evidence.chat.state === 'canceled'
    && evidence.chat.reasonCode === 'runtime-agent-chat-user-canceled'
    && evidence.turn.reasonCode === 'runtime-agent-chat-user-canceled'
    && Boolean(evidence.chat.requestId)
    && evidence.chat.requestId === evidence.turn.requestId;
  return runtimeTerminal || callerCanceled;
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
