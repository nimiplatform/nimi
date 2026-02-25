import {
  type DesktopChatRouteRequestDto,
  isDesktopChatRouteTargetType,
  normalizeDesktopChatRouteTargetType,
} from '@runtime/chat';
import { emitRuntimeLog, type RuntimeLogMessage } from '@runtime/telemetry/logger';

export type RuntimeConfig = {
  apiBaseUrl: string;
  accessToken: string;
  targetType: DesktopChatRouteRequestDto.targetType;
  targetAccountId: string;
  agentId: string;
  requestId: string;
};

type RuntimeEnvMap = Record<string, string | undefined>;

function emitRuntimeConfigLog(options: {
  level?: 'debug' | 'info' | 'warn' | 'error';
  message: RuntimeLogMessage;
  flowId: string;
  source: string;
  costMs?: number;
  details?: Record<string, unknown>;
}) {
  const { level = 'info', message, flowId, source, costMs, details } = options;
  emitRuntimeLog({
    level,
    area: 'runtime-config',
    message,
    flowId,
    source,
    costMs,
    details,
  });
}

function getRuntimeEnvMap(): RuntimeEnvMap {
  const importMetaEnv = (import.meta as { env?: Record<string, string> }).env;
  const processEnv =
    typeof process !== 'undefined' ? ((process as { env?: Record<string, string> }).env ?? {}) : {};
  return {
    ...importMetaEnv,
    ...processEnv,
  };
}

function getRuntimeEnv(name: string): string | undefined {
  return getRuntimeEnvMap()[name];
}

export function getRuntimeConfig() {
  const flowId = `runtime-config-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  emitRuntimeConfigLog({
    level: 'debug',
    message: 'phase:config:load:start',
    flowId,
    source: 'getRuntimeConfig',
  });
  const targetType = normalizeDesktopChatRouteTargetType(
    String(getRuntimeEnv('NIMI_TARGET_TYPE') || 'AGENT').toUpperCase(),
  );

  const config = {
    apiBaseUrl: getRuntimeEnv('NIMI_API_BASE_URL') || 'http://localhost:3002',
    accessToken: getRuntimeEnv('NIMI_ACCESS_TOKEN') || '',
    targetType,
    targetAccountId: getRuntimeEnv('NIMI_TARGET_ACCOUNT_ID') || '',
    agentId: getRuntimeEnv('NIMI_AGENT_ID') || '',
    requestId: getRuntimeEnv('NIMI_REQUEST_ID') || `req_${Date.now()}`,
  } satisfies RuntimeConfig;
  emitRuntimeConfigLog({
    level: 'info',
    message: 'phase:config:load:done',
    flowId,
    source: 'getRuntimeConfig',
    costMs: Date.now() - startedAt,
    details: {
      targetType: config.targetType,
      hasAccessToken: Boolean(String(config.accessToken || '').trim()),
      hasAgentId: Boolean(String(config.agentId || '').trim()),
      hasTargetAccountId: Boolean(String(config.targetAccountId || '').trim()),
    },
  });
  return config;
}

export function assertConfig(config: RuntimeConfig) {
  const flowId = `runtime-config-assert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  emitRuntimeConfigLog({
    level: 'debug',
    message: 'phase:config:assert:start',
    flowId,
    source: 'assertConfig',
    details: {
      targetType: config.targetType,
    },
  });
  if (!config.accessToken) {
    emitRuntimeConfigLog({
      level: 'error',
      message: 'phase:config:assert:failed',
      flowId,
      source: 'assertConfig',
      costMs: Date.now() - startedAt,
      details: {
        reason: 'missing-access-token',
      },
    });
    throw new Error('缺少 NIMI_ACCESS_TOKEN');
  }

  const targetType = String(config.targetType || '').toUpperCase();
  if (!isDesktopChatRouteTargetType(targetType)) {
    emitRuntimeConfigLog({
      level: 'error',
      message: 'phase:config:assert:failed',
      flowId,
      source: 'assertConfig',
      costMs: Date.now() - startedAt,
      details: {
        reason: 'invalid-target-type',
        targetType,
      },
    });
    throw new Error('NIMI_TARGET_TYPE 必须是 CONTACT | FRIEND | AGENT 之一');
  }

  if (targetType === 'AGENT' && !config.agentId) {
    emitRuntimeConfigLog({
      level: 'error',
      message: 'phase:config:assert:failed',
      flowId,
      source: 'assertConfig',
      costMs: Date.now() - startedAt,
      details: {
        reason: 'missing-agent-id-for-agent-target',
      },
    });
    throw new Error('当 NIMI_TARGET_TYPE=AGENT 时必须提供 NIMI_AGENT_ID');
  }

  if ((targetType === 'CONTACT' || targetType === 'FRIEND') && !config.targetAccountId) {
    emitRuntimeConfigLog({
      level: 'error',
      message: 'phase:config:assert:failed',
      flowId,
      source: 'assertConfig',
      costMs: Date.now() - startedAt,
      details: {
        reason: 'missing-target-account-id-for-contact-or-friend',
        targetType,
      },
    });
    throw new Error('当目标是 CONTACT/FRIEND 时必须提供 NIMI_TARGET_ACCOUNT_ID');
  }

  emitRuntimeConfigLog({
    level: 'info',
    message: 'phase:config:assert:done',
    flowId,
    source: 'assertConfig',
    costMs: Date.now() - startedAt,
    details: {
      targetType,
    },
  });
}
