import { RuntimeMethodIds } from './method-ids.js';
import type { RuntimeClient } from './types-client-interfaces.js';

type RuntimeClientModuleKey = Extract<
  keyof RuntimeClient,
  'auth' | 'appAuth' | 'ai' | 'workflow' | 'model' | 'local' | 'connector' | 'knowledge' | 'app' | 'audit'
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
  [RuntimeMethodIds.local.listLocalModels]: RuntimeClientMethodContract<'local', 'listLocalModels'>;
  [RuntimeMethodIds.local.listLocalArtifacts]: RuntimeClientMethodContract<'local', 'listLocalArtifacts'>;
  [RuntimeMethodIds.local.listVerifiedModels]: RuntimeClientMethodContract<'local', 'listVerifiedModels'>;
  [RuntimeMethodIds.local.listVerifiedArtifacts]: RuntimeClientMethodContract<'local', 'listVerifiedArtifacts'>;
  [RuntimeMethodIds.local.searchCatalogModels]: RuntimeClientMethodContract<'local', 'searchCatalogModels'>;
  [RuntimeMethodIds.local.resolveModelInstallPlan]: RuntimeClientMethodContract<'local', 'resolveModelInstallPlan'>;
  [RuntimeMethodIds.local.installLocalModel]: RuntimeClientMethodContract<'local', 'installLocalModel'>;
  [RuntimeMethodIds.local.installVerifiedModel]: RuntimeClientMethodContract<'local', 'installVerifiedModel'>;
  [RuntimeMethodIds.local.installVerifiedArtifact]: RuntimeClientMethodContract<'local', 'installVerifiedArtifact'>;
  [RuntimeMethodIds.local.importLocalModel]: RuntimeClientMethodContract<'local', 'importLocalModel'>;
  [RuntimeMethodIds.local.importLocalArtifact]: RuntimeClientMethodContract<'local', 'importLocalArtifact'>;
  [RuntimeMethodIds.local.importLocalModelFile]: RuntimeClientMethodContract<'local', 'importLocalModelFile'>;
  [RuntimeMethodIds.local.importLocalArtifactFile]: RuntimeClientMethodContract<'local', 'importLocalArtifactFile'>;
  [RuntimeMethodIds.local.scanUnregisteredAssets]: RuntimeClientMethodContract<'local', 'scanUnregisteredAssets'>;
  [RuntimeMethodIds.local.scaffoldOrphanModel]: RuntimeClientMethodContract<'local', 'scaffoldOrphanModel'>;
  [RuntimeMethodIds.local.scaffoldOrphanArtifact]: RuntimeClientMethodContract<'local', 'scaffoldOrphanArtifact'>;
  [RuntimeMethodIds.local.removeLocalModel]: RuntimeClientMethodContract<'local', 'removeLocalModel'>;
  [RuntimeMethodIds.local.removeLocalArtifact]: RuntimeClientMethodContract<'local', 'removeLocalArtifact'>;
  [RuntimeMethodIds.local.startLocalModel]: RuntimeClientMethodContract<'local', 'startLocalModel'>;
  [RuntimeMethodIds.local.stopLocalModel]: RuntimeClientMethodContract<'local', 'stopLocalModel'>;
  [RuntimeMethodIds.local.checkLocalModelHealth]: RuntimeClientMethodContract<'local', 'checkLocalModelHealth'>;
  [RuntimeMethodIds.local.warmLocalModel]: RuntimeClientMethodContract<'local', 'warmLocalModel'>;
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
  [RuntimeMethodIds.knowledge.buildIndex]: RuntimeClientMethodContract<'knowledge', 'buildIndex'>;
  [RuntimeMethodIds.knowledge.searchIndex]: RuntimeClientMethodContract<'knowledge', 'searchIndex'>;
  [RuntimeMethodIds.knowledge.deleteIndex]: RuntimeClientMethodContract<'knowledge', 'deleteIndex'>;
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
  [RuntimeMethodIds.app.subscribeAppMessages]: RuntimeClientMethodContract<'app', 'subscribeAppMessages'>;
  [RuntimeMethodIds.audit.exportAuditEvents]: RuntimeClientMethodContract<'audit', 'exportAuditEvents'>;
  [RuntimeMethodIds.audit.subscribeAIProviderHealthEvents]: RuntimeClientMethodContract<'audit', 'subscribeAIProviderHealthEvents'>;
  [RuntimeMethodIds.audit.subscribeRuntimeHealthEvents]: RuntimeClientMethodContract<'audit', 'subscribeRuntimeHealthEvents'>;
};

type RuntimeExplicitUnaryMethodIds =
  | typeof RuntimeMethodIds.local.importLocalModelFile
  | typeof RuntimeMethodIds.local.importLocalArtifactFile
  | typeof RuntimeMethodIds.local.scanUnregisteredAssets
  | typeof RuntimeMethodIds.local.scaffoldOrphanModel
  | typeof RuntimeMethodIds.local.scaffoldOrphanArtifact
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
