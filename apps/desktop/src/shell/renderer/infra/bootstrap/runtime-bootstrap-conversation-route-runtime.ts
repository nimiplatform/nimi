import {
  createRuntimeRouteCapabilityRuntimeWithHost,
  type Runtime,
} from '@nimiplatform/sdk/runtime';
import {
  setConversationCapabilityRouteRuntime,
  toRuntimeCanonicalCapability,
  type ConversationCapabilityRouteRuntime,
} from '@renderer/features/chat/conversation-capability';
import {
  desktopRuntimeRouteAccess,
  getDesktopRuntimeClient,
} from '@renderer/infra/runtime-route-host-access';
import {
  loadRuntimeRouteOptions,
} from './runtime-bootstrap-route-options';

type RuntimeClient = Pick<Runtime, 'appId' | 'ai'>;

type DesktopConversationCapabilityRouteRuntimeDeps = {
  loadRuntimeRouteOptions: typeof loadRuntimeRouteOptions;
  checkRuntimeRouteHealth: typeof desktopRuntimeRouteAccess.checkLocalHealth;
  buildRuntimeCallOptions: typeof desktopRuntimeRouteAccess.buildCallOptions;
  getRuntimeClient: () => RuntimeClient;
};

const DEFAULT_DEPS: DesktopConversationCapabilityRouteRuntimeDeps = {
  loadRuntimeRouteOptions,
  checkRuntimeRouteHealth: desktopRuntimeRouteAccess.checkLocalHealth,
  buildRuntimeCallOptions: desktopRuntimeRouteAccess.buildCallOptions,
  getRuntimeClient: getDesktopRuntimeClient,
};

export function createDesktopConversationCapabilityRouteRuntime(
  depsInput: Partial<DesktopConversationCapabilityRouteRuntimeDeps> = {},
): ConversationCapabilityRouteRuntime {
  const deps = { ...DEFAULT_DEPS, ...depsInput };
  return createRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async (input) => deps.loadRuntimeRouteOptions({
      capability: toRuntimeCanonicalCapability(input.capability),
      targetId: input.targetId,
    }),
    checkHealth: deps.checkRuntimeRouteHealth,
    describeTargetId: 'core.chat.agent',
    buildDescribeCallOptions: deps.buildRuntimeCallOptions,
    getDescribeHost: () => {
      const runtime = deps.getRuntimeClient();
      return {
        appId: runtime.appId,
        executeScenario: (request, options) => runtime.ai.executeScenario(
          request,
          options as Parameters<Runtime['ai']['executeScenario']>[1],
        ),
      };
    },
  });
}

export function bindDesktopConversationCapabilityRouteRuntime(
  deps?: Partial<DesktopConversationCapabilityRouteRuntimeDeps>,
): void {
  setConversationCapabilityRouteRuntime(createDesktopConversationCapabilityRouteRuntime(deps));
}

export function clearDesktopConversationCapabilityRouteRuntime(): void {
  setConversationCapabilityRouteRuntime(null);
}
