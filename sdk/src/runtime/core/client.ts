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
import {
  RuntimeStreamMethodCodecs,
  RuntimeUnaryMethodCodecs,
  type RuntimeStreamMethodCodec,
  type RuntimeUnaryMethodCodec,
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

function createTransport(config: RuntimeClientConfig): RuntimeTransport {
  if (config.transport.type === 'tauri-ipc') {
    return createTauriIpcTransport(config.transport);
  }
  return createNodeGrpcTransport(config.transport);
}

export function createRuntimeClient(input: RuntimeClientConfig): RuntimeClient {
  const config: RuntimeClientConfig = {
    ...input,
    appId: ensureAppId(input.appId),
  };

  const transport = createTransport(config);

  const unary = <Request, Response>(methodId: string) => async (
    request: Request,
    options?: RuntimeCallOptions,
  ): Promise<Response> => {
    const codec = RuntimeUnaryMethodCodecs[methodId as keyof typeof RuntimeUnaryMethodCodecs] as unknown as
      | RuntimeUnaryMethodCodec<Request, Response>
      | undefined;
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
    return decodeUnaryResponse(methodId, codec as RuntimeUnaryMethodCodec<unknown, Response>, wireResponse);
  };

  const stream = <Request, Event>(methodId: string) => async (
    request: Request,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<Event>> => {
    const codec = RuntimeStreamMethodCodecs[methodId as keyof typeof RuntimeStreamMethodCodecs] as unknown as
      | RuntimeStreamMethodCodec<Request, Event>
      | undefined;
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
      async *[Symbol.asyncIterator](): AsyncIterator<Event> {
        for await (const eventBytes of wireStream) {
          yield decodeStreamEvent(
            methodId,
            codec as RuntimeStreamMethodCodec<unknown, Event>,
            eventBytes,
          );
        }
      },
    };
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
    localRuntime: {
      listLocalModels: unary(RuntimeMethodIds.localRuntime.listLocalModels),
      listLocalArtifacts: unary(RuntimeMethodIds.localRuntime.listLocalArtifacts),
      listVerifiedModels: unary(RuntimeMethodIds.localRuntime.listVerifiedModels),
      listVerifiedArtifacts: unary(RuntimeMethodIds.localRuntime.listVerifiedArtifacts),
      searchCatalogModels: unary(RuntimeMethodIds.localRuntime.searchCatalogModels),
      resolveModelInstallPlan: unary(RuntimeMethodIds.localRuntime.resolveModelInstallPlan),
      installLocalModel: unary(RuntimeMethodIds.localRuntime.installLocalModel),
      installVerifiedModel: unary(RuntimeMethodIds.localRuntime.installVerifiedModel),
      installVerifiedArtifact: unary(RuntimeMethodIds.localRuntime.installVerifiedArtifact),
      importLocalModel: unary(RuntimeMethodIds.localRuntime.importLocalModel),
      importLocalArtifact: unary(RuntimeMethodIds.localRuntime.importLocalArtifact),
      removeLocalModel: unary(RuntimeMethodIds.localRuntime.removeLocalModel),
      removeLocalArtifact: unary(RuntimeMethodIds.localRuntime.removeLocalArtifact),
      startLocalModel: unary(RuntimeMethodIds.localRuntime.startLocalModel),
      stopLocalModel: unary(RuntimeMethodIds.localRuntime.stopLocalModel),
      checkLocalModelHealth: unary(RuntimeMethodIds.localRuntime.checkLocalModelHealth),
      warmLocalModel: unary(RuntimeMethodIds.localRuntime.warmLocalModel),
      collectDeviceProfile: unary(RuntimeMethodIds.localRuntime.collectDeviceProfile),
      resolveDependencies: unary(RuntimeMethodIds.localRuntime.resolveDependencies),
      applyDependencies: unary(RuntimeMethodIds.localRuntime.applyDependencies),
      listLocalServices: unary(RuntimeMethodIds.localRuntime.listLocalServices),
      installLocalService: unary(RuntimeMethodIds.localRuntime.installLocalService),
      startLocalService: unary(RuntimeMethodIds.localRuntime.startLocalService),
      stopLocalService: unary(RuntimeMethodIds.localRuntime.stopLocalService),
      checkLocalServiceHealth: unary(RuntimeMethodIds.localRuntime.checkLocalServiceHealth),
      removeLocalService: unary(RuntimeMethodIds.localRuntime.removeLocalService),
      listNodeCatalog: unary(RuntimeMethodIds.localRuntime.listNodeCatalog),
      listLocalAudits: unary(RuntimeMethodIds.localRuntime.listLocalAudits),
      appendInferenceAudit: unary(RuntimeMethodIds.localRuntime.appendInferenceAudit),
      appendRuntimeAudit: unary(RuntimeMethodIds.localRuntime.appendRuntimeAudit),
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
      upsertModelCatalogProvider: unary(RuntimeMethodIds.connector.upsertModelCatalogProvider),
      deleteModelCatalogProvider: unary(RuntimeMethodIds.connector.deleteModelCatalogProvider),
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
    scriptWorker: {
      execute: unary(RuntimeMethodIds.scriptWorker.execute),
    },
    closeStream: async (streamId: string) => {
      await transport.closeStream({ streamId });
    },
  };
}
