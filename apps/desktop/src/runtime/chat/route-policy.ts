import {
  DesktopChatRouteRequestDto,
  DesktopChatRouteResultDto,
  normalizeDesktopChatRouteTargetType,
} from './route-types';
import { createChatRouteFlowId, emitChatRouteLog } from './logging';

/**
 * Deterministic fallback policy when desktop control-plane route API is unavailable:
 * - AGENT => LOCAL local execution
 * - CONTACT/FRIEND => CLOUD
 */
export function resolveChatRouteByPolicy(
  input: DesktopChatRouteRequestDto,
): DesktopChatRouteResultDto {
  const flowId = createChatRouteFlowId('chat-route-policy');
  const startedAt = performance.now();
  const targetType = normalizeDesktopChatRouteTargetType(input.targetType);
  emitChatRouteLog({
    level: 'debug',
    message: 'action:resolve-chat-route-by-policy:start',
    flowId,
    source: 'resolveChatRouteByPolicy',
    details: {
      targetType,
      hasAgentId: Boolean(String(input.agentId || '').trim()),
      hasTargetAccountId: Boolean(String(input.targetAccountId || '').trim()),
    },
  });
  if (targetType === DesktopChatRouteRequestDto.targetType.AGENT) {
    const result = {
      channel: DesktopChatRouteResultDto.channel.LOCAL,
      providerSelectable: true,
      reason: 'Agent chats are routed to local execution by fallback policy.',
      sessionClass: DesktopChatRouteResultDto.sessionClass.AGENT_LOCAL,
    };
    emitChatRouteLog({
      level: 'info',
      message: 'action:resolve-chat-route-by-policy:done',
      flowId,
      source: 'resolveChatRouteByPolicy',
      costMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        targetType,
        channel: result.channel,
        sessionClass: result.sessionClass,
      },
    });
    return result;
  }

  const result = {
    channel: DesktopChatRouteResultDto.channel.CLOUD,
    providerSelectable: false,
    reason: 'Human direct chats are routed through cloud channel by fallback policy.',
    sessionClass: DesktopChatRouteResultDto.sessionClass.HUMAN_DIRECT,
  };
  emitChatRouteLog({
    level: 'info',
    message: 'action:resolve-chat-route-by-policy:done',
    flowId,
    source: 'resolveChatRouteByPolicy',
    costMs: Number((performance.now() - startedAt).toFixed(2)),
    details: {
      targetType,
      channel: result.channel,
      sessionClass: result.sessionClass,
    },
  });
  return result;
}
