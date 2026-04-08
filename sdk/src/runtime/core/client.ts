import { createNimiError } from '../errors.js';
import { ReasonCode } from '../../types/index.js';
import {
  RuntimeMethodIds,
} from '../method-ids.js';
import { createNodeGrpcTransport } from '../transports/node-grpc.js';
import { createTauriIpcTransport } from '../transports/tauri-ipc.js';
import type {
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeClientConfig,
  RuntimeStreamCallOptions,
  RuntimeTransport,
} from '../types.js';
import type { RuntimeClientConfigInternal } from '../types-internal.js';
import {
  RuntimeStreamMethodCodecs,
  RuntimeUnaryMethodCodecs,
} from './method-codecs.js';
import {
  decodeStreamEvent,
  decodeUnaryResponse,
  encodeRequest,
} from './client-codec.js';
import {
  ensureAppId,
  normalizeRequestForMethod,
} from './client-validation.js';
import {
  toStreamCall,
  toUnaryCall,
} from './client-auth.js';
import type {
  RuntimeStreamMethodId,
  RuntimeStreamMethodResponse,
  RuntimeStreamMethodRequest,
  RuntimeUnaryMethodId,
  RuntimeUnaryMethodResponse,
  RuntimeUnaryMethodRequest,
} from '../runtime-method-contracts.js';
import type {
  RuntimeStreamMethodCodec,
  RuntimeUnaryMethodCodec,
} from './method-codecs.js';

function createTransport(config: RuntimeClientConfigInternal): RuntimeTransport {
  if (config.transport.type === 'tauri-ipc') {
    return createTauriIpcTransport(config.transport);
  }
  return createNodeGrpcTransport(config.transport);
}

export function createRuntimeClient(input: RuntimeClientConfig): RuntimeClient {
  const config: RuntimeClientConfigInternal = {
    ...input,
    appId: ensureAppId(input.appId),
  };

  const transport = createTransport(config);

  const getUnaryCodec = <MethodId extends RuntimeUnaryMethodId>(
    methodId: MethodId,
  ): RuntimeUnaryMethodCodec<RuntimeUnaryMethodRequest<MethodId>, RuntimeUnaryMethodResponse<MethodId>> =>
    RuntimeUnaryMethodCodecs[methodId] as RuntimeUnaryMethodCodec<
      RuntimeUnaryMethodRequest<MethodId>,
      RuntimeUnaryMethodResponse<MethodId>
    >;

  const getStreamCodec = <MethodId extends RuntimeStreamMethodId>(
    methodId: MethodId,
  ): RuntimeStreamMethodCodec<
    RuntimeStreamMethodRequest<MethodId>,
    Awaited<RuntimeStreamMethodResponse<MethodId>> extends AsyncIterable<infer Event> ? Event : never
  > => RuntimeStreamMethodCodecs[methodId] as unknown as RuntimeStreamMethodCodec<
    RuntimeStreamMethodRequest<MethodId>,
    Awaited<RuntimeStreamMethodResponse<MethodId>> extends AsyncIterable<infer Event> ? Event : never
  >;

  const unary = <MethodId extends RuntimeUnaryMethodId>(methodId: MethodId) => async (
    request: RuntimeUnaryMethodRequest<MethodId>,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeUnaryMethodResponse<MethodId>> => {
    const codec = getUnaryCodec(methodId);
    if (!codec) {
      throw createNimiError({
        message: `missing unary codec for ${methodId}`,
        reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
        actionHint: 'regenerate_proto_and_update_codec_map',
        source: 'sdk',
      });
    }

    const normalizedRequest = normalizeRequestForMethod(methodId, request, options);
    const wireRequest = encodeRequest(methodId, codec, normalizedRequest);
    const call = await toUnaryCall(config, methodId, wireRequest, normalizedRequest, options);
    const wireResponse = await transport.invokeUnary(
      call,
    );
    return decodeUnaryResponse(methodId, codec, wireResponse);
  };

  const stream = <MethodId extends RuntimeStreamMethodId>(methodId: MethodId) => async (
    request: RuntimeStreamMethodRequest<MethodId>,
    options?: RuntimeStreamCallOptions,
  ): Promise<RuntimeStreamMethodResponse<MethodId>> => {
    const codec = getStreamCodec(methodId);
    if (!codec) {
      throw createNimiError({
        message: `missing stream codec for ${methodId}`,
        reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
        actionHint: 'regenerate_proto_and_update_codec_map',
        source: 'sdk',
      });
    }

    const normalizedRequest = normalizeRequestForMethod(methodId, request, options);
    const wireRequest = encodeRequest(methodId, codec, normalizedRequest);
    const call = await toStreamCall(config, methodId, wireRequest, normalizedRequest, options);
    const wireStream = await transport.openStream(
      call,
    );

    return {
      async *[Symbol.asyncIterator](): AsyncIterator<Awaited<RuntimeStreamMethodResponse<MethodId>> extends AsyncIterable<infer Event> ? Event : never> {
        for await (const eventBytes of wireStream) {
          yield decodeStreamEvent(
            methodId,
            codec,
            eventBytes,
          );
        }
      },
    } as RuntimeStreamMethodResponse<MethodId>;
  };

  return {
    appId: config.appId,
    transport: config.transport,
    auth: {
      registerApp: unary(RuntimeMethodIds.auth.registerApp),
      openSession: unary(RuntimeMethodIds.auth.openSession),
      refreshSession: unary(RuntimeMethodIds.auth.refreshSession),
      revokeSession: unary(RuntimeMethodIds.auth.revokeSession),
      registerExternalPrincipal: unary(RuntimeMethodIds.auth.registerExternalPrincipal),
      openExternalPrincipalSession: unary(RuntimeMethodIds.auth.openExternalPrincipalSession),
      revokeExternalPrincipalSession: unary(RuntimeMethodIds.auth.revokeExternalPrincipalSession),
    },
    appAuth: {
      authorizeExternalPrincipal: unary(RuntimeMethodIds.appAuth.authorizeExternalPrincipal),
      validateToken: unary(RuntimeMethodIds.appAuth.validateToken),
      revokeToken: unary(RuntimeMethodIds.appAuth.revokeToken),
      issueDelegatedToken: unary(RuntimeMethodIds.appAuth.issueDelegatedToken),
      listTokenChain: unary(RuntimeMethodIds.appAuth.listTokenChain),
    },
    ai: {
      executeScenario: unary(RuntimeMethodIds.ai.executeScenario),
      streamScenario: stream(RuntimeMethodIds.ai.streamScenario),
      submitScenarioJob: unary(RuntimeMethodIds.ai.submitScenarioJob),
      getScenarioJob: unary(RuntimeMethodIds.ai.getScenarioJob),
      cancelScenarioJob: unary(RuntimeMethodIds.ai.cancelScenarioJob),
      subscribeScenarioJobEvents: stream(RuntimeMethodIds.ai.subscribeScenarioJobEvents),
      getScenarioArtifacts: unary(RuntimeMethodIds.ai.getScenarioArtifacts),
      listScenarioProfiles: unary(RuntimeMethodIds.ai.listScenarioProfiles),
      getVoiceAsset: unary(RuntimeMethodIds.ai.getVoiceAsset),
      listVoiceAssets: unary(RuntimeMethodIds.ai.listVoiceAssets),
      deleteVoiceAsset: unary(RuntimeMethodIds.ai.deleteVoiceAsset),
      listPresetVoices: unary(RuntimeMethodIds.ai.listPresetVoices),
      openRealtimeSession: unary(RuntimeMethodIds.aiRealtime.openRealtimeSession),
      appendRealtimeInput: unary(RuntimeMethodIds.aiRealtime.appendRealtimeInput),
      readRealtimeEvents: stream(RuntimeMethodIds.aiRealtime.readRealtimeEvents),
      closeRealtimeSession: unary(RuntimeMethodIds.aiRealtime.closeRealtimeSession),
      peekScheduling: unary(RuntimeMethodIds.ai.peekScheduling),
    },
    workflow: {
      submit: unary(RuntimeMethodIds.workflow.submit),
      get: unary(RuntimeMethodIds.workflow.get),
      cancel: unary(RuntimeMethodIds.workflow.cancel),
      subscribeEvents: stream(RuntimeMethodIds.workflow.subscribeEvents),
    },
    model: {
      list: unary(RuntimeMethodIds.model.list),
      pull: unary(RuntimeMethodIds.model.pull),
      remove: unary(RuntimeMethodIds.model.remove),
      checkHealth: unary(RuntimeMethodIds.model.checkHealth),
    },
    local: {
      listLocalAssets: unary(RuntimeMethodIds.local.listLocalAssets),
      listVerifiedAssets: unary(RuntimeMethodIds.local.listVerifiedAssets),
      searchCatalogModels: unary(RuntimeMethodIds.local.searchCatalogModels),
      resolveModelInstallPlan: unary(RuntimeMethodIds.local.resolveModelInstallPlan),
      installVerifiedAsset: unary(RuntimeMethodIds.local.installVerifiedAsset),
      importLocalAsset: unary(RuntimeMethodIds.local.importLocalAsset),
      importLocalAssetFile: unary(RuntimeMethodIds.local.importLocalAssetFile),
      scanUnregisteredAssets: unary(RuntimeMethodIds.local.scanUnregisteredAssets),
      scaffoldOrphanAsset: unary(RuntimeMethodIds.local.scaffoldOrphanAsset),
      removeLocalAsset: unary(RuntimeMethodIds.local.removeLocalAsset),
      startLocalAsset: unary(RuntimeMethodIds.local.startLocalAsset),
      stopLocalAsset: unary(RuntimeMethodIds.local.stopLocalAsset),
      checkLocalAssetHealth: unary(RuntimeMethodIds.local.checkLocalAssetHealth),
      warmLocalAsset: unary(RuntimeMethodIds.local.warmLocalAsset),
      listLocalTransfers: unary(RuntimeMethodIds.local.listLocalTransfers),
      pauseLocalTransfer: unary(RuntimeMethodIds.local.pauseLocalTransfer),
      resumeLocalTransfer: unary(RuntimeMethodIds.local.resumeLocalTransfer),
      cancelLocalTransfer: unary(RuntimeMethodIds.local.cancelLocalTransfer),
      watchLocalTransfers: stream(RuntimeMethodIds.local.watchLocalTransfers),
      collectDeviceProfile: unary(RuntimeMethodIds.local.collectDeviceProfile),
      resolveProfile: unary(RuntimeMethodIds.local.resolveProfile),
      applyProfile: unary(RuntimeMethodIds.local.applyProfile),
      listLocalServices: unary(RuntimeMethodIds.local.listLocalServices),
      installLocalService: unary(RuntimeMethodIds.local.installLocalService),
      startLocalService: unary(RuntimeMethodIds.local.startLocalService),
      stopLocalService: unary(RuntimeMethodIds.local.stopLocalService),
      checkLocalServiceHealth: unary(RuntimeMethodIds.local.checkLocalServiceHealth),
      removeLocalService: unary(RuntimeMethodIds.local.removeLocalService),
      listNodeCatalog: unary(RuntimeMethodIds.local.listNodeCatalog),
      listLocalAudits: unary(RuntimeMethodIds.local.listLocalAudits),
      appendInferenceAudit: unary(RuntimeMethodIds.local.appendInferenceAudit),
      appendRuntimeAudit: unary(RuntimeMethodIds.local.appendRuntimeAudit),
      listEngines: unary(RuntimeMethodIds.local.listEngines),
      ensureEngine: unary(RuntimeMethodIds.local.ensureEngine),
      startEngine: unary(RuntimeMethodIds.local.startEngine),
      stopEngine: unary(RuntimeMethodIds.local.stopEngine),
      getEngineStatus: unary(RuntimeMethodIds.local.getEngineStatus),
    },
    connector: {
      createConnector: unary(RuntimeMethodIds.connector.createConnector),
      getConnector: unary(RuntimeMethodIds.connector.getConnector),
      listConnectors: unary(RuntimeMethodIds.connector.listConnectors),
      updateConnector: unary(RuntimeMethodIds.connector.updateConnector),
      deleteConnector: unary(RuntimeMethodIds.connector.deleteConnector),
      testConnector: unary(RuntimeMethodIds.connector.testConnector),
      listConnectorModels: unary(RuntimeMethodIds.connector.listConnectorModels),
      listProviderCatalog: unary(RuntimeMethodIds.connector.listProviderCatalog),
      listModelCatalogProviders: unary(RuntimeMethodIds.connector.listModelCatalogProviders),
      listCatalogProviderModels: unary(RuntimeMethodIds.connector.listCatalogProviderModels),
      getCatalogModelDetail: unary(RuntimeMethodIds.connector.getCatalogModelDetail),
      upsertModelCatalogProvider: unary(RuntimeMethodIds.connector.upsertModelCatalogProvider),
      deleteModelCatalogProvider: unary(RuntimeMethodIds.connector.deleteModelCatalogProvider),
      upsertCatalogModelOverlay: unary(RuntimeMethodIds.connector.upsertCatalogModelOverlay),
      deleteCatalogModelOverlay: unary(RuntimeMethodIds.connector.deleteCatalogModelOverlay),
    },
    knowledge: {
      buildIndex: unary(RuntimeMethodIds.knowledge.buildIndex),
      searchIndex: unary(RuntimeMethodIds.knowledge.searchIndex),
      deleteIndex: unary(RuntimeMethodIds.knowledge.deleteIndex),
    },
    app: {
      sendAppMessage: unary(RuntimeMethodIds.app.sendAppMessage),
      subscribeAppMessages: stream(RuntimeMethodIds.app.subscribeAppMessages),
    },
    audit: {
      listAuditEvents: unary(RuntimeMethodIds.audit.listAuditEvents),
      exportAuditEvents: stream(RuntimeMethodIds.audit.exportAuditEvents),
      listUsageStats: unary(RuntimeMethodIds.audit.listUsageStats),
      getRuntimeHealth: unary(RuntimeMethodIds.audit.getRuntimeHealth),
      listAIProviderHealth: unary(RuntimeMethodIds.audit.listAIProviderHealth),
      subscribeAIProviderHealthEvents: stream(RuntimeMethodIds.audit.subscribeAIProviderHealthEvents),
      subscribeRuntimeHealthEvents: stream(RuntimeMethodIds.audit.subscribeRuntimeHealthEvents),
    },
    closeStream: async (streamId: string) => {
      await transport.closeStream({ streamId });
    },
    close: async () => {
      await transport.destroy();
    },
  };
}
