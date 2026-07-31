import type {
  AgentCenterRuntimeModelSettingsProjection,
  AgentCenterSnapshot,
} from '@nimiplatform/kit/features/agent-center';

import type {
  ZhiyuAgentAIConfigReadinessState,
  ZhiyuEvidence,
  ZhiyuExecutionCapabilityEvidence,
} from '../app/evidence';

export type ZhiyuRuntimeRouteStatus = ZhiyuEvidence['route'];

// Local Apps never receive or reconstruct Runtime account or LocalAgent
// identity here. The permissioned Agent Center session is the single
// model-settings owner seam; this adapter only projects its bounded snapshot
// into Zhiyu's existing diagnostics and voice-readiness view.
export function projectZhiyuAgentAIConfigRouteEvidence(
  snapshot: AgentCenterSnapshot | null,
): ZhiyuRuntimeRouteStatus {
  if (!snapshot) {
    return zhiyuAgentAIConfigRouteBlocked({
      reasonCode: 'zhiyu-agent-ai-config-identity-required',
      actionHint: 'select_runtime_local_agent',
      source: 'renderer',
      message: 'Select an authorized Agent before reading its model settings.',
    });
  }

  const modelSettings = snapshot.state.modelSettings;
  if (modelSettings) {
    return projectZhiyuAgentCenterModelSettingsRoute(modelSettings);
  }

  if (snapshot.phase === 'loading') {
    return zhiyuAgentAIConfigRouteBlocked({
      reasonCode: 'zhiyu-agent-ai-config-loading',
      actionHint: 'wait_for_agent_center_model_settings',
      source: 'renderer',
      message: 'Runtime Agent model settings are loading.',
    });
  }

  const readAvailability = snapshot.availability.readModelSettings;
  if (
    readAvailability.reason === 'needs-grant'
    || readAvailability.reason === 'denied'
    || readAvailability.reason === 'revoked'
    || readAvailability.reason === 'request-pending'
  ) {
    return zhiyuAgentAIConfigRouteBlocked({
      reasonCode: 'zhiyu-agent-ai-config-permission-required',
      actionHint: readAvailability.nextStep === 'requestPermission'
        ? 'request_agents_configure_permission'
        : 'wait_for_agents_configure_permission',
      source: 'runtime',
      message: 'Runtime Agent model settings require the agents.configure permission.',
    });
  }

  return zhiyuAgentAIConfigRouteBlocked({
    reasonCode: 'zhiyu-agent-ai-config-unavailable',
    actionHint: 'refresh_agent_center_model_settings',
    source: 'runtime',
    message: snapshot.error?.trim()
      || 'Runtime Agent model settings are unavailable.',
  });
}

export function projectZhiyuAgentCenterModelSettingsRoute(
  modelSettings: AgentCenterRuntimeModelSettingsProjection,
): ZhiyuRuntimeRouteStatus {
  const intents = new Map(
    modelSettings.routeIntents.map((intent) => [intent.capability, intent] as const),
  );
  const readiness = new Map(
    modelSettings.readiness.map((entry) => [entry.capability, entry] as const),
  );
  const capabilityIds = new Set([
    ...modelSettings.capabilities,
    ...intents.keys(),
    ...readiness.keys(),
  ]);
  const capabilities: Record<string, ZhiyuExecutionCapabilityEvidence> = {};

  for (const capability of capabilityIds) {
    const intent = intents.get(capability) ?? null;
    const readinessEntry = readiness.get(capability) ?? null;
    const binding = intent ? executionBinding(intent) : null;
    const state = readinessState(readinessEntry?.state, Boolean(binding));
    capabilities[capability] = {
      state,
      reasonCode: readinessEntry?.reason.trim()
        || (state === 'ready' ? 'ready' : state),
      probedAt: readinessEntry?.observedAt ?? null,
      binding,
    };
  }

  const text = capabilities['text.generate'] ?? null;
  const ready = text?.state === 'ready';
  return {
    transport: 'electron-ipc',
    ready,
    capability: 'text.generate',
    configRevision: modelSettings.configurationRevision,
    readinessRevision: modelSettings.configurationRevision,
    updatedAt: null,
    updatedByAppId: null,
    capabilities,
    executionBinding: text?.binding ?? null,
    ...(ready
      ? {
        reasonCode: 'runtime-agent-ai-config-ready',
        actionHint: 'send_runtime_agent_turn',
        source: 'runtime',
        message: 'Runtime Agent model settings project text.generate as ready.',
      }
      : text?.state === 'not_configured'
        ? {
          reasonCode: 'zhiyu-agent-ai-config-not-configured',
          actionHint: 'configure_runtime_agent_ai_config',
          source: 'runtime',
          message: 'Runtime Agent model settings have no text.generate intent.',
        }
        : {
          reasonCode: 'zhiyu-agent-ai-config-readiness-unavailable',
          actionHint: 'inspect_runtime_agent_ai_config_readiness',
          source: 'runtime',
          message: `Runtime Agent model settings report text.generate as unavailable (${text?.reasonCode || 'unknown'}).`,
        }),
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

function executionBinding(
  intent: AgentCenterRuntimeModelSettingsProjection['routeIntents'][number],
): NonNullable<ZhiyuExecutionCapabilityEvidence['binding']> {
  return {
    route: intent.routePolicy,
    modelId: intent.model,
  };
}

function readinessState(
  state: AgentCenterRuntimeModelSettingsProjection['readiness'][number]['state'] | undefined,
  hasBinding: boolean,
): ZhiyuAgentAIConfigReadinessState {
  if (!hasBinding) return 'not_configured';
  if (state === 'ready') return 'ready';
  return state === 'blocked' ? 'not_configured' : 'unavailable';
}
