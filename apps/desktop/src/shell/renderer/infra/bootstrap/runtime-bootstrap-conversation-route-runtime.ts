import {
  createNimiRuntimeRouteCapabilityRuntimeWithHost,
  type Runtime,
} from '@nimiplatform/sdk/runtime';
import type { ConversationCapabilityRouteRuntime } from '../../features/chat/conversation-capability';
import { setProductionConversationCapabilityRouteRuntime } from '../../features/chat/production-conversation-route-runtime-state.js';
import {
  createDesktopRuntimeRouteAccess,
  type DesktopRuntimeRouteAccess,
} from '../runtime-route-host-access';
import { getDesktopRuntime } from '../sdk/desktop-nimi-client-session';
import {
  loadRuntimeRouteOptions,
} from './runtime-bootstrap-route-options';

type RuntimeClient = Runtime;

type DesktopConversationCapabilityRouteRuntimeDeps = {
  loadRuntimeRouteOptions: typeof loadRuntimeRouteOptions;
  checkRuntimeRouteHealth: DesktopRuntimeRouteAccess['checkLocalHealth'];
  buildRuntimeCallOptions: DesktopRuntimeRouteAccess['buildCallOptions'];
  getRuntimeClient: () => RuntimeClient;
};

export function createDesktopConversationCapabilityRouteRuntime(
  depsInput: Partial<DesktopConversationCapabilityRouteRuntimeDeps> = {},
): ConversationCapabilityRouteRuntime {
  const routeAccess = createDesktopRuntimeRouteAccess(getDesktopRuntime);
  const deps: DesktopConversationCapabilityRouteRuntimeDeps = {
    loadRuntimeRouteOptions,
    checkRuntimeRouteHealth: routeAccess.checkLocalHealth,
    buildRuntimeCallOptions: routeAccess.buildCallOptions,
    getRuntimeClient: getDesktopRuntime,
    ...depsInput,
  };
  return createNimiRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async (input) => deps.loadRuntimeRouteOptions({
      capability: input.capability,
      targetId: input.targetId,
      selectedTargetRef: input.selectedTargetRef,
    }, { runtime: deps.getRuntimeClient() }),
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
  setProductionConversationCapabilityRouteRuntime(createDesktopConversationCapabilityRouteRuntime(deps));
}

export function clearDesktopConversationCapabilityRouteRuntime(): void {
  setProductionConversationCapabilityRouteRuntime(null);
}
