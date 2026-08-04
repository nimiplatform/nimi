import type {
  AgentCenterSharedAIConfigProjection,
  AgentCenterSnapshot,
} from '@nimiplatform/kit/features/agent-center';

import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuRuntimeRouteStatus = ZhiyuEvidence['route'];

// Shared LocalAgent AIConfig is account-scoped. The selected Agent handle is
// used only by the surrounding Agent Center session for per-Agent settings;
// this projection never turns that handle into AIConfig identity or execution
// readiness.
export function projectZhiyuAgentAIConfigRouteEvidence(
  snapshot: AgentCenterSnapshot | null,
): ZhiyuRuntimeRouteStatus {
  if (!snapshot) {
    return zhiyuAgentAIConfigRouteBlocked({
      reasonCode: 'zhiyu-shared-ai-config-session-unavailable',
      actionHint: 'open_authorized_agent_center_session',
      source: 'renderer',
      message: 'The shared LocalAgent AI configuration session is unavailable.',
    });
  }

  const sharedAIConfig = snapshot.state.sharedAIConfig;
  if (sharedAIConfig) {
    return projectZhiyuSharedAIConfigIntentEvidence(sharedAIConfig);
  }

  if (snapshot.phase === 'loading') {
    return zhiyuAgentAIConfigRouteBlocked({
      reasonCode: 'zhiyu-shared-ai-config-loading',
      actionHint: 'wait_for_shared_local_agent_ai_config',
      source: 'renderer',
      message: 'The shared LocalAgent AI configuration is loading.',
    });
  }

  const readAvailability = snapshot.availability.getSharedAIConfig;
  if (
    readAvailability.reason === 'needs-grant'
    || readAvailability.reason === 'denied'
    || readAvailability.reason === 'revoked'
    || readAvailability.reason === 'request-pending'
  ) {
    return zhiyuAgentAIConfigRouteBlocked({
      reasonCode: 'zhiyu-shared-ai-config-permission-required',
      actionHint: readAvailability.nextStep === 'requestPermission'
        ? 'request_agents_configure_permission'
        : 'wait_for_agents_configure_permission',
      source: 'runtime',
      message: 'Reading the shared LocalAgent AI configuration requires permission.',
    });
  }

  return zhiyuAgentAIConfigRouteBlocked({
    reasonCode: 'zhiyu-shared-ai-config-unavailable',
    actionHint: 'refresh_shared_local_agent_ai_config',
    source: 'runtime',
    message: snapshot.error?.trim()
      || 'The shared LocalAgent AI configuration is unavailable.',
  });
}

export function projectZhiyuSharedAIConfigIntentEvidence(
  sharedAIConfig: AgentCenterSharedAIConfigProjection,
): ZhiyuRuntimeRouteStatus {
  const textConfigured = sharedAIConfig.intents.some(
    (intent) => intent.capability === 'text.generate',
  );
  return {
    transport: 'electron-ipc',
    ready: false,
    capability: 'text.generate',
    configRevision: null,
    readinessRevision: null,
    updatedAt: null,
    updatedByAppId: null,
    capabilities: {},
    executionBinding: null,
    reasonCode: textConfigured
      ? 'runtime-shared-ai-config-text-intent-configured'
      : 'zhiyu-shared-ai-config-text-intent-not-configured',
    actionHint: textConfigured
      ? 'submit_runtime_agent_turn_for_derived_admission'
      : 'configure_shared_local_agent_ai_config',
    source: 'runtime',
    message: textConfigured
      ? 'The shared text capability intent is configured; Runtime determines availability for each request.'
      : 'The shared LocalAgent AI configuration has no text capability intent.',
  };
}

export function zhiyuAgentAIConfigRouteBlocked(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
}): ZhiyuRuntimeRouteStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    capability: 'text.generate',
    configRevision: null,
    readinessRevision: null,
    updatedAt: null,
    updatedByAppId: null,
    capabilities: {},
    executionBinding: null,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
  };
}
