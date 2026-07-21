import {
  createNimiRuntimeRouteCapabilityRuntimeWithHost,
  type Runtime,
} from '@nimiplatform/sdk/runtime';
import {
  setConversationCapabilityRouteRuntime,
  type ConversationCapabilityRouteRuntime,
} from '../../features/chat/conversation-capability';
import {
  desktopRuntimeRouteAccess,
} from '../runtime-route-host-access';
import { getDesktopRuntime } from '../sdk/desktop-nimi-client-session';
import {
  loadRuntimeRouteOptions,
} from './runtime-bootstrap-route-options';

type RuntimeClient = Pick<Runtime, 'ai'>;

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
  getRuntimeClient: getDesktopRuntime,
};

export function createDesktopConversationCapabilityRouteRuntime(
  depsInput: Partial<DesktopConversationCapabilityRouteRuntimeDeps> = {},
): ConversationCapabilityRouteRuntime {
  const deps = { ...DEFAULT_DEPS, ...depsInput };
  return createNimiRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async (input) => deps.loadRuntimeRouteOptions({
      capability: input.capability,
      targetId: input.targetId,
      selectedTargetRef: input.selectedTargetRef,
    }),
    checkHealth: deps.checkRuntimeRouteHealth,
    describeTargetId: 'core.chat.agent',
    buildDescribeCallOptions: deps.buildRuntimeCallOptions,
    getDescribeHost: () => {
      const runtime = deps.getRuntimeClient();
      return {
        appId: 'nimi.desktop',
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
