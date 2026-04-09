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

import { setModSdkHost } from '@nimiplatform/sdk/mod';
import { getPlatformClient } from '@nimiplatform/sdk';
import { logRendererEvent } from '@nimiplatform/nimi-kit/telemetry';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteOptionsSnapshot,
  RuntimeRouteConnectorOption,
} from '@nimiplatform/sdk/mod';

// ---------------------------------------------------------------------------
// Connector kind filter (same constant used by Desktop's sdkListConnectors)
// ---------------------------------------------------------------------------

const CONNECTOR_KIND_REMOTE_MANAGED = 2;

// ---------------------------------------------------------------------------
// Route options builder — Forge-specific, simpler than Desktop
// ---------------------------------------------------------------------------

function normalizeCapabilityToken(value: unknown): RuntimeCanonicalCapability | null {
  const normalized = String(value || '').trim();
  if (
    normalized === 'text.generate'
    || normalized === 'text.embed'
    || normalized === 'image.generate'
    || normalized === 'video.generate'
    || normalized === 'audio.synthesize'
    || normalized === 'audio.transcribe'
    || normalized === 'music.generate'
    || normalized === 'voice_workflow.tts_v2v'
    || normalized === 'voice_workflow.tts_t2v'
  ) {
    return normalized;
  }
  // Aliases
  if (normalized === 'chat') return 'text.generate';
  if (normalized === 'image') return 'image.generate';
  if (normalized === 'video') return 'video.generate';
  if (normalized === 'tts') return 'audio.synthesize';
  if (normalized === 'stt') return 'audio.transcribe';
  if (normalized === 'music') return 'music.generate';
  if (normalized === 'music.generate.iteration') return 'music.generate';
  return null;
}

function modelSupportsCapability(
  capabilities: string[] | undefined,
  capability: RuntimeCanonicalCapability,
): boolean {
  return (capabilities || []).some(
    (item) => normalizeCapabilityToken(item) === capability,
  );
}

async function loadForgeRouteOptions(input: {
  capability: RuntimeCanonicalCapability;
}): Promise<RuntimeRouteOptionsSnapshot> {
  const { runtime } = getPlatformClient();

  // Cloud connectors — filtered to REMOTE_MANAGED
  const connectorResponse = await runtime.connector.listConnectors({
    pageSize: 0,
    pageToken: '',
    kindFilter: CONNECTOR_KIND_REMOTE_MANAGED,
    statusFilter: 0,
    providerFilter: '',
  });

  const rawConnectors = Array.isArray(connectorResponse.connectors)
    ? (connectorResponse.connectors as Array<{
        connectorId: string;
        provider: string;
        label: string;
        kind: number;
      }>)
    : [];

  const connectors: RuntimeRouteConnectorOption[] = [];
  for (const connector of rawConnectors) {
    if (connector.kind !== CONNECTOR_KIND_REMOTE_MANAGED) continue;

    const modelResponse = await runtime.connector.listConnectorModels({
      connectorId: connector.connectorId,
      forceRefresh: false,
      pageSize: 0,
      pageToken: '',
    });
    const rawModels = Array.isArray(modelResponse.models)
      ? (modelResponse.models as Array<{
          modelId: string;
          available: boolean;
          capabilities: string[];
        }>)
      : [];
    const models = rawModels
      .filter((m) => m.available && modelSupportsCapability(m.capabilities, input.capability))
      .map((m) => m.modelId);

    if (models.length === 0) continue;

    const modelCapabilities = rawModels
      .filter((m) => m.available && modelSupportsCapability(m.capabilities, input.capability))
      .reduce<Record<string, string[]>>((acc, m) => {
        acc[m.modelId] = m.capabilities;
        return acc;
      }, {});

    connectors.push({
      id: connector.connectorId,
      label: String(connector.label || ''),
      provider: String(connector.provider || '').trim() || undefined,
      models,
      modelCapabilities,
    });
  }

  // Local assets
  const localResponse = await runtime.local.listLocalAssets({ statusFilter: 0, kindFilter: 0, engineFilter: '', pageSize: 0, pageToken: '' }).catch(() => ({ assets: [] }));
  const rawAssets = Array.isArray(localResponse.assets)
    ? (localResponse.assets as Array<{
        localAssetId?: string;
        assetId?: string;
        logicalModelId?: string;
        modelId?: string;
        engine?: string;
        status?: number;
        capabilities?: string[];
      }>)
    : [];

  const STATUS_MAP: Record<number, string> = {
    0: 'unspecified',
    1: 'installed',
    2: 'active',
    3: 'unhealthy',
    4: 'removed',
  };

  const localModels = rawAssets
    .filter((a) => {
      const status = STATUS_MAP[a.status as number] || 'unspecified';
      return status !== 'removed' && modelSupportsCapability(a.capabilities, input.capability);
    })
    .map((a) => ({
      localModelId: String(a.localAssetId || ''),
      model: String(a.assetId || a.logicalModelId || a.modelId || ''),
      modelId: String(a.assetId || a.logicalModelId || a.modelId || ''),
      label: String(a.assetId || ''),
      engine: String(a.engine || ''),
      status: STATUS_MAP[a.status as number] || 'unspecified',
      capabilities: (a.capabilities || [])
        .map((c) => normalizeCapabilityToken(c))
        .filter((c): c is RuntimeCanonicalCapability => Boolean(c)),
    }));

  return {
    capability: input.capability,
    selected: null,
    local: {
      models: localModels,
    },
    connectors,
  };
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
        listAssets: async (input: { modId: string }) => {
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
