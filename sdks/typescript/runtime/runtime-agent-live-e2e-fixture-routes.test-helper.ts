import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  ConnectorModelDescriptor,
} from '../core-generated/runtime-typed-client';
import {
  ConnectorAuthKind,
  LocalAssetKind,
  LocalAssetStatus,
  LocalBundleState,
  LocalEngineRuntimeMode,
  LocalWarmState,
} from '../core-generated/runtime-typed-client';
import { Runtime } from './index';
import {
  createNimiRuntimeAppSessionMetadataProvider,
} from './app-session';
import {
  buildNimiRuntimeRouteCapabilityProjection,
  createDefaultNimiRuntimeRouteCapabilitySelectionStore,
  updateNimiRuntimeRouteCapabilityTargetRef,
} from './route-capability-projection';
import {
  createNimiRuntimeRouteCapabilityRuntimeWithHost,
} from './route-capability-runtime';
import {
  createNimiHostRuntimeRouteAccessSurface,
} from './route-host-access';
import {
  createNimiRuntimeRouteOptionsHostDeps,
  listNimiRuntimeRouteOptionsWithHost,
} from './route-host-options';
import type { NimiRuntimeRouteTargetRef } from './route-options';
import { withNimiRuntimeAgentScopes } from './runtime-agent-protected';
import {
  DESKTOP_APP_ID,
  DESKTOP_APP_INSTANCE_ID,
  DESKTOP_DEVICE_ID,
  FIXTURE_IMAGE_CONNECTOR_LABEL,
  FIXTURE_IMAGE_MODEL_ID,
  FIXTURE_IMAGE_PROVIDER,
  LOCAL_EMBED_ASSET_ID,
  LOCAL_EMBED_DIMENSIONS,
  LOCAL_EMBED_MODEL_ID,
  LOCAL_EMBED_MODEL_REF,
  LOCAL_TEXT_ASSET_ID,
  LOCAL_TEXT_MODEL_ID,
  LOCAL_TEXT_MODEL_REF,
  OWNER_USER_ID,
  type RuntimeAgentLiveE2ERouteProjection,
  liveIdempotencyOptions,
  normalizeLocalModelRef,
  normalizeText,
  requireText,
  runtimeAgentLiveE2EErrorDiagnostics,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';

export function seedRuntimeAgentLiveLocalRouteState(localStatePath: string, localLlamaEndpoint: string): void {
  mkdirSync(dirname(localStatePath), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(localStatePath, JSON.stringify({
    schemaVersion: 2,
    savedAt: now,
    assets: [{
      localAssetId: LOCAL_TEXT_ASSET_ID,
      assetId: LOCAL_TEXT_MODEL_REF,
      kind: LocalAssetKind.CHAT,
      capabilities: ['chat', 'text.generate'],
      engine: 'llama',
      entry: `${LOCAL_TEXT_MODEL_ID}.gguf`,
      files: [`${LOCAL_TEXT_MODEL_ID}.gguf`],
      license: 'test-fixture',
      sourceRepo: 'sdk-runtime-agent-live-e2e',
      sourceRevision: 'fixture',
      hashes: {},
      status: LocalAssetStatus.ACTIVE,
      installedAt: now,
      updatedAt: now,
      healthDetail: 'runtime agent live e2e local route fixture active',
      engineRuntimeMode: LocalEngineRuntimeMode.ATTACHED_ENDPOINT,
      endpoint: localLlamaEndpoint,
      logicalModelId: LOCAL_TEXT_MODEL_REF,
      family: 'runtime-agent-live-e2e',
      artifactRoles: [],
      preferredEngine: 'llama',
      fallbackEngines: [],
      bundleState: LocalBundleState.READY,
      warmState: LocalWarmState.READY,
      hostRequirements: {},
      engineConfig: {},
      metadata: {
        fixture: 'sdk-runtime-agent-live-e2e',
      },
    }, {
      localAssetId: LOCAL_EMBED_ASSET_ID,
      assetId: LOCAL_EMBED_MODEL_REF,
      kind: LocalAssetKind.EMBEDDING,
      capabilities: ['text.embed'],
      engine: 'llama',
      entry: `${LOCAL_EMBED_MODEL_ID}.gguf`,
      files: [`${LOCAL_EMBED_MODEL_ID}.gguf`],
      license: 'test-fixture',
      sourceRepo: 'sdk-runtime-agent-live-e2e',
      sourceRevision: 'fixture',
      hashes: {},
      status: LocalAssetStatus.ACTIVE,
      installedAt: now,
      updatedAt: now,
      healthDetail: 'runtime agent live e2e local embedding route fixture active',
      engineRuntimeMode: LocalEngineRuntimeMode.ATTACHED_ENDPOINT,
      endpoint: localLlamaEndpoint,
      logicalModelId: LOCAL_EMBED_MODEL_REF,
      family: 'runtime-agent-live-e2e-embedding',
      artifactRoles: [],
      preferredEngine: 'llama',
      fallbackEngines: [],
      bundleState: LocalBundleState.READY,
      warmState: LocalWarmState.READY,
      hostRequirements: {},
      engineConfig: {},
      metadata: {
        fixture: 'sdk-runtime-agent-live-e2e',
        'embedding.dimension': LOCAL_EMBED_DIMENSIONS,
      },
    }],
    services: [],
    transfers: [],
    audits: [],
  }, null, 2));
}

export async function createFixtureRouteProjection(
  runtime: Runtime,
  capability: RuntimeAgentLiveE2ERouteProjection['capability'],
  input: {
    readonly connectorId?: string;
    readonly connectorModel?: ConnectorModelDescriptor;
  } = {},
): Promise<RuntimeAgentLiveE2ERouteProjection> {
  const selectedTargetRef = selectedTargetRefForFixtureCapability(capability, input);
  const routeAccess = createNimiHostRuntimeRouteAccessSurface({
    appId: DESKTOP_APP_ID,
    callerKind: 'sdk-test-fixture',
    surfaceId: 'sdk.runtime-agent-live-e2e',
    callerIdPrefix: 'runtime-agent-live-e2e',
    getRuntime: () => runtime,
  });
  const routeOptionsDeps = createNimiRuntimeRouteOptionsHostDeps(runtime, {
    scope: {},
  });
  const routeDescribeSessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: DESKTOP_APP_ID,
    appInstanceId: DESKTOP_APP_INSTANCE_ID,
    deviceId: DESKTOP_DEVICE_ID,
    appVersion: 'sdk-runtime-agent-live-e2e',
    capabilities: ['ai.spend.meter'],
    developerRegistration: false,
    auth: runtime.auth,
  });
  const routeRuntime = createNimiRuntimeRouteCapabilityRuntimeWithHost({
    routeOptionsTargetId: 'sdk.runtime-agent-live-e2e.route-options',
    describeTargetId: 'sdk.runtime-agent-live-e2e.route-describe',
    loadRuntimeRouteOptions: (input) => listNimiRuntimeRouteOptionsWithHost(input, routeOptionsDeps),
    checkHealth: (input) => routeAccess.checkLocalHealth(input),
    buildDescribeCallOptions: async (input) => {
      const routeOptions = await routeAccess.buildCallOptions({
        targetId: input.targetId,
        timeoutMs: input.timeoutMs,
        source: input.source,
        connectorId: input.connectorId,
        providerEndpoint: input.providerEndpoint,
      });
      return withNimiRuntimeAgentScopes({
        runtime: {
          appId: DESKTOP_APP_ID,
          auth: runtime.auth,
          appAuth: runtime.grants,
        },
        subjectUserId: OWNER_USER_ID,
      }, ['ai.spend.meter'], async (scopeOptions) => {
        const sessionMetadata = await routeDescribeSessionMetadata();
        return liveIdempotencyOptions(`route-describe:${input.targetId}`, {
          ...routeOptions,
          ...scopeOptions,
          timeoutMs: routeOptions.timeoutMs ?? scopeOptions.timeoutMs ?? input.timeoutMs,
          signal: routeOptions.signal ?? scopeOptions.signal,
          metadata: {
            ...sessionMetadata,
            ...(routeOptions.metadata ?? {}),
            ...(scopeOptions.metadata ?? {}),
          },
        });
      });
    },
    getDescribeHost: () => ({
      appId: DESKTOP_APP_ID,
      subjectUserId: OWNER_USER_ID,
      executeScenario: (request, options) => runtime.ai.executeScenario(request, options),
    }),
  });
  const projection = await buildNimiRuntimeRouteCapabilityProjection({
    capability,
    selectionStore: updateNimiRuntimeRouteCapabilityTargetRef(
      createDefaultNimiRuntimeRouteCapabilitySelectionStore(),
      capability,
      selectedTargetRef,
    ),
    routeRuntime,
  });
  if (
    projection.supported !== true
    || !projection.resolvedBinding
    || !projection.selectedTargetRef
    || projection.health?.healthy !== true
    || !projection.metadata
  ) {
    let describeError = '';
    if (projection.resolvedBinding?.resolvedBindingRef) {
      try {
        await routeRuntime.describe({
          capability,
          resolvedBindingRef: projection.resolvedBinding.resolvedBindingRef,
        });
      } catch (error) {
        describeError = JSON.stringify(runtimeAgentLiveE2EErrorDiagnostics(error));
      }
    }
    throw new Error(`Runtime Agent live route projection not ready: ${JSON.stringify({
      projection,
      describeError,
    })}`);
  }
  const modelId = capability === 'image.generate'
    ? normalizeText(projection.resolvedBinding.providerModelId || projection.resolvedBinding.modelId || FIXTURE_IMAGE_MODEL_ID)
    : normalizeLocalModelRef(projection.resolvedBinding.modelId || localModelRefForCapability(capability));
  return {
    capability,
    selectedTargetRefKind: projection.selectedTargetRef.kind,
    resolvedBindingRef: projection.resolvedBinding.resolvedBindingRef,
    targetRef: selectedTargetRef,
    executionBinding: {
      route: capability === 'image.generate' ? 'cloud' : 'local',
      modelId,
      ...(capability === 'image.generate' && selectedTargetRef.kind === 'cloud-connector'
        ? { connectorId: selectedTargetRef.connectorId }
        : {}),
    },
  };
}

export async function createFixtureImageConnector(runtime: Runtime, baseUrl: string): Promise<string> {
  const response = await runtime.connectors.createConnector({
    provider: FIXTURE_IMAGE_PROVIDER,
    endpoint: baseUrl,
    label: FIXTURE_IMAGE_CONNECTOR_LABEL,
    apiKey: 'runtime-agent-live-e2e-image-key',
    authKind: ConnectorAuthKind.API_KEY,
    providerAuthProfile: '',
    credentialJson: '',
  }, liveIdempotencyOptions('create-image-connector'));
  const connectorId = normalizeText(response.connector?.connectorId);
  if (!connectorId) {
    throw new Error(`Runtime Agent live image connector creation returned no connector id: ${JSON.stringify(response)}`);
  }
  return connectorId;
}

export async function resolveFixtureImageConnectorModel(
  runtime: Runtime,
  connectorId: string,
): Promise<ConnectorModelDescriptor> {
  const response = await runtime.connectors.listConnectorModels({
    connectorId,
    forceRefresh: false,
    pageSize: 200,
    pageToken: '',
  }, liveIdempotencyOptions('list-image-connector-models'));
  const descriptor = (response.models || []).find((model) =>
    normalizeText(model.modelId) === FIXTURE_IMAGE_MODEL_ID
    && normalizeText(model.providerModelId) === FIXTURE_IMAGE_MODEL_ID
    && (model.capabilities || []).some((capability) => normalizeText(capability) === 'image.generate')
  );
  if (!descriptor) {
    throw new Error(`Runtime Agent live image connector model missing: ${JSON.stringify(response.models || [])}`);
  }
  if (!normalizeText(descriptor.remoteModelCatalogId)) {
    throw new Error(`Runtime Agent live image connector model has no remote catalog id: ${JSON.stringify(descriptor)}`);
  }
  return descriptor;
}

function localAssetIdForCapability(capability: RuntimeAgentLiveE2ERouteProjection['capability']): string {
  if (capability === 'text.embed') {
    return LOCAL_EMBED_ASSET_ID;
  }
  return LOCAL_TEXT_ASSET_ID;
}

function localModelRefForCapability(capability: RuntimeAgentLiveE2ERouteProjection['capability']): string {
  if (capability === 'text.embed') {
    return LOCAL_EMBED_MODEL_REF;
  }
  return LOCAL_TEXT_MODEL_REF;
}

function selectedTargetRefForFixtureCapability(
  capability: RuntimeAgentLiveE2ERouteProjection['capability'],
  input: {
    readonly connectorId?: string;
    readonly connectorModel?: ConnectorModelDescriptor;
  },
): NimiRuntimeRouteTargetRef {
  if (capability === 'image.generate') {
    const connectorId = requireText(input.connectorId, 'image connector id');
    const model = input.connectorModel;
    if (!model) {
      throw new Error('Runtime Agent live image route requires a connector model descriptor');
    }
    return {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId,
      remoteModelCatalogId: requireText(model.remoteModelCatalogId, 'image remote model catalog id'),
      providerModelId: requireText(model.providerModelId, 'image provider model id'),
      provider: normalizeText(model.provider) || FIXTURE_IMAGE_PROVIDER,
    };
  }
  const localAssetId = localAssetIdForCapability(capability);
  return {
    kind: 'local-runtime',
    version: 'v2',
    profileBindingId: `local-runtime:${localAssetId}`,
  };
}
