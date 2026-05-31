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
  buildRuntimeCallOptions,
  getRuntimeClient,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import {
  checkLocalLlmHealth,
} from '@runtime/llm-adapter/execution/health-check';
import {
  loadRuntimeRouteOptions,
} from './runtime-bootstrap-route-options';

type RuntimeClient = Pick<Runtime, 'appId' | 'ai'>;

type DesktopConversationCapabilityRouteRuntimeDeps = {
  loadRuntimeRouteOptions: typeof loadRuntimeRouteOptions;
  checkLocalLlmHealth: typeof checkLocalLlmHealth;
  buildRuntimeCallOptions: typeof buildRuntimeCallOptions;
  getRuntimeClient: () => RuntimeClient;
};

const DEFAULT_DEPS: DesktopConversationCapabilityRouteRuntimeDeps = {
  loadRuntimeRouteOptions,
  checkLocalLlmHealth,
  buildRuntimeCallOptions,
  getRuntimeClient,
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
    checkHealth: deps.checkLocalLlmHealth,
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
