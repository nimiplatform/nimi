import type { RuntimeTypedClient } from '../core-generated/runtime-typed-client';

export type RuntimeTypedMethodName = {
  readonly [Key in keyof RuntimeTypedClient]: RuntimeTypedClient[Key] extends (...args: never[]) => unknown ? Key : never;
}[keyof RuntimeTypedClient] & string;

export type RuntimeMethodModule<Keys extends readonly RuntimeTypedMethodName[]> = Readonly<{
  [Key in Keys[number]]: RuntimeTypedClient[Key];
}>;

export const RUNTIME_ACCOUNT_METHODS = [
  'getAccountSessionStatus',
  'subscribeAccountSessionEvents',
  'beginLogin',
  'completeLogin',
  'requestPresenceVerification',
  'invokeRealmUnary',
  'logout',
  'switchAccount',
  'issueScopedAppBinding',
  'revokeScopedAppBinding',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_AGENT_METHODS = [
  'initializeAgent',
  'terminateAgent',
  'getAgent',
  'listAgents',
  'openConversationAnchor',
  'getConversationAnchorSnapshot',
  'listAgentConversationSummaries',
  'registerAvatarLiveInstanceBinding',
  'resolveAvatarLiveInstanceBinding',
  'getPublicChatSessionSnapshot',
  'getCompanionParticipationProjection',
  'requestCompanionParticipation',
  'cancelCompanionParticipation',
  'openCompanionParticipationReplay',
  'createRealmGroupMessageCandidate',
  'getRealmGroupMessageCandidateEvidence',
  'getAvatarDebugSnapshot',
  'requestAvatarDebugProbe',
  'submitAvatarDebugProbeResult',
  'listAvatarDebugProbeResults',
  'getAvatarDebugReplay',
  'listDelegatedProviderProfiles',
  'listDelegatedApprovalRequests',
  'submitDelegatedApprovalDecision',
  'listDelegatedDiagnostics',
  'getDelegatedReplayTrace',
  'getDelegatedControlSurfaceSnapshot',
  'getAgentState',
  'updateAgentState',
  'setAgentPresentationProfile',
  'enableAutonomy',
  'disableAutonomy',
  'setAutonomyConfig',
  'listPendingHooks',
  'cancelHook',
  'queryAgentMemory',
  'writeAgentMemory',
  'getAgentCanonicalMemoryBankStatus',
  'getAgentCanonicalMemoryReviewStatus',
  'requestAgentCanonicalMemoryBankBind',
  'getRuntimeAgentAIConfig',
  'upsertRuntimeAgentAIConfig',
  'getRuntimeAgentAIConfigReadiness',
  'subscribeRuntimeAgentAIConfigReadiness',
  'subscribeAgentEvents',
  'subscribeAgentVoiceStream',
  'interruptAgentVoicePlayback',
] as const satisfies readonly RuntimeTypedMethodName[];

// High-level Runtime root methods intentionally replace their raw generated
// counterparts. They participate in the admitted Agent method group without
// becoming members of runtime.agents or accepting generated request DTOs.
export const RUNTIME_ROOT_AGENT_FACADE_METHODS = [
  'materializeRealmSource',
] as const;

export type RuntimeRootAgentFacadeMethodName =
  (typeof RUNTIME_ROOT_AGENT_FACADE_METHODS)[number];

export const RUNTIME_AI_METHODS = [
  'executeScenario',
  'streamScenario',
  'submitScenarioJob',
  'getScenarioJob',
  'cancelScenarioJob',
  'subscribeScenarioJobEvents',
  'getScenarioArtifacts',
  'listScenarioProfiles',
  'getVoiceAsset',
  'listVoiceAssets',
  'deleteVoiceAsset',
  'listPresetVoices',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_SCHEDULING_METHODS = [
  'peekScheduling',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_REALTIME_METHODS = [
  'openRealtimeSession',
  'appendRealtimeInput',
  'readRealtimeEvents',
  'closeRealtimeSession',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_CONNECTOR_METHODS = [
  'createConnector',
  'getConnector',
  'listConnectors',
  'updateConnector',
  'deleteConnector',
  'testConnector',
  'listConnectorModels',
  'listProviderCatalog',
  'listModelCatalogProviders',
  'upsertModelCatalogProvider',
  'deleteModelCatalogProvider',
  'listCatalogProviderModels',
  'getCatalogModelDetail',
  'upsertCatalogModelOverlay',
  'deleteCatalogModelOverlay',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_AUTH_METHODS = [
  'registerApp',
  'openSession',
  'refreshSession',
  'revokeSession',
  'registerExternalPrincipal',
  'openExternalPrincipalSession',
  'revokeExternalPrincipalSession',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_EXTERNAL_AGENT_METHODS = [
  'getExternalAgentGatewayStatus',
  'issueExternalAgentToken',
  'revokeExternalAgentToken',
  'listExternalAgentTokens',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_AUDIT_METHODS = [
  'getRuntimeHealth',
  'listAIProviderHealth',
  'subscribeAIProviderHealthEvents',
  'subscribeRuntimeHealthEvents',
  'listAuditEvents',
  'listDesktopAuditEvents',
  'exportAuditEvents',
  'listUsageStats',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_KNOWLEDGE_METHODS = [
  'createKnowledgeBank',
  'getKnowledgeBank',
  'listKnowledgeBanks',
  'deleteKnowledgeBank',
  'putPage',
  'getPage',
  'listPages',
  'deletePage',
  'searchKeyword',
  'searchHybrid',
  'addLink',
  'removeLink',
  'listLinks',
  'listBacklinks',
  'traverseGraph',
  'ingestDocument',
  'getIngestTask',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_MEMORY_METHODS = [
  'createBank',
  'getBank',
  'listBanks',
  'deleteBank',
  'retain',
  'recall',
  'history',
  'deleteMemory',
  'inspectMemoryEmbeddingRuntime',
  'requestMemoryEmbeddingRuntimeBind',
  'requestMemoryEmbeddingRuntimeCutover',
  'subscribeMemoryEvents',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_LOCAL_METHODS = [
  'listLocalAssets',
  'removeLocalAsset',
  'startLocalAsset',
  'stopLocalAsset',
  'checkLocalAssetHealth',
  'warmLocalAsset',
  'listVerifiedAssets',
  'searchCatalogModels',
  'listCatalogVariants',
  'getRecommendationFeed',
  'resolveModelInstallPlan',
  'installModelFromPlan',
  'installVerifiedAsset',
  'importLocalAsset',
  'importLocalAssetFile',
  'importLocalAssetBundle',
  'rescanLocalAssetBundle',
  'listLocalTransfers',
  'pauseLocalTransfer',
  'resumeLocalTransfer',
  'cancelLocalTransfer',
  'watchLocalTransfers',
  'collectDeviceProfile',
  'listLocalServices',
  'installLocalService',
  'startLocalService',
  'stopLocalService',
  'checkLocalServiceHealth',
  'removeLocalService',
  'listNodeCatalog',
  'scanUnregisteredAssets',
  'scaffoldOrphanAsset',
  'resolveProfile',
  'applyProfile',
  'listLocalAudits',
  'appendInferenceAudit',
  'appendRuntimeAudit',
  'listEngines',
  'ensureEngine',
  'startEngine',
  'stopEngine',
  'getEngineStatus',
  'resolveLocalEnvironmentPlan',
  'prepareProfileRuntimeDescriptor',
  'listLocalEnvironmentSelectedSources',
  'listLocalEnvironmentDependencyJobs',
  'resolveLocalEnvironmentActivationGate',
  'startLocalEnvironmentDependencyJob',
  'cancelLocalEnvironmentDependencyJob',
  'retryLocalEnvironmentDependencyJob',
  'repairLocalEnvironmentDependency',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_APP_MESSAGE_METHODS = [
  'sendAppMessage',
  'subscribeAppMessages',
] as const satisfies readonly RuntimeTypedMethodName[];

export const RUNTIME_ARTIFACT_METHODS = [
  'readArtifactBytes',
  'cleanupGeneratedVoiceArtifacts',
] as const satisfies readonly RuntimeTypedMethodName[];

export type RuntimeAccountModule = RuntimeMethodModule<typeof RUNTIME_ACCOUNT_METHODS>;
export type RuntimeAgentModule = RuntimeMethodModule<typeof RUNTIME_AGENT_METHODS>;
export type RuntimeAiModule = RuntimeMethodModule<typeof RUNTIME_AI_METHODS>;
export type RuntimeSchedulingModule = RuntimeMethodModule<typeof RUNTIME_SCHEDULING_METHODS>;
export type RuntimeRealtimeModule = RuntimeMethodModule<typeof RUNTIME_REALTIME_METHODS>;
export type RuntimeConnectorModule = RuntimeMethodModule<typeof RUNTIME_CONNECTOR_METHODS>;
export type RuntimeAuthModule = RuntimeMethodModule<typeof RUNTIME_AUTH_METHODS>;
export type RuntimeExternalAgentModule = RuntimeMethodModule<typeof RUNTIME_EXTERNAL_AGENT_METHODS>;
export type RuntimeAuditModule = RuntimeMethodModule<typeof RUNTIME_AUDIT_METHODS>;
export type RuntimeKnowledgeModule = RuntimeMethodModule<typeof RUNTIME_KNOWLEDGE_METHODS>;
export type RuntimeMemoryModule = RuntimeMethodModule<typeof RUNTIME_MEMORY_METHODS>;
export type RuntimeLocalModule = RuntimeMethodModule<typeof RUNTIME_LOCAL_METHODS>;
export type RuntimeAppMessageModule = RuntimeMethodModule<typeof RUNTIME_APP_MESSAGE_METHODS>;
export type RuntimeArtifactModule = RuntimeMethodModule<typeof RUNTIME_ARTIFACT_METHODS>;
