/**
 * Forge Runtime Host — Trimmed ModSdkHost for route authority (FG-ROUTE-003).
 *
 * Provides only the namespaces Forge needs:
 *   - runtime.route (listOptions for capability-first picker)
 *   - runtime.local (asset/profile listing)
 *   - logging
 *
 * All other namespaces (ui, shell, settings, lifecycle, voice, kernel turn,
 * hook runtime) are stubbed to satisfy the ModSdkHost type but will throw
 * if actually invoked — Forge does not use mod lifecycle or hook features.
 */

import { setModSdkHost } from '@nimiplatform/sdk/ai';
import { getPlatformClient } from '@nimiplatform/sdk';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/ai';

// ---------------------------------------------------------------------------
// Route options authority
// ---------------------------------------------------------------------------

type RuntimeRouteAuthority = {
  route?: {
    listOptions?: (input: {
      capability: RuntimeCanonicalCapability;
    }) => Promise<RuntimeRouteOptionsSnapshot>;
  };
};

async function loadForgeRouteOptions(input: {
  capability: RuntimeCanonicalCapability;
}): Promise<RuntimeRouteOptionsSnapshot> {
  const runtime = getPlatformClient().runtime as RuntimeRouteAuthority;
  const listOptions = runtime.route?.listOptions;
  if (!listOptions) {
    throw new Error(
      'FORGE_RUNTIME_ROUTE_AUTHORITY_UNAVAILABLE: runtime.route.listOptions is required for Forge route options',
    );
  }
  return listOptions({ capability: input.capability });
}

// ---------------------------------------------------------------------------
// Stub creator — throws on invocation with clear message
// ---------------------------------------------------------------------------

function forgeUnsupported(namespace: string): never {
  throw new Error(
    `Forge mod SDK host does not support ${namespace}. ` +
    'Only route.listOptions and local.listAssets/listProfiles are available in Forge.',
  );
}

function createStubProxy(namespace: string): any {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return undefined; // Prevent Promise detection
      return (..._args: unknown[]) => forgeUnsupported(`${namespace}.${String(prop)}`);
    },
  });
}

// ---------------------------------------------------------------------------
// Host builder
// ---------------------------------------------------------------------------

export function buildForgeRuntimeHost() {
  const host = {
    runtime: {
      checkLocalLlmHealth: () => forgeUnsupported('runtime.checkLocalLlmHealth'),
      executeLocalKernelTurn: () => forgeUnsupported('runtime.executeLocalKernelTurn'),
      withOpenApiContextLock: () => forgeUnsupported('runtime.withOpenApiContextLock'),
      getRuntimeHookRuntime: () => createStubProxy('hookRuntime'),
      getModLocalProfileSnapshot: () => forgeUnsupported('runtime.getModLocalProfileSnapshot'),
      route: {
        listOptions: async (input: { modId: string; capability: RuntimeCanonicalCapability }) =>
          loadForgeRouteOptions({ capability: input.capability }),
        resolve: () => forgeUnsupported('runtime.route.resolve'),
        checkHealth: () => forgeUnsupported('runtime.route.checkHealth'),
        describe: () => forgeUnsupported('runtime.route.describe'),
      },
      scheduler: {
        peek: async () => ({ state: 'unknown', detail: 'forge does not support scheduling peek', occupancy: null, resourceWarnings: [] }),
      },
      local: {
        listAssets: async (_input: { modId: string }) => {
          const { runtime } = getPlatformClient();
          const response = await runtime.local.listLocalAssets({ statusFilter: 0, kindFilter: 0, engineFilter: '', pageSize: 0, pageToken: '' });
          return response.assets || [];
        },
        listProfiles: async (_input: { modId: string }) => {
          // Forge does not use local profiles in Phase 1
          return [];
        },
        requestProfileInstall: () => forgeUnsupported('runtime.local.requestProfileInstall'),
        getProfileInstallStatus: () => forgeUnsupported('runtime.local.getProfileInstallStatus'),
      },
      ai: createStubProxy('runtime.ai'),
      media: createStubProxy('runtime.media'),
      voice: createStubProxy('runtime.voice'),
    },
    ui: {
      useAppStore: () => forgeUnsupported('ui.useAppStore'),
      SlotHost: (() => forgeUnsupported('ui.SlotHost')) as any,
      useUiExtensionContext: () => forgeUnsupported('ui.useUiExtensionContext'),
    },
    logging: {
      emitRuntimeLog: (payload: any) => {
        logRendererEvent({
          level: payload.level || 'info',
          area: payload.area || 'forge-runtime',
          message: payload.message || '',
          details: payload.details,
        });
      },
      createRendererFlowId: (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      logRendererEvent,
    },
    lifecycle: {
      subscribe: () => () => {},
      getState: () => 'active' as const,
    },
  };

  return host;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

let registered = false;

export function registerForgeModSdkHost(): void {
  if (registered) return;
  registered = true;
  const host = buildForgeRuntimeHost();
  setModSdkHost(host as any);
}
