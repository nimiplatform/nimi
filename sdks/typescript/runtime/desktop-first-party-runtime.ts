import type {
  CreateRealmGroupMessageCandidateRequest,
  CreateRealmGroupMessageCandidateResponse,
  GetRealmGroupMessageCandidateEvidenceRequest,
  GetRealmGroupMessageCandidateEvidenceResponse,
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import {
  createRuntime,
  type RuntimeMaterializeRealmSourceInput,
  type RuntimeMaterializeRealmSourceResult,
  type RuntimeOptions,
  type RuntimeTransportConfig,
} from './index';
import { createRuntimeElectronIpcTransport } from './electron-ipc';
import { createRuntimeTauriIpcTransport } from './tauri-ipc';
import type {
  DesktopAccountProductRuntimeMethods,
  DesktopMachineProductRuntimeMethods,
} from './first-party-protected-runtime-profiles.generated';
import type { NimiRuntimeAppLifecycleClient } from './app-lifecycle-types';
import type { NimiRuntimeAgentAuthClient } from './runtime-agent-protected';
import type { NimiRuntimeScenarioJobClient } from './scenario-jobs';

export type NimiDesktopMachineProductRuntimeClient = {
  readonly local: Pick<DesktopMachineProductRuntimeMethods,
    | 'collectDeviceProfile'
    | 'resolveLocalEnvironmentPlan'
    | 'listLocalEnvironmentDependencyJobs'
    | 'startLocalEnvironmentDependencyJob'
    | 'cancelLocalEnvironmentDependencyJob'
    | 'retryLocalEnvironmentDependencyJob'
    | 'repairLocalEnvironmentDependency'
    | 'listLocalAssets'
    | 'listNodeCatalog'
    | 'checkLocalAssetHealth'
    | 'warmLocalAsset'
    | 'removeLocalAsset'
    | 'startLocalAsset'
    | 'stopLocalAsset'
    | 'listVerifiedAssets'
    | 'searchCatalogModels'
    | 'listCatalogVariants'
    | 'getRecommendationFeed'
    | 'resolveModelInstallPlan'
    | 'installModelFromPlan'
    | 'installVerifiedAsset'
    | 'importLocalAsset'
    | 'importLocalAssetFile'
    | 'importLocalAssetBundle'
    | 'rescanLocalAssetBundle'
    | 'listLocalTransfers'
    | 'pauseLocalTransfer'
    | 'resumeLocalTransfer'
    | 'cancelLocalTransfer'
    | 'watchLocalTransfers'
    | 'scanUnregisteredAssets'
    | 'scaffoldOrphanAsset'
    | 'resolveProfile'
    | 'applyProfile'
    | 'listLocalAudits'>;
  readonly connectors: Pick<DesktopMachineProductRuntimeMethods,
    | 'listConnectors'
    | 'listProviderCatalog'>;
  readonly audit: Pick<DesktopMachineProductRuntimeMethods,
    | 'getRuntimeHealth'
    | 'listAIProviderHealth'
    | 'listDesktopAuditEvents'
    | 'listUsageStats'
    | 'subscribeRuntimeHealthEvents'
    | 'subscribeAIProviderHealthEvents'>;
  readonly externalAgents: Pick<DesktopMachineProductRuntimeMethods,
    | 'getExternalAgentGatewayStatus'
    | 'issueExternalAgentToken'
    | 'revokeExternalAgentToken'
    | 'listExternalAgentTokens'>;
  readonly ai: Pick<DesktopMachineProductRuntimeMethods,
    | 'executeScenario'
    | 'streamScenario'>;
  readonly scheduling: Pick<DesktopMachineProductRuntimeMethods, 'peekScheduling'>;
};

export type NimiDesktopAccountProductRuntimeClient = {
  readonly agents: Pick<DesktopAccountProductRuntimeMethods,
    | 'listAgents'
    | 'getAgent'
    | 'openConversationAnchor'
    | 'getConversationAnchorSnapshot'
    | 'listAgentConversationSummaries'
    | 'getPublicChatSessionSnapshot'
    | 'registerAvatarLiveInstanceBinding'
    | 'resolveAvatarLiveInstanceBinding'
    | 'setAgentPresentationProfile'
    | 'getRuntimeAgentAIConfig'
    | 'upsertRuntimeAgentAIConfig'
    | 'getRuntimeAgentAIConfigReadiness'
    | 'subscribeRuntimeAgentAIConfigReadiness'
    | 'getAgentCanonicalMemoryBankStatus'
    | 'requestAgentCanonicalMemoryBankBind'
    | 'subscribeAgentEvents'
    | 'getAgentState'
    | 'listPendingHooks'
    | 'queryAgentMemory'
    | 'updateAgentState'
    | 'enableAutonomy'
    | 'disableAutonomy'
    | 'setAutonomyConfig'
    | 'cancelHook'
    | 'getDelegatedControlSurfaceSnapshot'
    | 'getDelegatedReplayTrace'
    | 'upsertDelegatedProviderProfile'
    | 'setDelegatedProviderState'
    | 'submitDelegatedApprovalDecision'>;
  readonly apps: Pick<NimiRuntimeAppLifecycleClient, 'accountInventory' | 'packageReadiness'>;
  readonly connectors: Pick<DesktopAccountProductRuntimeMethods,
    | 'listModelCatalogProviders'
    | 'listCatalogProviderModels'
    | 'getCatalogModelDetail'
    | 'upsertModelCatalogProvider'
    | 'deleteModelCatalogProvider'
    | 'upsertCatalogModelOverlay'
    | 'deleteCatalogModelOverlay'
    | 'listConnectors'
    | 'createConnector'
    | 'updateConnector'
    | 'deleteConnector'
    | 'testConnector'
    | 'listConnectorModels'>;
  readonly appMessages: Pick<DesktopAccountProductRuntimeMethods,
    | 'sendAppMessage'
    | 'subscribeAppMessages'>;
  readonly artifacts: Pick<DesktopAccountProductRuntimeMethods,
    | 'readArtifactBytes'
    | 'cleanupGeneratedVoiceArtifacts'>;
  readonly materializeRealmSource: (
    input: RuntimeMaterializeRealmSourceInput,
  ) => Promise<RuntimeMaterializeRealmSourceResult>;
};

/** Exact non-profile Runtime methods exercised by the active Desktop voice workflow. */
export type NimiDesktopRuntimeAiScenarioJobClient = NimiRuntimeScenarioJobClient;

/** Exact Agent methods exercised by active Desktop product consumers. */
export type NimiDesktopRuntimeAgentPurposeClient = NimiDesktopAccountProductRuntimeClient['agents'] & {
  readonly createRealmGroupMessageCandidate: (
    request: CreateRealmGroupMessageCandidateRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<CreateRealmGroupMessageCandidateResponse>;
  readonly getRealmGroupMessageCandidateEvidence: (
    request: GetRealmGroupMessageCandidateEvidenceRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<GetRealmGroupMessageCandidateEvidenceResponse>;
};

export type NimiDesktopFirstPartyRuntimeClients = {
  readonly machineProduct: NimiDesktopMachineProductRuntimeClient;
  readonly accountProduct: NimiDesktopAccountProductRuntimeClient;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly aiScenarioJobs: NimiDesktopRuntimeAiScenarioJobClient;
  readonly agentPurpose: NimiDesktopRuntimeAgentPurposeClient;
};

export type NimiDesktopFirstPartyRuntimeClientsInput = {
  readonly appId: string;
  readonly transport: RuntimeTransportConfig;
  readonly getSubjectUserId?: RuntimeOptions['getSubjectUserId'];
};

type RuntimeOperation = (request: any, options?: RuntimeTypedCallOptions) => any;
type ListConnectorsIntent = 'machine.route-connectors.list' | 'account.connector-admin.list';

function bindListConnectorsIntent(
  transport: RuntimeTransportConfig,
  intent: ListConnectorsIntent,
): RuntimeTransportConfig {
  if ('unary' in transport) return transport;
  if (transport.type === 'electron-ipc') {
    return createRuntimeElectronIpcTransport({ ...transport, firstPartyListConnectorsIntent: intent });
  }
  if (transport.type === 'tauri-ipc') {
    return createRuntimeTauriIpcTransport({ ...transport, firstPartyListConnectorsIntent: intent });
  }
  return transport;
}

function bindProtectedAccountAgentOperation<T extends RuntimeOperation>(operation: T, appId: string): T {
  return ((request: Record<string, unknown> = {}, options?: RuntimeTypedCallOptions) => operation({
    ...request,
    context: { appId },
  }, options)) as T;
}

/**
 * Composes Desktop's exact generated product profiles and the one retained
 * non-profile AI purpose client without exposing Runtime service families.
 */
export function createNimiDesktopFirstPartyRuntimeClients(
  input: NimiDesktopFirstPartyRuntimeClientsInput,
): NimiDesktopFirstPartyRuntimeClients {
  const runtime = createRuntime({
    appId: input.appId,
    transport: input.transport,
    getSubjectUserId: input.getSubjectUserId,
    hostOwnedIdentity: true,
  });
  const machineIntentRuntime = createRuntime({
    appId: input.appId,
    transport: bindListConnectorsIntent(input.transport, 'machine.route-connectors.list'),
    getSubjectUserId: input.getSubjectUserId,
    hostOwnedIdentity: true,
  });
  const accountIntentRuntime = createRuntime({
    appId: input.appId,
    transport: bindListConnectorsIntent(input.transport, 'account.connector-admin.list'),
    getSubjectUserId: input.getSubjectUserId,
    hostOwnedIdentity: true,
  });
  const protectedAgent = <T extends RuntimeOperation>(operation: T): T => (
    bindProtectedAccountAgentOperation(operation, input.appId)
  );
  const accountAgents: NimiDesktopAccountProductRuntimeClient['agents'] = Object.freeze({
    listAgents: runtime.agents.listAgents,
    getAgent: runtime.agents.getAgent,
    openConversationAnchor: runtime.agents.openConversationAnchor,
    getConversationAnchorSnapshot: runtime.agents.getConversationAnchorSnapshot,
    listAgentConversationSummaries: runtime.agents.listAgentConversationSummaries,
    getPublicChatSessionSnapshot: runtime.agents.getPublicChatSessionSnapshot,
    registerAvatarLiveInstanceBinding: runtime.agents.registerAvatarLiveInstanceBinding,
    resolveAvatarLiveInstanceBinding: runtime.agents.resolveAvatarLiveInstanceBinding,
    setAgentPresentationProfile: runtime.agents.setAgentPresentationProfile,
    getRuntimeAgentAIConfig: runtime.agents.getRuntimeAgentAIConfig,
    upsertRuntimeAgentAIConfig: runtime.agents.upsertRuntimeAgentAIConfig,
    getRuntimeAgentAIConfigReadiness: runtime.agents.getRuntimeAgentAIConfigReadiness,
    subscribeRuntimeAgentAIConfigReadiness: runtime.agents.subscribeRuntimeAgentAIConfigReadiness,
    getAgentCanonicalMemoryBankStatus: runtime.agents.getAgentCanonicalMemoryBankStatus,
    requestAgentCanonicalMemoryBankBind: runtime.agents.requestAgentCanonicalMemoryBankBind,
    subscribeAgentEvents: runtime.agents.subscribeAgentEvents,
    getAgentState: protectedAgent(runtime.agents.getAgentState),
    listPendingHooks: protectedAgent(runtime.agents.listPendingHooks),
    queryAgentMemory: protectedAgent(runtime.agents.queryAgentMemory),
    updateAgentState: protectedAgent(runtime.agents.updateAgentState),
    enableAutonomy: protectedAgent(runtime.agents.enableAutonomy),
    disableAutonomy: protectedAgent(runtime.agents.disableAutonomy),
    setAutonomyConfig: protectedAgent(runtime.agents.setAutonomyConfig),
    cancelHook: protectedAgent(runtime.agents.cancelHook),
    getDelegatedControlSurfaceSnapshot: protectedAgent(runtime.agents.getDelegatedControlSurfaceSnapshot),
    getDelegatedReplayTrace: protectedAgent(runtime.agents.getDelegatedReplayTrace),
    upsertDelegatedProviderProfile: protectedAgent(runtime.agents.upsertDelegatedProviderProfile),
    setDelegatedProviderState: protectedAgent(runtime.agents.setDelegatedProviderState),
    submitDelegatedApprovalDecision: protectedAgent(runtime.agents.submitDelegatedApprovalDecision),
  });
  const agentPurpose: NimiDesktopRuntimeAgentPurposeClient = Object.freeze({
    ...accountAgents,
    createRealmGroupMessageCandidate: runtime.agents.createRealmGroupMessageCandidate,
    getRealmGroupMessageCandidateEvidence: runtime.agents.getRealmGroupMessageCandidateEvidence,
  });
  return Object.freeze({
    machineProduct: Object.freeze({
      local: Object.freeze({
        collectDeviceProfile: runtime.local.collectDeviceProfile,
        resolveLocalEnvironmentPlan: runtime.local.resolveLocalEnvironmentPlan,
        listLocalEnvironmentDependencyJobs: runtime.local.listLocalEnvironmentDependencyJobs,
        startLocalEnvironmentDependencyJob: runtime.local.startLocalEnvironmentDependencyJob,
        cancelLocalEnvironmentDependencyJob: runtime.local.cancelLocalEnvironmentDependencyJob,
        retryLocalEnvironmentDependencyJob: runtime.local.retryLocalEnvironmentDependencyJob,
        repairLocalEnvironmentDependency: runtime.local.repairLocalEnvironmentDependency,
        listLocalAssets: runtime.local.listLocalAssets,
        listNodeCatalog: runtime.local.listNodeCatalog,
        checkLocalAssetHealth: runtime.local.checkLocalAssetHealth,
        warmLocalAsset: runtime.local.warmLocalAsset,
        removeLocalAsset: runtime.local.removeLocalAsset,
        startLocalAsset: runtime.local.startLocalAsset,
        stopLocalAsset: runtime.local.stopLocalAsset,
        listVerifiedAssets: runtime.local.listVerifiedAssets,
        searchCatalogModels: runtime.local.searchCatalogModels,
        listCatalogVariants: runtime.local.listCatalogVariants,
        getRecommendationFeed: runtime.local.getRecommendationFeed,
        resolveModelInstallPlan: runtime.local.resolveModelInstallPlan,
        installModelFromPlan: runtime.local.installModelFromPlan,
        installVerifiedAsset: runtime.local.installVerifiedAsset,
        importLocalAsset: runtime.local.importLocalAsset,
        importLocalAssetFile: runtime.local.importLocalAssetFile,
        importLocalAssetBundle: runtime.local.importLocalAssetBundle,
        rescanLocalAssetBundle: runtime.local.rescanLocalAssetBundle,
        listLocalTransfers: runtime.local.listLocalTransfers,
        pauseLocalTransfer: runtime.local.pauseLocalTransfer,
        resumeLocalTransfer: runtime.local.resumeLocalTransfer,
        cancelLocalTransfer: runtime.local.cancelLocalTransfer,
        watchLocalTransfers: runtime.local.watchLocalTransfers,
        scanUnregisteredAssets: runtime.local.scanUnregisteredAssets,
        scaffoldOrphanAsset: runtime.local.scaffoldOrphanAsset,
        resolveProfile: runtime.local.resolveProfile,
        applyProfile: runtime.local.applyProfile,
        listLocalAudits: runtime.local.listLocalAudits,
      }),
      connectors: Object.freeze({
        listConnectors: machineIntentRuntime.connectors.listConnectors,
        listProviderCatalog: runtime.connectors.listProviderCatalog,
      }),
      audit: Object.freeze({
        getRuntimeHealth: runtime.audit.getRuntimeHealth,
        listAIProviderHealth: runtime.audit.listAIProviderHealth,
        listDesktopAuditEvents: runtime.audit.listDesktopAuditEvents,
        listUsageStats: runtime.audit.listUsageStats,
        subscribeRuntimeHealthEvents: runtime.audit.subscribeRuntimeHealthEvents,
        subscribeAIProviderHealthEvents: runtime.audit.subscribeAIProviderHealthEvents,
      }),
      externalAgents: Object.freeze({
        getExternalAgentGatewayStatus: runtime.externalAgents.getExternalAgentGatewayStatus,
        issueExternalAgentToken: runtime.externalAgents.issueExternalAgentToken,
        revokeExternalAgentToken: runtime.externalAgents.revokeExternalAgentToken,
        listExternalAgentTokens: runtime.externalAgents.listExternalAgentTokens,
      }),
      ai: Object.freeze({
        executeScenario: runtime.ai.executeScenario,
        streamScenario: runtime.ai.streamScenario,
      }),
      scheduling: Object.freeze({
        peekScheduling: runtime.scheduling.peekScheduling,
      }),
    }),
    accountProduct: Object.freeze({
      agents: accountAgents,
      apps: Object.freeze({
        accountInventory: runtime.appLifecycle.accountInventory,
        packageReadiness: runtime.appLifecycle.packageReadiness,
      }),
      connectors: Object.freeze({
        listModelCatalogProviders: runtime.connectors.listModelCatalogProviders,
        listCatalogProviderModels: runtime.connectors.listCatalogProviderModels,
        getCatalogModelDetail: runtime.connectors.getCatalogModelDetail,
        upsertModelCatalogProvider: runtime.connectors.upsertModelCatalogProvider,
        deleteModelCatalogProvider: runtime.connectors.deleteModelCatalogProvider,
        upsertCatalogModelOverlay: runtime.connectors.upsertCatalogModelOverlay,
        deleteCatalogModelOverlay: runtime.connectors.deleteCatalogModelOverlay,
        listConnectors: accountIntentRuntime.connectors.listConnectors,
        createConnector: runtime.connectors.createConnector,
        updateConnector: runtime.connectors.updateConnector,
        deleteConnector: runtime.connectors.deleteConnector,
        testConnector: runtime.connectors.testConnector,
        listConnectorModels: runtime.connectors.listConnectorModels,
      }),
      appMessages: Object.freeze({
        sendAppMessage: runtime.appMessages.sendAppMessage,
        subscribeAppMessages: runtime.appMessages.subscribeAppMessages,
      }),
      artifacts: Object.freeze({
        readArtifactBytes: runtime.artifacts.readArtifactBytes,
        cleanupGeneratedVoiceArtifacts: runtime.artifacts.cleanupGeneratedVoiceArtifacts,
      }),
      materializeRealmSource: runtime.materializeRealmSource.bind(runtime),
    }),
    auth: Object.freeze({}),
    aiScenarioJobs: Object.freeze({
      submitScenarioJob: runtime.ai.submitScenarioJob,
      getScenarioJob: runtime.ai.getScenarioJob,
      cancelScenarioJob: runtime.ai.cancelScenarioJob,
      subscribeScenarioJobEvents: runtime.ai.subscribeScenarioJobEvents,
      getScenarioArtifacts: runtime.ai.getScenarioArtifacts,
    }),
    agentPurpose,
  });
}

export function withNimiDesktopFirstPartyProductCallOptions<T>(
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  return operation({});
}
