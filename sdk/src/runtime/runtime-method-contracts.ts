import { RuntimeMethodIds } from './method-ids.js';
import type { RuntimeClient } from './types-client-interfaces.js';

type RuntimeClientModuleKey = Extract<
  keyof RuntimeClient,
  'auth' | 'appAuth' | 'ai' | 'workflow' | 'model' | 'local' | 'connector' | 'knowledge' | 'memory' | 'agentCore' | 'app' | 'audit'
>;

type RuntimeClientMethodContract<
  Module extends RuntimeClientModuleKey,
  Method extends keyof RuntimeClient[Module],
> = RuntimeClient[Module][Method] extends (
  request: infer Request,
  options?: infer _Options,
) => Promise<infer Response>
  ? { request: Request; response: Response }
  : never;

export type RuntimeUnaryMethodContractMap = {
  [RuntimeMethodIds.auth.registerApp]: RuntimeClientMethodContract<'auth', 'registerApp'>;
  [RuntimeMethodIds.auth.openSession]: RuntimeClientMethodContract<'auth', 'openSession'>;
  [RuntimeMethodIds.auth.refreshSession]: RuntimeClientMethodContract<'auth', 'refreshSession'>;
  [RuntimeMethodIds.auth.revokeSession]: RuntimeClientMethodContract<'auth', 'revokeSession'>;
  [RuntimeMethodIds.auth.registerExternalPrincipal]: RuntimeClientMethodContract<'auth', 'registerExternalPrincipal'>;
  [RuntimeMethodIds.auth.openExternalPrincipalSession]: RuntimeClientMethodContract<'auth', 'openExternalPrincipalSession'>;
  [RuntimeMethodIds.auth.revokeExternalPrincipalSession]: RuntimeClientMethodContract<'auth', 'revokeExternalPrincipalSession'>;
  [RuntimeMethodIds.appAuth.authorizeExternalPrincipal]: RuntimeClientMethodContract<'appAuth', 'authorizeExternalPrincipal'>;
  [RuntimeMethodIds.appAuth.validateToken]: RuntimeClientMethodContract<'appAuth', 'validateToken'>;
  [RuntimeMethodIds.appAuth.revokeToken]: RuntimeClientMethodContract<'appAuth', 'revokeToken'>;
  [RuntimeMethodIds.appAuth.issueDelegatedToken]: RuntimeClientMethodContract<'appAuth', 'issueDelegatedToken'>;
  [RuntimeMethodIds.appAuth.listTokenChain]: RuntimeClientMethodContract<'appAuth', 'listTokenChain'>;
  [RuntimeMethodIds.ai.executeScenario]: RuntimeClientMethodContract<'ai', 'executeScenario'>;
  [RuntimeMethodIds.ai.submitScenarioJob]: RuntimeClientMethodContract<'ai', 'submitScenarioJob'>;
  [RuntimeMethodIds.ai.getScenarioJob]: RuntimeClientMethodContract<'ai', 'getScenarioJob'>;
  [RuntimeMethodIds.ai.cancelScenarioJob]: RuntimeClientMethodContract<'ai', 'cancelScenarioJob'>;
  [RuntimeMethodIds.ai.getScenarioArtifacts]: RuntimeClientMethodContract<'ai', 'getScenarioArtifacts'>;
  [RuntimeMethodIds.ai.listScenarioProfiles]: RuntimeClientMethodContract<'ai', 'listScenarioProfiles'>;
  [RuntimeMethodIds.ai.getVoiceAsset]: RuntimeClientMethodContract<'ai', 'getVoiceAsset'>;
  [RuntimeMethodIds.ai.listVoiceAssets]: RuntimeClientMethodContract<'ai', 'listVoiceAssets'>;
  [RuntimeMethodIds.ai.deleteVoiceAsset]: RuntimeClientMethodContract<'ai', 'deleteVoiceAsset'>;
  [RuntimeMethodIds.ai.listPresetVoices]: RuntimeClientMethodContract<'ai', 'listPresetVoices'>;
  [RuntimeMethodIds.ai.peekScheduling]: RuntimeClientMethodContract<'ai', 'peekScheduling'>;
  [RuntimeMethodIds.aiRealtime.openRealtimeSession]: RuntimeClientMethodContract<'ai', 'openRealtimeSession'>;
  [RuntimeMethodIds.aiRealtime.appendRealtimeInput]: RuntimeClientMethodContract<'ai', 'appendRealtimeInput'>;
  [RuntimeMethodIds.aiRealtime.closeRealtimeSession]: RuntimeClientMethodContract<'ai', 'closeRealtimeSession'>;
  [RuntimeMethodIds.workflow.submit]: RuntimeClientMethodContract<'workflow', 'submit'>;
  [RuntimeMethodIds.workflow.get]: RuntimeClientMethodContract<'workflow', 'get'>;
  [RuntimeMethodIds.workflow.cancel]: RuntimeClientMethodContract<'workflow', 'cancel'>;
  [RuntimeMethodIds.model.list]: RuntimeClientMethodContract<'model', 'list'>;
  [RuntimeMethodIds.model.pull]: RuntimeClientMethodContract<'model', 'pull'>;
  [RuntimeMethodIds.model.remove]: RuntimeClientMethodContract<'model', 'remove'>;
  [RuntimeMethodIds.model.checkHealth]: RuntimeClientMethodContract<'model', 'checkHealth'>;
  [RuntimeMethodIds.local.listLocalAssets]: RuntimeClientMethodContract<'local', 'listLocalAssets'>;
  [RuntimeMethodIds.local.listVerifiedAssets]: RuntimeClientMethodContract<'local', 'listVerifiedAssets'>;
  [RuntimeMethodIds.local.searchCatalogModels]: RuntimeClientMethodContract<'local', 'searchCatalogModels'>;
  [RuntimeMethodIds.local.resolveModelInstallPlan]: RuntimeClientMethodContract<'local', 'resolveModelInstallPlan'>;
  [RuntimeMethodIds.local.installVerifiedAsset]: RuntimeClientMethodContract<'local', 'installVerifiedAsset'>;
  [RuntimeMethodIds.local.importLocalAsset]: RuntimeClientMethodContract<'local', 'importLocalAsset'>;
  [RuntimeMethodIds.local.importLocalAssetFile]: RuntimeClientMethodContract<'local', 'importLocalAssetFile'>;
  [RuntimeMethodIds.local.scanUnregisteredAssets]: RuntimeClientMethodContract<'local', 'scanUnregisteredAssets'>;
  [RuntimeMethodIds.local.scaffoldOrphanAsset]: RuntimeClientMethodContract<'local', 'scaffoldOrphanAsset'>;
  [RuntimeMethodIds.local.removeLocalAsset]: RuntimeClientMethodContract<'local', 'removeLocalAsset'>;
  [RuntimeMethodIds.local.startLocalAsset]: RuntimeClientMethodContract<'local', 'startLocalAsset'>;
  [RuntimeMethodIds.local.stopLocalAsset]: RuntimeClientMethodContract<'local', 'stopLocalAsset'>;
  [RuntimeMethodIds.local.checkLocalAssetHealth]: RuntimeClientMethodContract<'local', 'checkLocalAssetHealth'>;
  [RuntimeMethodIds.local.warmLocalAsset]: RuntimeClientMethodContract<'local', 'warmLocalAsset'>;
  [RuntimeMethodIds.local.collectDeviceProfile]: RuntimeClientMethodContract<'local', 'collectDeviceProfile'>;
  [RuntimeMethodIds.local.resolveProfile]: RuntimeClientMethodContract<'local', 'resolveProfile'>;
  [RuntimeMethodIds.local.applyProfile]: RuntimeClientMethodContract<'local', 'applyProfile'>;
  [RuntimeMethodIds.local.listLocalServices]: RuntimeClientMethodContract<'local', 'listLocalServices'>;
  [RuntimeMethodIds.local.installLocalService]: RuntimeClientMethodContract<'local', 'installLocalService'>;
  [RuntimeMethodIds.local.startLocalService]: RuntimeClientMethodContract<'local', 'startLocalService'>;
  [RuntimeMethodIds.local.stopLocalService]: RuntimeClientMethodContract<'local', 'stopLocalService'>;
  [RuntimeMethodIds.local.checkLocalServiceHealth]: RuntimeClientMethodContract<'local', 'checkLocalServiceHealth'>;
  [RuntimeMethodIds.local.removeLocalService]: RuntimeClientMethodContract<'local', 'removeLocalService'>;
  [RuntimeMethodIds.local.listNodeCatalog]: RuntimeClientMethodContract<'local', 'listNodeCatalog'>;
  [RuntimeMethodIds.local.listLocalAudits]: RuntimeClientMethodContract<'local', 'listLocalAudits'>;
  [RuntimeMethodIds.local.appendInferenceAudit]: RuntimeClientMethodContract<'local', 'appendInferenceAudit'>;
  [RuntimeMethodIds.local.appendRuntimeAudit]: RuntimeClientMethodContract<'local', 'appendRuntimeAudit'>;
  [RuntimeMethodIds.local.listEngines]: RuntimeClientMethodContract<'local', 'listEngines'>;
  [RuntimeMethodIds.local.ensureEngine]: RuntimeClientMethodContract<'local', 'ensureEngine'>;
  [RuntimeMethodIds.local.startEngine]: RuntimeClientMethodContract<'local', 'startEngine'>;
  [RuntimeMethodIds.local.stopEngine]: RuntimeClientMethodContract<'local', 'stopEngine'>;
  [RuntimeMethodIds.local.getEngineStatus]: RuntimeClientMethodContract<'local', 'getEngineStatus'>;
  [RuntimeMethodIds.connector.createConnector]: RuntimeClientMethodContract<'connector', 'createConnector'>;
  [RuntimeMethodIds.connector.getConnector]: RuntimeClientMethodContract<'connector', 'getConnector'>;
  [RuntimeMethodIds.connector.listConnectors]: RuntimeClientMethodContract<'connector', 'listConnectors'>;
  [RuntimeMethodIds.connector.updateConnector]: RuntimeClientMethodContract<'connector', 'updateConnector'>;
  [RuntimeMethodIds.connector.deleteConnector]: RuntimeClientMethodContract<'connector', 'deleteConnector'>;
  [RuntimeMethodIds.connector.testConnector]: RuntimeClientMethodContract<'connector', 'testConnector'>;
  [RuntimeMethodIds.connector.listConnectorModels]: RuntimeClientMethodContract<'connector', 'listConnectorModels'>;
  [RuntimeMethodIds.connector.listProviderCatalog]: RuntimeClientMethodContract<'connector', 'listProviderCatalog'>;
  [RuntimeMethodIds.connector.listModelCatalogProviders]: RuntimeClientMethodContract<'connector', 'listModelCatalogProviders'>;
  [RuntimeMethodIds.connector.listCatalogProviderModels]: RuntimeClientMethodContract<'connector', 'listCatalogProviderModels'>;
  [RuntimeMethodIds.connector.getCatalogModelDetail]: RuntimeClientMethodContract<'connector', 'getCatalogModelDetail'>;
  [RuntimeMethodIds.connector.upsertModelCatalogProvider]: RuntimeClientMethodContract<'connector', 'upsertModelCatalogProvider'>;
  [RuntimeMethodIds.connector.deleteModelCatalogProvider]: RuntimeClientMethodContract<'connector', 'deleteModelCatalogProvider'>;
  [RuntimeMethodIds.connector.upsertCatalogModelOverlay]: RuntimeClientMethodContract<'connector', 'upsertCatalogModelOverlay'>;
  [RuntimeMethodIds.connector.deleteCatalogModelOverlay]: RuntimeClientMethodContract<'connector', 'deleteCatalogModelOverlay'>;
  [RuntimeMethodIds.knowledge.createKnowledgeBank]: RuntimeClientMethodContract<'knowledge', 'createKnowledgeBank'>;
  [RuntimeMethodIds.knowledge.getKnowledgeBank]: RuntimeClientMethodContract<'knowledge', 'getKnowledgeBank'>;
  [RuntimeMethodIds.knowledge.listKnowledgeBanks]: RuntimeClientMethodContract<'knowledge', 'listKnowledgeBanks'>;
  [RuntimeMethodIds.knowledge.deleteKnowledgeBank]: RuntimeClientMethodContract<'knowledge', 'deleteKnowledgeBank'>;
  [RuntimeMethodIds.knowledge.putPage]: RuntimeClientMethodContract<'knowledge', 'putPage'>;
  [RuntimeMethodIds.knowledge.getPage]: RuntimeClientMethodContract<'knowledge', 'getPage'>;
  [RuntimeMethodIds.knowledge.listPages]: RuntimeClientMethodContract<'knowledge', 'listPages'>;
  [RuntimeMethodIds.knowledge.deletePage]: RuntimeClientMethodContract<'knowledge', 'deletePage'>;
  [RuntimeMethodIds.knowledge.searchKeyword]: RuntimeClientMethodContract<'knowledge', 'searchKeyword'>;
  [RuntimeMethodIds.knowledge.searchHybrid]: RuntimeClientMethodContract<'knowledge', 'searchHybrid'>;
  [RuntimeMethodIds.knowledge.addLink]: RuntimeClientMethodContract<'knowledge', 'addLink'>;
  [RuntimeMethodIds.knowledge.removeLink]: RuntimeClientMethodContract<'knowledge', 'removeLink'>;
  [RuntimeMethodIds.knowledge.listLinks]: RuntimeClientMethodContract<'knowledge', 'listLinks'>;
  [RuntimeMethodIds.knowledge.listBacklinks]: RuntimeClientMethodContract<'knowledge', 'listBacklinks'>;
  [RuntimeMethodIds.knowledge.traverseGraph]: RuntimeClientMethodContract<'knowledge', 'traverseGraph'>;
  [RuntimeMethodIds.knowledge.ingestDocument]: RuntimeClientMethodContract<'knowledge', 'ingestDocument'>;
  [RuntimeMethodIds.knowledge.getIngestTask]: RuntimeClientMethodContract<'knowledge', 'getIngestTask'>;
  [RuntimeMethodIds.memory.createBank]: RuntimeClientMethodContract<'memory', 'createBank'>;
  [RuntimeMethodIds.memory.getBank]: RuntimeClientMethodContract<'memory', 'getBank'>;
  [RuntimeMethodIds.memory.listBanks]: RuntimeClientMethodContract<'memory', 'listBanks'>;
  [RuntimeMethodIds.memory.deleteBank]: RuntimeClientMethodContract<'memory', 'deleteBank'>;
  [RuntimeMethodIds.memory.retain]: RuntimeClientMethodContract<'memory', 'retain'>;
  [RuntimeMethodIds.memory.recall]: RuntimeClientMethodContract<'memory', 'recall'>;
  [RuntimeMethodIds.memory.history]: RuntimeClientMethodContract<'memory', 'history'>;
  [RuntimeMethodIds.memory.deleteMemory]: RuntimeClientMethodContract<'memory', 'deleteMemory'>;
  [RuntimeMethodIds.agentCore.initializeAgent]: RuntimeClientMethodContract<'agentCore', 'initializeAgent'>;
  [RuntimeMethodIds.agentCore.terminateAgent]: RuntimeClientMethodContract<'agentCore', 'terminateAgent'>;
  [RuntimeMethodIds.agentCore.getAgent]: RuntimeClientMethodContract<'agentCore', 'getAgent'>;
  [RuntimeMethodIds.agentCore.listAgents]: RuntimeClientMethodContract<'agentCore', 'listAgents'>;
  [RuntimeMethodIds.agentCore.getAgentState]: RuntimeClientMethodContract<'agentCore', 'getAgentState'>;
  [RuntimeMethodIds.agentCore.updateAgentState]: RuntimeClientMethodContract<'agentCore', 'updateAgentState'>;
  [RuntimeMethodIds.agentCore.enableAutonomy]: RuntimeClientMethodContract<'agentCore', 'enableAutonomy'>;
  [RuntimeMethodIds.agentCore.disableAutonomy]: RuntimeClientMethodContract<'agentCore', 'disableAutonomy'>;
  [RuntimeMethodIds.agentCore.setAutonomyConfig]: RuntimeClientMethodContract<'agentCore', 'setAutonomyConfig'>;
  [RuntimeMethodIds.agentCore.listPendingHooks]: RuntimeClientMethodContract<'agentCore', 'listPendingHooks'>;
  [RuntimeMethodIds.agentCore.cancelHook]: RuntimeClientMethodContract<'agentCore', 'cancelHook'>;
  [RuntimeMethodIds.agentCore.queryMemory]: RuntimeClientMethodContract<'agentCore', 'queryMemory'>;
  [RuntimeMethodIds.agentCore.writeMemory]: RuntimeClientMethodContract<'agentCore', 'writeMemory'>;
  [RuntimeMethodIds.app.sendAppMessage]: RuntimeClientMethodContract<'app', 'sendAppMessage'>;
  [RuntimeMethodIds.audit.listAuditEvents]: RuntimeClientMethodContract<'audit', 'listAuditEvents'>;
  [RuntimeMethodIds.audit.listUsageStats]: RuntimeClientMethodContract<'audit', 'listUsageStats'>;
  [RuntimeMethodIds.audit.getRuntimeHealth]: RuntimeClientMethodContract<'audit', 'getRuntimeHealth'>;
  [RuntimeMethodIds.audit.listAIProviderHealth]: RuntimeClientMethodContract<'audit', 'listAIProviderHealth'>;
  [RuntimeMethodIds.local.listLocalTransfers]: RuntimeClientMethodContract<'local', 'listLocalTransfers'>;
  [RuntimeMethodIds.local.pauseLocalTransfer]: RuntimeClientMethodContract<'local', 'pauseLocalTransfer'>;
  [RuntimeMethodIds.local.resumeLocalTransfer]: RuntimeClientMethodContract<'local', 'resumeLocalTransfer'>;
  [RuntimeMethodIds.local.cancelLocalTransfer]: RuntimeClientMethodContract<'local', 'cancelLocalTransfer'>;
};

export type RuntimeStreamMethodContractMap = {
  [RuntimeMethodIds.ai.streamScenario]: RuntimeClientMethodContract<'ai', 'streamScenario'>;
  [RuntimeMethodIds.ai.subscribeScenarioJobEvents]: RuntimeClientMethodContract<'ai', 'subscribeScenarioJobEvents'>;
  [RuntimeMethodIds.aiRealtime.readRealtimeEvents]: RuntimeClientMethodContract<'ai', 'readRealtimeEvents'>;
  [RuntimeMethodIds.workflow.subscribeEvents]: RuntimeClientMethodContract<'workflow', 'subscribeEvents'>;
  [RuntimeMethodIds.local.watchLocalTransfers]: RuntimeClientMethodContract<'local', 'watchLocalTransfers'>;
  [RuntimeMethodIds.memory.subscribeEvents]: RuntimeClientMethodContract<'memory', 'subscribeEvents'>;
  [RuntimeMethodIds.agentCore.subscribeEvents]: RuntimeClientMethodContract<'agentCore', 'subscribeEvents'>;
  [RuntimeMethodIds.app.subscribeAppMessages]: RuntimeClientMethodContract<'app', 'subscribeAppMessages'>;
  [RuntimeMethodIds.audit.exportAuditEvents]: RuntimeClientMethodContract<'audit', 'exportAuditEvents'>;
  [RuntimeMethodIds.audit.subscribeAIProviderHealthEvents]: RuntimeClientMethodContract<'audit', 'subscribeAIProviderHealthEvents'>;
  [RuntimeMethodIds.audit.subscribeRuntimeHealthEvents]: RuntimeClientMethodContract<'audit', 'subscribeRuntimeHealthEvents'>;
};

type RuntimeExplicitUnaryMethodIds =
  | typeof RuntimeMethodIds.local.importLocalAssetFile
  | typeof RuntimeMethodIds.local.scanUnregisteredAssets
  | typeof RuntimeMethodIds.local.scaffoldOrphanAsset
  | typeof RuntimeMethodIds.local.listLocalTransfers
  | typeof RuntimeMethodIds.local.pauseLocalTransfer
  | typeof RuntimeMethodIds.local.resumeLocalTransfer
  | typeof RuntimeMethodIds.local.cancelLocalTransfer;

export type RuntimeUnaryMethodId = (keyof RuntimeUnaryMethodContractMap | RuntimeExplicitUnaryMethodIds) & string;
export type RuntimeStreamMethodId = keyof RuntimeStreamMethodContractMap & string;
export type RuntimeMethodId = RuntimeUnaryMethodId | RuntimeStreamMethodId;
export type RuntimeMethodContractMap = RuntimeUnaryMethodContractMap & RuntimeStreamMethodContractMap;

export type RuntimeUnaryMethodRequest<MethodId extends RuntimeUnaryMethodId> =
  RuntimeUnaryMethodContractMap[MethodId]['request'];

export type RuntimeUnaryMethodResponse<MethodId extends RuntimeUnaryMethodId> =
  RuntimeUnaryMethodContractMap[MethodId]['response'];

export type RuntimeStreamMethodRequest<MethodId extends RuntimeStreamMethodId> =
  RuntimeStreamMethodContractMap[MethodId]['request'];

export type RuntimeStreamMethodResponse<MethodId extends RuntimeStreamMethodId> =
  RuntimeStreamMethodContractMap[MethodId]['response'];

export type RuntimeMethodRequest<MethodId extends RuntimeMethodId> =
  RuntimeMethodContractMap[MethodId]['request'];

export type RuntimeMethodResponse<MethodId extends RuntimeMethodId> =
  RuntimeMethodContractMap[MethodId]['response'];
