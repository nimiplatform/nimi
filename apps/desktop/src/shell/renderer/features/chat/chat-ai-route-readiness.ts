import {
  createReadyConversationSetupState,
  type ConversationSetupAction,
  type ConversationSetupIssue,
  type ConversationSetupState,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  ApiConnector,
  ProviderStatusV11,
  RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import type { AiConversationRouteSnapshot } from './chat-shell-types';

export type AiConversationResolvedRoute = {
  routeKind: 'local' | 'cloud';
  connectorId: string | null;
  provider: string | null;
  modelId: string | null;
};

export type AiConversationRouteReadiness = {
  status: ConversationSetupState['status'];
  setupState: ConversationSetupState;
  readyRoutes: readonly AiConversationResolvedRoute[];
  defaultRoute: AiConversationResolvedRoute | null;
  preferredRoute: AiConversationResolvedRoute | null;
  localReady: boolean;
  cloudReady: boolean;
  configuredCloudConnectorCount: number;
};

const READY_PROVIDER_STATUSES: readonly ProviderStatusV11[] = ['healthy', 'degraded'];
type ConversationSettingsTargetId = Extract<
  ConversationSetupAction,
  { kind: 'open-settings' }
>['targetId'];

function isReadyProviderStatus(status: ProviderStatusV11): boolean {
  return READY_PROVIDER_STATUSES.includes(status);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasLocalChatCapability(state: RuntimeConfigStateV11): boolean {
  return state.local.models.some(
    (model) => model.status === 'active' && model.capabilities.includes('chat'),
  ) || state.local.nodeMatrix.some(
    (node) => node.capability === 'chat' && node.available,
  );
}

function hasChatCapableConnectorModels(connector: ApiConnector): boolean {
  const models = connector.models
    .map((modelId) => normalizeText(modelId))
    .filter(Boolean);
  if (models.length === 0) {
    return false;
  }
  const capabilityMap = connector.modelCapabilities || {};
  const capabilityKeys = Object.keys(capabilityMap);
  if (capabilityKeys.length === 0) {
    return true;
  }
  return models.some((modelId) => {
    const capabilities = capabilityMap[modelId];
    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      return false;
    }
    return capabilities.includes('chat');
  });
}

function isConfiguredCloudConnector(connector: ApiConnector): boolean {
  return Boolean(
    connector.hasCredential
    && normalizeText(connector.provider)
    && normalizeText(connector.id),
  );
}

function isReadyCloudConnector(connector: ApiConnector): boolean {
  return isConfiguredCloudConnector(connector)
    && isReadyProviderStatus(connector.status)
    && hasChatCapableConnectorModels(connector);
}

function toCloudRoute(connector: ApiConnector, modelId?: string | null): AiConversationResolvedRoute {
  return {
    routeKind: 'cloud',
    connectorId: connector.id,
    provider: normalizeText(connector.provider) || null,
    modelId: normalizeText(modelId) || null,
  };
}

function buildSettingsAction(
  targetId: ConversationSettingsTargetId,
): ConversationSetupAction {
  return {
    kind: 'open-settings',
    targetId,
    returnToMode: 'ai',
  };
}

function resolvePreferredCloudRoute(
  readyConnectors: readonly ApiConnector[],
  routeSnapshot: AiConversationRouteSnapshot,
): AiConversationResolvedRoute | null {
  const connectorId = normalizeText(routeSnapshot.connectorId);
  const provider = normalizeText(routeSnapshot.provider);
  const modelId = normalizeText(routeSnapshot.modelId);
  const connector = readyConnectors.find((candidate) => {
    if (connectorId && candidate.id !== connectorId) {
      return false;
    }
    if (provider && normalizeText(candidate.provider) !== provider) {
      return false;
    }
    if (modelId && !candidate.models.includes(modelId)) {
      return false;
    }
    return true;
  });
  if (!connector) {
    return null;
  }
  return toCloudRoute(connector, modelId || null);
}

function buildUnavailableState(): AiConversationRouteReadiness {
  const setupState: ConversationSetupState = {
    mode: 'ai',
    status: 'unavailable',
    issues: [{
      code: 'ai-route-readiness-unavailable',
      detail: 'runtime config state unavailable',
    }],
    primaryAction: buildSettingsAction('runtime-overview'),
  };
  return {
    status: setupState.status,
    setupState,
    readyRoutes: [],
    defaultRoute: null,
    preferredRoute: null,
    localReady: false,
    cloudReady: false,
    configuredCloudConnectorCount: 0,
  };
}

function buildSetupRequiredState(input: {
  issues: readonly ConversationSetupIssue[];
  action: ConversationSetupAction | null;
  readyRoutes: readonly AiConversationResolvedRoute[];
  configuredCloudConnectorCount: number;
  localReady: boolean;
  cloudReady: boolean;
}): AiConversationRouteReadiness {
  const setupState: ConversationSetupState = {
    mode: 'ai',
    status: 'setup-required',
    issues: input.issues,
    primaryAction: input.action,
  };
  return {
    status: setupState.status,
    setupState,
    readyRoutes: input.readyRoutes,
    defaultRoute: null,
    preferredRoute: null,
    localReady: input.localReady,
    cloudReady: input.cloudReady,
    configuredCloudConnectorCount: input.configuredCloudConnectorCount,
  };
}

export function resolveAiConversationRouteReadiness(input: {
  runtimeConfigState: RuntimeConfigStateV11 | null;
  routeSnapshot?: AiConversationRouteSnapshot | null;
}): AiConversationRouteReadiness {
  const state = input.runtimeConfigState;
  if (!state) {
    return buildUnavailableState();
  }

  const localReady = hasLocalChatCapability(state) && isReadyProviderStatus(state.local.status);
  const readyConnectors = state.connectors.filter((connector) => isReadyCloudConnector(connector));
  const configuredCloudConnectors = state.connectors.filter((connector) => isConfiguredCloudConnector(connector));
  const localRoute: AiConversationResolvedRoute | null = localReady
    ? { routeKind: 'local', connectorId: null, provider: null, modelId: null }
    : null;
  const cloudRoutes = readyConnectors.map((connector) => toCloudRoute(connector));
  const readyRoutes = [...(localRoute ? [localRoute] : []), ...cloudRoutes];
  const defaultRoute = localRoute ?? cloudRoutes[0] ?? null;
  const routeSnapshot = input.routeSnapshot ?? null;

  if (routeSnapshot) {
    const preferredRoute = routeSnapshot.routeKind === 'local'
      ? localRoute
      : resolvePreferredCloudRoute(readyConnectors, routeSnapshot);
    if (!preferredRoute) {
      return buildSetupRequiredState({
        issues: [{
          code: 'ai-thread-route-unavailable',
          routeKind: routeSnapshot.routeKind,
          detail: routeSnapshot.routeKind === 'local'
            ? normalizeText(state.local.lastDetail) || 'saved local route is not ready'
            : 'saved cloud route is not ready',
        }],
        action: buildSettingsAction(
          routeSnapshot.routeKind === 'local' ? 'runtime-local' : 'runtime-cloud',
        ),
        readyRoutes,
        configuredCloudConnectorCount: configuredCloudConnectors.length,
        localReady,
        cloudReady: cloudRoutes.length > 0,
      });
    }
    return {
      status: 'ready',
      setupState: createReadyConversationSetupState('ai'),
      readyRoutes,
      defaultRoute: preferredRoute,
      preferredRoute,
      localReady,
      cloudReady: cloudRoutes.length > 0,
      configuredCloudConnectorCount: configuredCloudConnectors.length,
    };
  }

  if (defaultRoute) {
    return {
      status: 'ready',
      setupState: createReadyConversationSetupState('ai'),
      readyRoutes,
      defaultRoute,
      preferredRoute: defaultRoute,
      localReady,
      cloudReady: cloudRoutes.length > 0,
      configuredCloudConnectorCount: configuredCloudConnectors.length,
    };
  }

  const issues: ConversationSetupIssue[] = [];
  if (!localReady) {
    issues.push({
      code: 'ai-local-route-unavailable',
      routeKind: 'local',
      detail: normalizeText(state.local.lastDetail) || 'local chat route is not ready',
    });
  }
  issues.push({
    code: 'ai-cloud-route-unavailable',
    routeKind: 'cloud',
    detail: configuredCloudConnectors.length > 0
      ? 'configured cloud routes are not ready'
      : 'no configured cloud route',
  });
  issues.push({
    code: 'ai-no-chat-route',
    detail: 'no ready AI chat route is available',
  });

  const action = configuredCloudConnectors.length > 0
    ? buildSettingsAction('runtime-cloud')
    : buildSettingsAction(localReady ? 'runtime-cloud' : 'runtime-overview');

  return buildSetupRequiredState({
    issues,
    action,
    readyRoutes,
    configuredCloudConnectorCount: configuredCloudConnectors.length,
    localReady,
    cloudReady: false,
  });
}
