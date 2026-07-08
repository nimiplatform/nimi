import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
  FIXTURE_TRANSCRIPTION_MODEL_ID,
  FIXTURE_VOICE_CONNECTOR_LABEL,
  FIXTURE_VOICE_ID,
  FIXTURE_VOICE_MODEL_ID,
  FIXTURE_VOICE_PROVIDER,
  FIXTURE_VOICE_SET_ID,
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
  const modelId = selectedTargetRef.kind === 'cloud-connector'
    ? normalizeText(projection.resolvedBinding.providerModelId || projection.resolvedBinding.modelId || selectedTargetRef.providerModelId)
    : normalizeLocalModelRef(projection.resolvedBinding.modelId || localModelRefForCapability(capability));
  return {
    capability,
    selectedTargetRefKind: projection.selectedTargetRef.kind,
    resolvedBindingRef: projection.resolvedBinding.resolvedBindingRef,
    targetRef: selectedTargetRef,
    executionBinding: {
      route: selectedTargetRef.kind === 'cloud-connector' ? 'cloud' : 'local',
      modelId,
      ...(selectedTargetRef.kind === 'cloud-connector'
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

export async function resolveFixtureTranscriptionConnectorModel(
  runtime: Runtime,
  connectorId: string,
): Promise<ConnectorModelDescriptor> {
  const response = await runtime.connectors.listConnectorModels({
    connectorId,
    forceRefresh: false,
    pageSize: 200,
    pageToken: '',
  }, liveIdempotencyOptions('list-transcription-connector-models'));
  const descriptor = (response.models || []).find((model) =>
    normalizeText(model.modelId) === FIXTURE_TRANSCRIPTION_MODEL_ID
    && normalizeText(model.providerModelId) === FIXTURE_TRANSCRIPTION_MODEL_ID
    && (model.capabilities || []).some((capability) => normalizeText(capability) === 'audio.transcribe')
  );
  if (!descriptor) {
    throw new Error(`Runtime Agent live transcription connector model missing: ${JSON.stringify(response.models || [])}`);
  }
  if (!normalizeText(descriptor.remoteModelCatalogId)) {
    throw new Error(`Runtime Agent live transcription connector model has no remote catalog id: ${JSON.stringify(descriptor)}`);
  }
  return descriptor;
}

export function seedRuntimeAgentLiveImageCatalogProvider(customDir: string): void {
  mkdirSync(customDir, { recursive: true });
  writeFileSync(join(customDir, `${FIXTURE_IMAGE_PROVIDER}.yaml`), fixtureImageCatalogProviderYaml());
}

export function seedRuntimeAgentLiveVoiceCatalogProvider(customDir: string): void {
  mkdirSync(customDir, { recursive: true });
  writeFileSync(join(customDir, `${FIXTURE_VOICE_PROVIDER}.yaml`), fixtureVoiceCatalogProviderYaml());
}

export async function createFixtureVoiceConnector(runtime: Runtime, baseUrl: string): Promise<string> {
  const response = await runtime.connectors.createConnector({
    provider: FIXTURE_VOICE_PROVIDER,
    endpoint: baseUrl,
    label: FIXTURE_VOICE_CONNECTOR_LABEL,
    apiKey: 'runtime-agent-live-e2e-voice-key',
    authKind: ConnectorAuthKind.API_KEY,
    providerAuthProfile: '',
    credentialJson: '',
  }, liveIdempotencyOptions('create-voice-connector'));
  const connectorId = normalizeText(response.connector?.connectorId);
  if (!connectorId) {
    throw new Error(`Runtime Agent live voice connector creation returned no connector id: ${JSON.stringify(response)}`);
  }
  return connectorId;
}

export async function resolveFixtureVoiceConnectorModel(
  runtime: Runtime,
  connectorId: string,
): Promise<ConnectorModelDescriptor> {
  const response = await runtime.connectors.listConnectorModels({
    connectorId,
    forceRefresh: false,
    pageSize: 200,
    pageToken: '',
  }, liveIdempotencyOptions('list-voice-connector-models'));
  const descriptor = (response.models || []).find((model) =>
    normalizeText(model.modelId) === FIXTURE_VOICE_MODEL_ID
    && normalizeText(model.providerModelId) === FIXTURE_VOICE_MODEL_ID
    && (model.capabilities || []).some((capability) => normalizeText(capability) === 'audio.synthesize')
  );
  if (!descriptor) {
    throw new Error(`Runtime Agent live voice connector model missing: ${JSON.stringify(response.models || [])}`);
  }
  if (!normalizeText(descriptor.remoteModelCatalogId)) {
    throw new Error(`Runtime Agent live voice connector model has no remote catalog id: ${JSON.stringify(descriptor)}`);
  }
  return descriptor;
}

function fixtureImageCatalogProviderYaml(): string {
  return `version: 1
provider: ${FIXTURE_IMAGE_PROVIDER}
catalog_version: runtime-agent-live-e2e-image
models:
  - model_id: ${FIXTURE_IMAGE_MODEL_ID}
    provider: ${FIXTURE_IMAGE_PROVIDER}
    model_type: image
    updated_at: "2026-07-06"
    capabilities:
      - image.generate
    pricing:
      unit: request
      input: "0"
      output: "0"
      currency: USD
      as_of: "2026-07-06"
      notes: Runtime Agent live fixture image generation.
    source_ref:
      url: http://127.0.0.1/runtime-agent-live-e2e/image-catalog
      retrieved_at: "2026-07-06"
      note: Runtime Agent live fixture image generation.
    image_request_options:
      response_formats:
        - b64_json
        - url
      max_images_per_request: 1
      supports_negative_prompt: true
      supports_reference_images: true
      supports_mask: true
      supports_seed: true
      supports_size: true
      supports_aspect_ratio: true
      supports_quality: true
      supports_style: true
  - model_id: ${FIXTURE_TRANSCRIPTION_MODEL_ID}
    provider: ${FIXTURE_IMAGE_PROVIDER}
    model_type: stt
    updated_at: "2026-07-06"
    capabilities:
      - audio.transcribe
    pricing:
      unit: request
      input: "0"
      output: "0"
      currency: USD
      as_of: "2026-07-06"
      notes: Runtime Agent live fixture speech transcription.
    source_ref:
      url: http://127.0.0.1/runtime-agent-live-e2e/transcription-catalog
      retrieved_at: "2026-07-06"
      note: Runtime Agent live fixture speech transcription.
    transcription:
      tiers:
        - core_transcript
      response_formats:
        - json
      supports_language: true
      supports_prompt: true
`;
}

function fixtureVoiceCatalogProviderYaml(): string {
  return `version: 1
provider: ${FIXTURE_VOICE_PROVIDER}
catalog_version: runtime-agent-live-e2e-native-voice
models:
  - model_id: ${FIXTURE_VOICE_MODEL_ID}
    provider: ${FIXTURE_VOICE_PROVIDER}
    model_type: tts
    updated_at: "2026-07-06"
    capabilities:
      - audio.synthesize
    pricing:
      unit: request
      input: "0"
      output: "0"
      currency: USD
      as_of: "2026-07-06"
      notes: Runtime Agent live fixture native TTS stream.
    source_ref:
      url: http://127.0.0.1/runtime-agent-live-e2e/voice-catalog
      retrieved_at: "2026-07-06"
      note: Runtime Agent live fixture native TTS stream.
    voice_set_id: ${FIXTURE_VOICE_SET_ID}
    voice_discovery_mode: static_catalog
    voice_request_options:
      timing_modes:
        - none
        - word
      audio_formats:
        - wav
      supports_native_stream_tts: true
    voice_ref_kinds:
      - preset_voice_id
      - voice_asset_id
voices:
  - voice_set_id: ${FIXTURE_VOICE_SET_ID}
    provider: ${FIXTURE_VOICE_PROVIDER}
    voice_id: ${FIXTURE_VOICE_ID}
    name: Runtime Live Voice
    langs:
      - zh
      - en
    model_ids:
      - ${FIXTURE_VOICE_MODEL_ID}
    source_ref:
      url: http://127.0.0.1/runtime-agent-live-e2e/voice-catalog
      retrieved_at: "2026-07-06"
      note: Runtime Agent live fixture native TTS stream.
voice_workflow_models:
  - workflow_model_id: runtime-live-voice-clone
    workflow_type: voice_clone
    input_contract_ref: dashscope_fixture.voice_clone.v1
    output_persistence: provider_persistent
    target_model_refs:
      - ${FIXTURE_VOICE_MODEL_ID}
    langs:
      - zh
      - en
    request_options:
      text_prompt_mode: optional
      supports_language_hints: true
      supports_preferred_name: true
      reference_audio_uri_input: true
      reference_audio_bytes_input: true
      allowed_reference_audio_mime_types:
        - audio/wav
        - audio/mpeg
    source_ref:
      url: http://127.0.0.1/runtime-agent-live-e2e/voice-workflow
      retrieved_at: "2026-07-06"
      note: Runtime Agent live fixture custom VoiceAsset workflow.
model_workflow_bindings:
  - model_id: ${FIXTURE_VOICE_MODEL_ID}
    workflow_model_refs:
      - runtime-live-voice-clone
    workflow_types:
      - voice_clone
voice_handle_policies:
  - policy_id: runtime_live_provider_persistent_default
    provider: ${FIXTURE_VOICE_PROVIDER}
    applies_to_workflow_types:
      - voice_clone
    persistence: provider_persistent
    default_ttl: durable_until_user_cleanup
    scope: user_scoped
    delete_semantics: best_effort_provider_delete
    runtime_reconciliation_required: false
    source_ref:
      url: http://127.0.0.1/runtime-agent-live-e2e/voice-workflow
      retrieved_at: "2026-07-06"
      note: Runtime Agent live fixture custom VoiceAsset workflow.
`;
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
  if (capability === 'image.generate' || capability === 'audio.synthesize' || capability === 'audio.transcribe') {
    const provider = capability === 'audio.synthesize' ? FIXTURE_VOICE_PROVIDER : FIXTURE_IMAGE_PROVIDER;
    const label = capability === 'audio.synthesize'
      ? 'voice'
      : capability === 'audio.transcribe'
        ? 'transcription'
        : 'image';
    const connectorId = requireText(input.connectorId, `${label} connector id`);
    const model = input.connectorModel;
    if (!model) {
      throw new Error(`Runtime Agent live ${label} route requires a connector model descriptor`);
    }
    return {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId,
      remoteModelCatalogId: requireText(model.remoteModelCatalogId, `${label} remote model catalog id`),
      providerModelId: requireText(model.providerModelId, `${label} provider model id`),
      provider: normalizeText(model.provider) || provider,
    };
  }
  const localAssetId = localAssetIdForCapability(capability);
  return {
    kind: 'local-runtime',
    version: 'v2',
    profileBindingId: `local-runtime:${localAssetId}`,
  };
}
