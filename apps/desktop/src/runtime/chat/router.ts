/**
 * Desktop routing policy:
 * - CLOUD => backend core-turn-service.
 * - PRIVATE => desktop local execution-kernel.
 */
import {
  DesktopChatRouteResultDto,
  isDesktopChatRouteChannel,
  normalizeDesktopChatRouteChannel,
} from './route-types';
import { createChatRouteFlowId, emitChatRouteLog } from './logging';

type RouteLike = Pick<DesktopChatRouteResultDto, 'channel' | 'providerSelectable'>;
export type DesktopExpectedChannel = 'CLOUD' | 'PRIVATE';

export function resolveExpectedChannel(
  routeResult: RouteLike | null | undefined,
): DesktopExpectedChannel {
  const flowId = createChatRouteFlowId('chat-route-resolve-expected-channel');
  if (!routeResult) {
    emitChatRouteLog({
      level: 'error',
      message: 'action:resolve-expected-channel:failed',
      flowId,
      source: 'resolveExpectedChannel',
      details: {
        reason: 'route-result-missing',
      },
    });
    throw new Error('无效的 routeResult');
  }

  const normalizedChannel = normalizeDesktopChatRouteChannel(routeResult.channel);
  if (!isDesktopChatRouteChannel(routeResult.channel)) {
    emitChatRouteLog({
      level: 'warn',
      message: 'action:resolve-expected-channel:fallback-cloud',
      flowId,
      source: 'resolveExpectedChannel',
      details: {
        unknownChannel: String(routeResult.channel || ''),
        normalizedChannel,
      },
    });
  }

  if (normalizedChannel === DesktopChatRouteResultDto.channel.PRIVATE) {
    emitChatRouteLog({
      level: 'debug',
      message: 'action:resolve-expected-channel:done',
      flowId,
      source: 'resolveExpectedChannel',
      details: {
        channel: normalizedChannel,
      },
    });
    return 'PRIVATE';
  }

  emitChatRouteLog({
    level: 'debug',
    message: 'action:resolve-expected-channel:done',
    flowId,
    source: 'resolveExpectedChannel',
    details: {
      channel: normalizedChannel,
    },
  });
  return 'CLOUD';
}

export function canSelectProvider(routeResult: RouteLike | null | undefined) {
  if (!routeResult) {
    emitChatRouteLog({
      level: 'debug',
      message: 'action:can-select-provider:done',
      source: 'canSelectProvider',
      details: {
        hasRouteResult: false,
        canSelectProvider: false,
      },
    });
    return false;
  }
  const normalizedChannel = normalizeDesktopChatRouteChannel(routeResult.channel);
  const canSelect =
    normalizedChannel === DesktopChatRouteResultDto.channel.PRIVATE ||
    Boolean(routeResult.providerSelectable);
  if (!isDesktopChatRouteChannel(routeResult.channel)) {
    emitChatRouteLog({
      level: 'warn',
      message: 'action:can-select-provider:invalid-channel',
      source: 'canSelectProvider',
      details: {
        unknownChannel: String(routeResult.channel || ''),
        normalizedChannel,
        canSelectProvider: canSelect,
      },
    });
  }
  return canSelect;
}
