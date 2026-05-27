import {
  checkRuntimeRouteHealthWithHost,
  describeRuntimeRouteWithHost,
  resolveRuntimeRouteBindingFromSnapshot,
  type RuntimeCanonicalCapability,
  type RuntimeResolvedBinding,
  type RuntimeRouteBinding,
} from '@nimiplatform/sdk/ai';
import {
  type Runtime,
} from '@nimiplatform/sdk/runtime';
import {
  setConversationCapabilityRouteRuntime,
  type ConversationCapability,
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createDesktopConversationCapabilityRouteRuntime(
  depsInput: Partial<DesktopConversationCapabilityRouteRuntimeDeps> = {},
): ConversationCapabilityRouteRuntime {
  const deps = { ...DEFAULT_DEPS, ...depsInput };
  const resolvedByRef = new Map<string, RuntimeResolvedBinding>();

  async function resolve(input: {
    capability: ConversationCapability;
    binding?: RuntimeRouteBinding;
  }): Promise<RuntimeResolvedBinding> {
    if (!input.binding) {
      throw new Error('RUNTIME_ROUTE_BINDING_REQUIRED');
    }
    const capability = input.capability as RuntimeCanonicalCapability;
    const snapshot = await deps.loadRuntimeRouteOptions({ capability });
    const resolved = resolveRuntimeRouteBindingFromSnapshot({
      capability,
      binding: input.binding,
      snapshot,
    });
    if (resolved.resolvedBindingRef) {
      resolvedByRef.set(resolved.resolvedBindingRef, resolved);
    }
    return resolved;
  }

  return {
    resolve,
    checkHealth: async (input) => {
      const resolved = await resolve(input);
      return checkRuntimeRouteHealthWithHost({
        resolved,
        checkHealth: deps.checkLocalLlmHealth,
      });
    },
    describe: async (input) => {
      const capability = input.capability as RuntimeCanonicalCapability;
      const resolvedBindingRef = normalizeText(input.resolvedBindingRef);
      const resolved = resolvedByRef.get(resolvedBindingRef);
      if (!resolved) {
        throw new Error('RUNTIME_ROUTE_DESCRIBE_BINDING_REF_MISSING');
      }
      const runtime = deps.getRuntimeClient();
      return describeRuntimeRouteWithHost({
        appId: runtime.appId,
        targetId: 'core.chat.agent',
        capability,
        resolvedBindingRef,
        resolved,
        buildCallOptions: deps.buildRuntimeCallOptions,
        executeScenario: (request, options) => runtime.ai.executeScenario(
          request,
          options as Parameters<Runtime['ai']['executeScenario']>[1],
        ),
      });
    },
  };
}

export function bindDesktopConversationCapabilityRouteRuntime(
  deps?: Partial<DesktopConversationCapabilityRouteRuntimeDeps>,
): void {
  setConversationCapabilityRouteRuntime(createDesktopConversationCapabilityRouteRuntime(deps));
}

export function clearDesktopConversationCapabilityRouteRuntime(): void {
  setConversationCapabilityRouteRuntime(null);
}
