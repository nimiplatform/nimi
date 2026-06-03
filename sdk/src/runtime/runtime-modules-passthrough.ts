import { wrapModeBWorkflowStream } from './helpers.js';
import type {
  RuntimeAccountClient,
  RuntimeAgentClient,
  RuntimeAuditClient,
  RuntimeAuthClient,
  RuntimeClient,
  RuntimeConnectorClient,
  RuntimeExternalAgentClient,
  RuntimeKnowledgeClient,
  RuntimeLocalServiceClient,
  RuntimeMemoryClient,
  RuntimeModelClient,
  RuntimeWorkflowClient,
} from './types.js';

type RuntimeInvokeWithClient = <T>(operation: (client: RuntimeClient) => Promise<T>) => Promise<T>;

type RuntimePassthroughModuleKey =
  'auth'
  | 'externalAgent'
  | 'account'
  | 'workflow'
  | 'model'
  | 'local'
  | 'connector'
  | 'knowledge'
  | 'memory'
  | 'agent'
  | 'audit';

type RuntimePassthroughClient = Record<string, (request: any, options?: any) => Promise<any>>;

type RuntimePassthroughMethod<TClient extends RuntimePassthroughClient> = Extract<keyof TClient, string>;

export type RuntimeCorePassthroughClients = {
  auth: RuntimeAuthClient;
  externalAgent: RuntimeExternalAgentClient;
  account: RuntimeAccountClient;
  workflow: RuntimeWorkflowClient;
  model: RuntimeModelClient;
  local: RuntimeLocalServiceClient;
  connector: RuntimeConnectorClient;
  knowledge: RuntimeKnowledgeClient;
  memory: RuntimeMemoryClient;
  agent: RuntimeAgentClient;
  audit: RuntimeAuditClient;
};

const AUTH_METHODS = [
  'registerApp',
  'openSession',
  'refreshSession',
  'revokeSession',
  'registerExternalPrincipal',
  'openExternalPrincipalSession',
  'revokeExternalPrincipalSession',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeAuthClient>[];

const ACCOUNT_METHODS = [
  'getAccountSessionStatus',
  'beginLogin',
  'completeLogin',
  'getAccessToken',
  'refreshAccountSession',
  'logout',
  'switchAccount',
  'issueScopedAppBinding',
  'revokeScopedAppBinding',
  'issueWorkspaceBinding',
  'revokeWorkspaceBinding',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeAccountClient>[];

const EXTERNAL_AGENT_METHODS = [
  'getGatewayStatus',
  'issueToken',
  'revokeToken',
  'listTokens',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeExternalAgentClient>[];

const MODEL_METHODS = [
  'list',
  'pull',
  'remove',
  'checkHealth',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeModelClient>[];

const LOCAL_METHODS = [
  'listLocalAssets',
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
  'scanUnregisteredAssets',
  'scaffoldOrphanAsset',
  'removeLocalAsset',
  'startLocalAsset',
  'stopLocalAsset',
  'checkLocalAssetHealth',
  'warmLocalAsset',
  'listLocalTransfers',
  'pauseLocalTransfer',
  'resumeLocalTransfer',
  'cancelLocalTransfer',
  'resolveLocalEnvironmentPlan',
  'listLocalEnvironmentSelectedSources',
  'listLocalEnvironmentDependencyJobs',
  'resolveLocalEnvironmentActivationGate',
  'mintRuntimeBaselineReadiness',
  'resolveRuntimeBaselineReadiness',
  'mintFirstRunExecutionEvidence',
  'resolveFirstRunExecutionEvidence',
  'startLocalEnvironmentDependencyJob',
  'cancelLocalEnvironmentDependencyJob',
  'retryLocalEnvironmentDependencyJob',
  'repairLocalEnvironmentDependency',
  'resolveLocalStateReconciliation',
  'executeLocalStateCutover',
  'getProductControlRecord',
  'getProductControlSelectedDataRoot',
  'ensureProductControlRecordCreated',
  'selectProductControlDataRoot',
  'setProductControlFirstRunInstallLevel',
  'completeProductControlFirstRunDeviceEnvironmentScan',
  'admitProductControlReadyForUse',
  'recordProductControlAccountDefaultProfileEvidence',
  'recordProductControlFirstRunLocalAiReadyEvidence',
  'reconcileProductControlFirstRunSetupState',
  'collectDeviceProfile',
  'resolveProfile',
  'applyProfile',
  'listLocalServices',
  'installLocalService',
  'startLocalService',
  'stopLocalService',
  'checkLocalServiceHealth',
  'removeLocalService',
  'listNodeCatalog',
  'listLocalAudits',
  'appendInferenceAudit',
  'appendRuntimeAudit',
  'listEngines',
  'ensureEngine',
  'startEngine',
  'stopEngine',
  'getEngineStatus',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeLocalServiceClient>[];

const CONNECTOR_METHODS = [
  'createConnector',
  'getConnector',
  'listConnectors',
  'updateConnector',
  'deleteConnector',
  'testConnector',
  'listConnectorModels',
  'listProviderCatalog',
  'listModelCatalogProviders',
  'listCatalogProviderModels',
  'getCatalogModelDetail',
  'upsertModelCatalogProvider',
  'deleteModelCatalogProvider',
  'upsertCatalogModelOverlay',
  'deleteCatalogModelOverlay',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeConnectorClient>[];

const KNOWLEDGE_METHODS = [
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
] as const satisfies readonly RuntimePassthroughMethod<RuntimeKnowledgeClient>[];

const MEMORY_METHODS = [
  'createBank',
  'getBank',
  'listBanks',
  'deleteBank',
  'retain',
  'recall',
  'history',
  'deleteMemory',
  'getMemoryEmbeddingRuntimeIntent',
  'setMemoryEmbeddingRuntimeIntent',
  'inspectMemoryEmbeddingRuntime',
  'requestMemoryEmbeddingRuntimeBind',
  'requestMemoryEmbeddingRuntimeCutover',
  'subscribeEvents',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeMemoryClient>[];

const AGENT_METHODS = [
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
  'listAvatarDebugProbeResults',
  'getAvatarDebugReplay',
  'listDelegatedProviderProfiles',
  'upsertDelegatedProviderProfile',
  'setDelegatedProviderState',
  'listDelegatedApprovalRequests',
  'submitDelegatedApprovalDecision',
  'listDelegatedDiagnostics',
  'getDelegatedReplayTrace',
  'getDelegatedControlSurfaceSnapshot',
  'executeDelegatedCapability',
  'getAgentState',
  'updateAgentState',
  'setPresentationProfile',
  'enableAutonomy',
  'disableAutonomy',
  'setAutonomyConfig',
  'listPendingHooks',
  'cancelHook',
  'queryMemory',
  'writeMemory',
  'getAgentCanonicalMemoryBankStatus',
  'requestAgentCanonicalMemoryBankBind',
  'subscribeEvents',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeAgentClient>[];

const AUDIT_METHODS = [
  'listAuditEvents',
  'exportAuditEvents',
  'listUsageStats',
  'getRuntimeHealth',
  'listAIProviderHealth',
  'subscribeAIProviderHealthEvents',
  'subscribeRuntimeHealthEvents',
] as const satisfies readonly RuntimePassthroughMethod<RuntimeAuditClient>[];

function createPassthroughModule<
  TModuleKey extends RuntimePassthroughModuleKey,
  TClient extends RuntimePassthroughClient,
  TMethodName extends RuntimePassthroughMethod<TClient>,
>(
  moduleKey: TModuleKey,
  methods: readonly TMethodName[],
  input: {
    guard: (moduleKey: RuntimePassthroughModuleKey, methodKey: string) => void;
    invokeWithClient: RuntimeInvokeWithClient;
  },
): Pick<TClient, TMethodName> {
  const { guard, invokeWithClient } = input;
  const moduleClient = {} as Pick<TClient, TMethodName>;

  for (const methodName of methods) {
    moduleClient[methodName] = (async (request: any, options?: any) => {
      guard(moduleKey, methodName);
      return invokeWithClient(async (client) => {
        const runtimeModule = client[moduleKey] as Record<string, (request: any, options?: any) => Promise<any>>;
        const runtimeMethod = runtimeModule[methodName];
        if (typeof runtimeMethod !== 'function') {
          throw new Error(`runtime passthrough method missing: ${String(moduleKey)}.${String(methodName)}`);
        }
        return runtimeMethod(request, options);
      });
    }) as Pick<TClient, TMethodName>[TMethodName];
  }

  return moduleClient;
}

export function createCorePassthroughClients(input: {
  assertMethodAvailable: (moduleKey: string, methodKey: string) => void;
  invokeWithClient: RuntimeInvokeWithClient;
}): RuntimeCorePassthroughClients {
  const { assertMethodAvailable, invokeWithClient } = input;

  const guard = (mod: RuntimePassthroughModuleKey, method: string) => assertMethodAvailable(mod, method);

  const auth: RuntimeAuthClient = createPassthroughModule('auth', AUTH_METHODS, { guard, invokeWithClient });
  const externalAgent: RuntimeExternalAgentClient = createPassthroughModule('externalAgent', EXTERNAL_AGENT_METHODS, { guard, invokeWithClient });
  const accountBase = createPassthroughModule('account', ACCOUNT_METHODS, { guard, invokeWithClient });
  const account: RuntimeAccountClient = {
    ...accountBase,
    subscribeAccountSessionEvents: async (request, optionsValue) => {
      guard('account', 'subscribeAccountSessionEvents');
      return invokeWithClient(async (client) => client.account.subscribeAccountSessionEvents(request, optionsValue));
    },
  };

  const workflowBase = createPassthroughModule('workflow', ['submit', 'get', 'cancel'] as const, { guard, invokeWithClient });
  const workflow: RuntimeWorkflowClient = {
    ...workflowBase,
    subscribeEvents: async (req, opts) => {
      guard('workflow', 'subscribeEvents');
      const raw = await invokeWithClient((c) => c.workflow.subscribeEvents(req, opts));
      return wrapModeBWorkflowStream(raw);
    },
  };

  const model: RuntimeModelClient = createPassthroughModule('model', MODEL_METHODS, { guard, invokeWithClient });

  const localBase = createPassthroughModule('local', LOCAL_METHODS, { guard, invokeWithClient });
  const local: RuntimeLocalServiceClient = {
    ...localBase,
    watchLocalTransfers: async (request, optionsValue) => {
      guard('local', 'watchLocalTransfers');
      return invokeWithClient(async (client) => client.local.watchLocalTransfers(request, optionsValue));
    },
  };

  const connector: RuntimeConnectorClient = createPassthroughModule('connector', CONNECTOR_METHODS, { guard, invokeWithClient });

  const knowledge: RuntimeKnowledgeClient = createPassthroughModule('knowledge', KNOWLEDGE_METHODS, { guard, invokeWithClient });

  const memoryBase = createPassthroughModule('memory', MEMORY_METHODS, { guard, invokeWithClient });
  const memory: RuntimeMemoryClient = {
    ...memoryBase,
    subscribeEvents: async (request, optionsValue) => {
      guard('memory', 'subscribeEvents');
      return invokeWithClient(async (client) => client.memory.subscribeEvents(request, optionsValue));
    },
  };

  const agentBase = createPassthroughModule('agent', AGENT_METHODS, { guard, invokeWithClient });
  const agent: RuntimeAgentClient = {
    ...agentBase,
    subscribeEvents: async (request, optionsValue) => {
      guard('agent', 'subscribeEvents');
      return invokeWithClient(async (client) => client.agent.subscribeEvents(request, optionsValue));
    },
  };

  const audit: RuntimeAuditClient = createPassthroughModule('audit', AUDIT_METHODS, { guard, invokeWithClient });

  return { auth, externalAgent, account, workflow, model, local, connector, knowledge, memory, agent, audit };
}
