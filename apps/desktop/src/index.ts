import { DesktopApiClient } from '@runtime/client/desktop-api-client';
import { assertConfig, getRuntimeConfig } from '@runtime/config';
import { resolveExpectedChannel } from '@runtime/chat';
import { DesktopChatRouteRequestDto } from '@runtime/chat';
import { emitRuntimeLog } from '@runtime/telemetry/logger';

function createMainFlowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function logMainPhase(options: {
  level?: 'debug' | 'info' | 'warn' | 'error';
  flowId: string;
  message: string;
  details?: Record<string, unknown>;
}) {
  const { level = 'info', flowId, message, details } = options;
  emitRuntimeLog({
    level,
    area: 'desktop-main',
    message,
    flowId,
    details,
  });
}

async function main() {
  const flowId = createMainFlowId('desktop-main');
  const startedAt = Date.now();
  logMainPhase({
    flowId,
    message: 'phase:main:start',
  });
  const config = getRuntimeConfig();
  logMainPhase({
    flowId,
    message: 'phase:config:load:done',
    details: {
      targetType: config.targetType,
      hasAccessToken: Boolean(config.accessToken),
      hasAgentId: Boolean(config.agentId),
      hasTargetAccountId: Boolean(config.targetAccountId),
    },
  });
  assertConfig(config);
  logMainPhase({
    flowId,
    message: 'phase:config:assert:done',
  });

  const client = new DesktopApiClient(config);

  const routeInput: DesktopChatRouteRequestDto = (() => {
    if (config.targetType === DesktopChatRouteRequestDto.targetType.AGENT) {
      return {
        targetType: DesktopChatRouteRequestDto.targetType.AGENT,
        agentId: config.agentId,
      };
    }
    if (config.targetType === DesktopChatRouteRequestDto.targetType.FRIEND) {
      return {
        targetType: DesktopChatRouteRequestDto.targetType.FRIEND,
        targetAccountId: config.targetAccountId,
      };
    }
    return {
      targetType: DesktopChatRouteRequestDto.targetType.CONTACT,
      targetAccountId: config.targetAccountId,
    };
  })();
  logMainPhase({
    flowId,
    message: 'phase:route:input-ready',
    details: {
      targetType: routeInput.targetType,
      hasAgentId: Boolean(routeInput.agentId),
      hasTargetAccountId: Boolean(routeInput.targetAccountId),
    },
  });

  const route = await client.resolveChatRoute(routeInput);

  const channel = resolveExpectedChannel(route);
  logMainPhase({
    flowId,
    message: 'phase:route:resolved',
    details: {
      channel,
      sessionClass: route.sessionClass,
      reason: route.reason,
    },
  });
  logMainPhase({
    flowId,
    message: 'phase:main:done',
    details: {
      channel,
      costMs: Date.now() - startedAt,
    },
  });
}

main().catch((error) => {
  emitRuntimeLog({
    level: 'error',
    area: 'desktop-main',
    message: 'phase:main:failed',
    details: {
      error: error instanceof Error ? error.message : String(error || ''),
    },
  });
  process.exitCode = 1;
});
