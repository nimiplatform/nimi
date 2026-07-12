import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Realm } from '../realm';
import {
  ExecutionMode,
  RoutePolicy,
  ScenarioJobStatus,
  ScenarioType,
} from '../core-generated/runtime-typed-client';
import { toRuntimeDurableTargetRef } from '../core/ai';
import { Runtime } from './index';
import { createNimiRuntimeAppSessionMetadataProvider } from './app-session';
import { withRuntimeDaemon } from './live-runtime-daemon.test-helper';
import { withNimiRuntimeAgentScopes } from './runtime-agent-protected';
import { withRealmFixtureServer } from './runtime-agent-live-e2e-fixture-realm-server.test-helper';
import {
  createFixtureImageConnector,
  createFixtureRouteProjection,
  createFixtureVoiceConnector,
  resolveFixtureImageConnectorModel,
  resolveFixtureTranscriptionConnectorModel,
  resolveFixtureVoiceConnectorModel,
  seedRuntimeAgentLiveImageCatalogProvider,
  seedRuntimeAgentLiveLocalCatalogProvider,
  seedRuntimeAgentLiveLocalRouteState,
  seedRuntimeAgentLiveVoiceCatalogProvider,
} from './runtime-agent-live-e2e-fixture-routes.test-helper';
import {
  admitDeveloperRegisteredRuntimeAccountCaller,
  admitLocalFirstPartyRuntimeAccountCaller,
  completeRuntimeAccountLogin,
  createFixtureRuntimeAgentPresentationSurface,
  createFixtureRuntimeAgentClient,
  createRuntimeForEndpoint,
  createRuntimeMediatedRealmTransport,
  desktopAccountCaller,
  logoutRuntimeAccount,
  materializeFixtureLocalAgent,
  openFixtureConversation,
  realmWorldStudioCaller,
  registerRuntimeApp,
  requireConversationAnchorId,
  sendFixtureTurn,
} from './runtime-agent-live-e2e-fixture-runtime.test-helper';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';
import {
  DESKTOP_APP_ID,
  DESKTOP_APP_INSTANCE_ID,
  DESKTOP_DEVICE_ID,
  LOCAL_TEXT_MODEL_ID,
  OWNER_USER_ID,
  REALM_STUDIO_DEVICE_ID,
  REALM_WORLD_STUDIO_APP_ID,
  REALM_WORLD_STUDIO_APP_INSTANCE_ID,
  RUNTIME_SOURCE_REF,
  RUNTIME_AUTH_JWT_AUDIENCE,
  RUNTIME_AUTH_JWT_ISSUER,
  SOURCE_REF,
  requireText,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';
import type {
  RuntimeAgentLiveE2EFixtureContext,
  RuntimeAgentLiveE2ERouteProjection,
  RuntimeAgentLiveE2EVoiceAssetProjection,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';

export type {
  RuntimeAgentLiveE2EDeveloperRegisteredAccountInput,
  RuntimeAgentLiveE2EFixtureContext,
  RuntimeAgentLiveE2ERealmRequest,
  RuntimeAgentLiveE2ERouteProjection,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PLATFORM_APP_REGISTRY_PATH = resolve(
  REPO_ROOT,
  '.nimi',
  'spec',
  'platform',
  'kernel',
  'tables',
  'nimi-app-registry.yaml',
);

export async function withRuntimeAgentLiveE2EFixture(input: {
  readonly runtimeEnv?: Readonly<Record<string, string>>;
  readonly localChatCompletionStreamDelayMs?: number;
  readonly voiceSpeechStreamDelayMs?: number;
  readonly run: (context: RuntimeAgentLiveE2EFixtureContext) => Promise<void>;
}): Promise<void> {
  await withRealmFixtureServer({
    localChatCompletionStreamDelayMs: input.localChatCompletionStreamDelayMs,
    voiceSpeechStreamDelayMs: input.voiceSpeechStreamDelayMs,
    run: async ({ baseUrl, requests, setTranscriptionFailure }) => {
      await withRuntimeDaemon({
      appId: DESKTOP_APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL: baseUrl,
        NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL: `${baseUrl}/api/auth/oauth/authorize`,
        NIMI_RUNTIME_ACCOUNT_TOKEN_URL: `${baseUrl}/api/auth/oauth/token`,
        NIMI_RUNTIME_AUTH_JWT_ISSUER: RUNTIME_AUTH_JWT_ISSUER,
        NIMI_RUNTIME_AUTH_JWT_AUDIENCE: RUNTIME_AUTH_JWT_AUDIENCE,
        NIMI_RUNTIME_AUTH_JWT_JWKS_URL: `${baseUrl}/api/auth/jwks`,
        NIMI_RUNTIME_AUTH_JWT_REVOCATION_URL: `${baseUrl}/api/auth/sessions/introspect`,
        NIMI_RUNTIME_ACCOUNT_CUSTODY_PARTITION: `sdk-runtime-agent-live-e2e-${randomUUID()}`,
        NIMI_RUNTIME_APP_REGISTRY_PATH: PLATFORM_APP_REGISTRY_PATH,
        NIMI_RUNTIME_DEFAULT_LOCAL_TEXT_MODEL: LOCAL_TEXT_MODEL_ID,
        NIMI_RUNTIME_ENGINE_LLAMA_ENABLED: '0',
        NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL: `${baseUrl}/v1`,
        NIMI_RUNTIME_ALLOW_LOOPBACK_PROVIDER_ENDPOINT: '1',
        ...(input.runtimeEnv || {}),
      },
      prepareState: ({ localStatePath, runtimeConfigPath, stateRoot }) => {
        mkdirSync(dirname(runtimeConfigPath), { recursive: true, mode: 0o700 });
        writeFileSync(runtimeConfigPath, `${JSON.stringify({
          schemaVersion: 1,
          runtimeId: `sdk-runtime-agent-live-e2e-${randomUUID()}`,
        })}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        const catalogCustomDir = resolve(stateRoot, 'model-catalog-custom');
        seedRuntimeAgentLiveLocalRouteState(localStatePath, `${baseUrl}/v1`);
        seedRuntimeAgentLiveLocalCatalogProvider(catalogCustomDir);
        seedRuntimeAgentLiveImageCatalogProvider(catalogCustomDir);
        seedRuntimeAgentLiveVoiceCatalogProvider(catalogCustomDir);
      },
      run: async ({ endpoint, localModelsPath }) => {
        const desktopCaller = desktopAccountCaller();
        const studioCaller = realmWorldStudioCaller();
        const bootstrapRuntime = createRuntimeForEndpoint(endpoint, DESKTOP_APP_ID);
        const studioRuntime = createRuntimeForEndpoint(endpoint, REALM_WORLD_STUDIO_APP_ID);

        await registerRuntimeApp(bootstrapRuntime, DESKTOP_APP_ID, DESKTOP_APP_INSTANCE_ID, DESKTOP_DEVICE_ID);
        await registerRuntimeApp(
          studioRuntime,
          REALM_WORLD_STUDIO_APP_ID,
          REALM_WORLD_STUDIO_APP_INSTANCE_ID,
          REALM_STUDIO_DEVICE_ID,
        );
        await completeRuntimeAccountLogin(bootstrapRuntime, desktopCaller);
        const runtime = bootstrapRuntime;
        const agentPresentation = createFixtureRuntimeAgentPresentationSurface(runtime);
        const realm = new Realm({
          transport: createRuntimeMediatedRealmTransport({
            runtime: studioRuntime,
            caller: studioCaller,
            realmBaseUrl: baseUrl,
          }),
        });
        const agentClient = createFixtureRuntimeAgentClient(runtime);
        const { materialization: sourceMaterialization, localAgent } = await materializeFixtureLocalAgent({
          agentClient,
          realm,
        });
        const conversation = await openFixtureConversation({
          agentClient,
          localAgent,
        });
        const conversationAnchorId = requireConversationAnchorId(conversation);
        const route = await createFixtureRouteProjection(runtime, 'text.generate');
        const embeddingRoute = await createFixtureRouteProjection(runtime, 'text.embed');
        const imageConnectorId = await createFixtureImageConnector(runtime, baseUrl);
        const imageModelDescriptor = await resolveFixtureImageConnectorModel(runtime, imageConnectorId);
        const imageRoute = await createFixtureRouteProjection(runtime, 'image.generate', {
          connectorId: imageConnectorId,
          connectorModel: imageModelDescriptor,
        });
        const transcriptionModelDescriptor = await resolveFixtureTranscriptionConnectorModel(runtime, imageConnectorId);
        const transcriptionRoute = await createFixtureRouteProjection(runtime, 'audio.transcribe', {
          connectorId: imageConnectorId,
          connectorModel: transcriptionModelDescriptor,
        });
        const voiceConnectorId = await createFixtureVoiceConnector(runtime, baseUrl);
        const voiceModelDescriptor = await resolveFixtureVoiceConnectorModel(runtime, voiceConnectorId);
        const voiceRoute = await createFixtureRouteProjection(runtime, 'audio.synthesize', {
          connectorId: voiceConnectorId,
          connectorModel: voiceModelDescriptor,
        });
        const voiceAsset = await createFixtureVoiceAsset(runtime, voiceRoute);
        try {
          await input.run({
            endpoint,
            localModelsPath,
            runtime,
            agentPresentation,
            realm,
            realmBaseUrl: baseUrl,
            realmRequests: requests,
            ownerUserId: OWNER_USER_ID,
            runtimeSourceRef: RUNTIME_SOURCE_REF,
            localAgentRef: localAgent.localAgentRef,
            localAgent,
            conversationAnchorId,
            conversation,
            route,
            embeddingRoute,
            imageRoute,
            transcriptionRoute,
            voiceRoute,
            voiceAsset,
            sourceRef: SOURCE_REF,
            sourceMaterialization,
            materializeSource: () => agentClient.materialize({
              sourceRef: SOURCE_REF,
              requestId: `runtime-agent-live-materialization:${randomUUID()}`,
              realm,
              emitRealmDataError() {},
            }),
            sendTurn: (text) => sendFixtureTurn({
              agentClient,
              localAgent,
              conversationAnchorId,
              text,
            }),
            setTranscriptionFailure,
            admitDeveloperRegisteredRuntimeAccountCaller: (accountInput) =>
              admitDeveloperRegisteredRuntimeAccountCaller(
                createRuntimeForEndpoint(endpoint, requireText(accountInput.appId, 'appId')),
                accountInput,
              ),
            admitLocalFirstPartyRuntimeAccountCaller: (accountInput) =>
              admitLocalFirstPartyRuntimeAccountCaller(
                createRuntimeForEndpoint(endpoint, requireText(accountInput.appId, 'appId')),
                accountInput,
              ),
          });
        } finally {
          await logoutRuntimeAccount(bootstrapRuntime, desktopCaller);
        }
      },
    });
    },
  });
}

async function createFixtureVoiceAsset(
  runtime: Runtime,
  voiceRoute: RuntimeAgentLiveE2ERouteProjection,
): Promise<RuntimeAgentLiveE2EVoiceAssetProjection> {
  const appSessionMetadata = await createNimiRuntimeAppSessionMetadataProvider({
    appId: DESKTOP_APP_ID,
    appInstanceId: DESKTOP_APP_INSTANCE_ID,
    deviceId: DESKTOP_DEVICE_ID,
    capabilities: ['ai.spend.meter'],
    auth: runtime.auth,
  })();
  return withNimiRuntimeAgentScopes({
    runtime: {
      appId: DESKTOP_APP_ID,
      auth: runtime.auth,
      appAuth: runtime.grants,
    },
    subjectUserId: OWNER_USER_ID,
  }, ['ai.spend.meter'], async (callOptions) => {
    const submit = await runtime.ai.submitScenarioJob({
      head: {
        appId: DESKTOP_APP_ID,
        subjectUserId: OWNER_USER_ID,
        routePolicy: RoutePolicy.CLOUD,
        modelId: voiceRoute.executionBinding.modelId,
        fallback: 0,
        timeoutMs: 60_000,
        connectorId: voiceRoute.executionBinding.connectorId ?? '',
        targetRef: toRuntimeDurableTargetRef(voiceRoute.targetRef),
      },
      scenarioType: ScenarioType.VOICE_CLONE,
      executionMode: ExecutionMode.ASYNC_JOB,
      spec: {
        spec: {
          oneofKind: 'voiceClone',
          voiceClone: {
            targetModelId: voiceRoute.executionBinding.modelId,
            input: {
              referenceAudioUri: 'https://example.invalid/nimi-runtime-live-reference.wav',
              referenceAudioMime: 'audio/wav',
              text: 'Runtime live fixture custom voice reference.',
              preferredName: 'runtime-live-voice',
            },
          },
        },
      },
    }, withNimiRuntimeIdempotencyMetadata({
      ...callOptions,
      metadata: {
        ...appSessionMetadata,
        ...(callOptions.metadata ?? {}),
      },
    }, `runtime-agent-live-e2e-voice-asset:${voiceRoute.executionBinding.modelId}`));
    const jobId = requireText(submit.job?.jobId, 'voice workflow job id');
    const assetId = requireText(submit.asset?.voiceAssetId, 'voice asset id');
    const terminalJob = await waitFixtureScenarioJobTerminal(runtime, jobId, 60_000, {
      ...callOptions,
      metadata: {
        ...appSessionMetadata,
        ...(callOptions.metadata ?? {}),
      },
    });
    if (terminalJob?.status !== ScenarioJobStatus.COMPLETED) {
      throw new Error(`Runtime live fixture VoiceAsset workflow failed: status=${terminalJob?.status} reason=${terminalJob?.reasonCode} detail=${terminalJob?.reasonDetail || ''}`);
    }
    const asset = await runtime.ai.getVoiceAsset({ voiceAssetId: assetId }, {
      ...callOptions,
      metadata: {
        ...appSessionMetadata,
        ...(callOptions.metadata ?? {}),
      },
    });
    const providerVoiceRef = requireText(asset.asset?.providerVoiceRef, 'voice asset provider voice ref');
    return {
      voiceAssetId: assetId,
      providerVoiceRef,
      defaultVoiceReference: `voice_asset_id:${assetId}`,
    };
  });
}

async function waitFixtureScenarioJobTerminal(
  runtime: Runtime,
  jobId: string,
  timeoutMs: number,
  callOptions: Parameters<Runtime['ai']['getScenarioJob']>[1],
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await runtime.ai.getScenarioJob({ jobId }, callOptions);
    const job = response.job;
    const status = job?.status ?? ScenarioJobStatus.UNSPECIFIED;
    if (
      status === ScenarioJobStatus.COMPLETED
      || status === ScenarioJobStatus.FAILED
      || status === ScenarioJobStatus.CANCELED
      || status === ScenarioJobStatus.TIMEOUT
    ) {
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(`Runtime live fixture voice workflow timed out: ${jobId}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
}
