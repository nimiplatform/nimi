import {
  createRuntimeRouteModelPickerProvider,
  createRuntimeRouteModelPickerProviderCache,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/kit/features/model-picker/runtime';
import {
  createNimiRuntimeRouteOptionsHostDeps,
  findNimiRuntimeTargetInventoryItem,
  listNimiRuntimeLocalAssetEntries,
  listNimiRuntimeRouteOptionsWithHost,
  normalizeNimiRuntimeRouteTargetRef,
  type NimiRuntimeAgentExecutionBinding,
  type NimiRuntimeLocalAssetEntry,
  type NimiRuntimeLocalAssetListClient,
  type NimiListRuntimeRouteOptionsInput,
  type NimiRuntimeRouteOptionsHostRuntime,
  type NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';
import type { NimiAIConfigTargetRef } from '@nimiplatform/sdk/ai';
import type {
  ModelConfigLocalAssetDescriptor,
  ModelConfigLocalAssetSource,
} from '@nimiplatform/kit/core/model-config';
import {
  getRuntimePlatformProjection,
  type RuntimePlatformReadyProjection,
} from '../auth/runtime-platform';

type ZhiyuRuntimeRouteOptionsHostClient = {
  readonly runtime: NimiRuntimeRouteOptionsHostRuntime;
};

export type ZhiyuModelConfigLocalAssetSourceState = {
  readonly loading: boolean;
  readonly assets: readonly ModelConfigLocalAssetDescriptor[];
};

async function loadZhiyuRuntimeRouteOptions(
  client: ZhiyuRuntimeRouteOptionsHostClient,
  input: NimiListRuntimeRouteOptionsInput,
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  return listNimiRuntimeRouteOptionsWithHost(
    input,
    createNimiRuntimeRouteOptionsHostDeps(client.runtime, { scope: client }),
  );
}

async function readyProjection(): Promise<RuntimePlatformReadyProjection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    throw new Error(projection.message || 'Runtime unavailable; model picker failed closed.');
  }
  return projection;
}

async function loadZhiyuRuntimeRouteOptionsFromProjection(
  input: NimiListRuntimeRouteOptionsInput,
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  const projection = await readyProjection();
  return loadZhiyuRuntimeRouteOptions(projection.client, input);
}

export function createZhiyuRuntimeModelPickerProvider(
  capability: string,
): RouteModelPickerDataProvider {
  return createRuntimeRouteModelPickerProvider({
    capability,
    loadOptions: loadZhiyuRuntimeRouteOptionsFromProjection,
  });
}

export function createZhiyuRuntimeModelPickerProviderCache(): (
  capability: string,
) => RouteModelPickerDataProvider | null {
  return createRuntimeRouteModelPickerProviderCache({
    loadOptions: loadZhiyuRuntimeRouteOptionsFromProjection,
  });
}

export async function listZhiyuRuntimeModelConfigLocalAssetsFromRuntime(
  runtime: NimiRuntimeLocalAssetListClient,
): Promise<ModelConfigLocalAssetDescriptor[]> {
  const entries = await listNimiRuntimeLocalAssetEntries(runtime);
  return entries.map(projectRuntimeLocalAssetForModelConfig);
}

export async function listZhiyuRuntimeModelConfigLocalAssets(): Promise<ModelConfigLocalAssetDescriptor[]> {
  const projection = await readyProjection();
  return listZhiyuRuntimeModelConfigLocalAssetsFromRuntime(projection.client.runtime);
}

export function createZhiyuModelConfigLocalAssetSource(
  state: ZhiyuModelConfigLocalAssetSourceState,
): ModelConfigLocalAssetSource {
  const assets = [...state.assets];
  return {
    loading: state.loading,
    list: () => assets,
  };
}

// Builds the runtime agent execution config binding for a picker-selected
// AIConfig target ref. Cloud target refs already carry their execution
// identity; local target refs are matched against the same route OPTION
// LISTING the picker consumes (this is selection plumbing, not route truth —
// the runtime validates and probes the committed binding itself).
export async function resolveZhiyuExecutionBindingForTargetRef(
  capability: 'text.generate' | 'image.generate',
  targetRef: NimiAIConfigTargetRef,
): Promise<NimiRuntimeAgentExecutionBinding> {
  if (targetRef.kind === 'profile-slice') {
    throw Object.assign(new Error(`Profile-slice target refs are not admitted for the ${capability} execution config binding.`), {
      reasonCode: 'zhiyu-execution-config-target-ref-not-admitted',
      actionHint: 'select_runtime_route_target',
      source: 'renderer',
    });
  }
  const normalized = normalizeNimiRuntimeRouteTargetRef(targetRef);
  if (normalized.kind === 'cloud-connector') {
    const modelId = normalized.providerModelId.trim();
    const connectorId = normalized.connectorId.trim();
    if (!modelId || !connectorId) {
      throw Object.assign(new Error(`Cloud target ref for ${capability} is missing its execution identity.`), {
        reasonCode: 'zhiyu-execution-config-cloud-target-incomplete',
        actionHint: 'select_runtime_route_target',
        source: 'renderer',
      });
    }
    return {
      route: 'cloud',
      modelId,
      connectorId,
      targetRef: normalized,
    };
  }
  const snapshot = await loadZhiyuRuntimeRouteOptionsFromProjection({ capability });
  const item = findNimiRuntimeTargetInventoryItem(snapshot.inventory, normalized);
  const modelId = item?.evidence.source === 'local-runtime'
    ? String(item.evidence.resolvedModelId || '').trim()
    : '';
  if (!modelId) {
    throw Object.assign(new Error(`Runtime route option listing does not resolve a model id for the selected local ${capability} target.`), {
      reasonCode: 'zhiyu-execution-config-model-id-unresolved',
      actionHint: 'reload_runtime_route_options',
      source: 'runtime',
    });
  }
  return {
    route: 'local',
    modelId,
    targetRef: normalized,
  };
}

function projectRuntimeLocalAssetForModelConfig(
  asset: NimiRuntimeLocalAssetEntry,
): ModelConfigLocalAssetDescriptor {
  return {
    localAssetId: asset.localAssetId,
    assetId: asset.assetId,
    kind: asset.kind,
    engine: asset.engine,
    status: asset.status,
    ...(asset.family ? { family: asset.family } : {}),
    ...(asset.modelFamily ? { modelFamily: asset.modelFamily } : {}),
    ...(asset.artifactRoles ? { artifactRoles: [...asset.artifactRoles] } : {}),
    ...(asset.metadata ? { metadata: asset.metadata } : {}),
  };
}
