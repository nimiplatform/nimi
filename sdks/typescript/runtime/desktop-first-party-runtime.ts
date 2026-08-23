import type {
  PortableAIProfileRecord,
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
import type { NimiRuntimeAgentAuthClient } from './runtime-agent-protected';
import type { NimiRuntimeScenarioJobClient } from './scenario-jobs';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';
import {
  createNimiMachineLoadoutClient,
  type NimiMachineLoadoutClient,
} from './machine-loadouts.js';
import { createNimiClientId, createNimiError, extractNimiErrorFields, ReasonCode } from '../types/index.js';
import {
  createNimiAppAIConfigClient,
  type NimiAppAIConfigClient,
} from '../core/ai/capability-configuration';
import {
  parseNimiPortableAIProfile,
  serializeNimiPortableAIProfile,
  type NimiPortableAIProfile,
  type NimiPortableAIProfileInput,
} from '../core/ai/config-profile';

export type NimiDesktopPortableAIProfileCatalogRecord = {
  readonly source: NimiPortableAIProfile;
  readonly artifactJson: string;
  readonly record: PortableAIProfileRecord;
};

export type NimiDesktopPortableAIProfileCatalogClient = {
  import(profile: NimiPortableAIProfileInput): Promise<NimiDesktopPortableAIProfileCatalogRecord>;
  list(): Promise<readonly NimiDesktopPortableAIProfileCatalogRecord[]>;
};

export type NimiDesktopMachineProductRuntimeClient = {
  readonly local: Pick<DesktopMachineProductRuntimeMethods,
    | 'collectDeviceProfile'
    | 'resolveLocalEnvironmentPlan'
    | 'applyLocalEnvironmentPlan'
    | 'listLocalEnvironmentDependencyJobs'
    | 'startLocalEnvironmentDependencyJob'
    | 'cancelLocalEnvironmentDependencyJob'
    | 'retryLocalEnvironmentDependencyJob'
    | 'repairLocalEnvironmentDependency'
    | 'importModelAsset'
    | 'listModelAssets'
    | 'getModelAsset'
    | 'removeModelAsset'
    | 'listVerifiedAssets'
    | 'searchCatalogModels'
    | 'listCatalogVariants'
    | 'getRecommendationFeed'
    | 'resolveModelInstallPlan'
    | 'installModelFromPlan'
    | 'listLocalTransfers'
    | 'pauseLocalTransfer'
    | 'resumeLocalTransfer'
    | 'cancelLocalTransfer'
    | 'watchLocalTransfers'
    | 'listLocalAudits'> & {
      readonly loadouts: NimiMachineLoadoutClient;
    };
  readonly connectors: Pick<DesktopMachineProductRuntimeMethods,
    | 'listConnectors'
    | 'listProviderCatalog'>;
  readonly audit: Pick<DesktopMachineProductRuntimeMethods,
    | 'getRuntimeHealth'
    | 'listDesktopAuditEvents'
    | 'listUsageStats'
    | 'subscribeRuntimeHealthEvents'>;
  readonly externalAgents: Pick<DesktopMachineProductRuntimeMethods,
    | 'getExternalAgentGatewayStatus'
    | 'issueExternalAgentToken'
    | 'revokeExternalAgentToken'
    | 'listExternalAgentTokens'>;
  readonly scheduling: Pick<DesktopMachineProductRuntimeMethods, 'peekScheduling'>;
};

export type NimiDesktopAccountProductRuntimeClient = {
  readonly appAIConfig: (appId: string) => NimiAppAIConfigClient;
  readonly profiles: NimiDesktopPortableAIProfileCatalogClient;
  readonly agents: Pick<DesktopAccountProductRuntimeMethods,
    | 'listAgents'
    | 'getAgent'
    | 'openConversationAnchor'
    | 'getConversationAnchorSnapshot'
    | 'listAgentConversationSummaries'
    | 'getPublicChatSessionSnapshot'
    | 'transcribeAgentVoiceInput'
    | 'registerAvatarLiveInstanceBinding'
    | 'resolveAvatarLiveInstanceBinding'
    | 'setAgentPresentationProfile'
    | 'getSharedLocalAgentAIConfig'
    | 'overwriteSharedLocalAgentAIConfig'
    | 'listSharedLocalAgentAIConfigOptions'
    | 'previewSharedLocalAgentAIProfile'
    | 'applySharedLocalAgentAIProfile'
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
    | 'submitDelegatedApprovalDecision'>;
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
    | 'cleanupGeneratedVoiceArtifacts'
    | 'putArtifact'>;
  readonly materializeRealmSource: (
    input: RuntimeMaterializeRealmSourceInput,
  ) => Promise<RuntimeMaterializeRealmSourceResult>;
};

/** Exact Desktop Scenario execution methods exercised by active product consumers. */
export type NimiDesktopRuntimeAiExecutionClient = NimiRuntimeScenarioJobClient
  & Pick<DesktopAccountProductRuntimeMethods,
    | 'executeScenario'
    | 'streamScenario'
    | 'listPresetVoices'
    | 'listVoiceAssets'>;

/** Exact Agent methods exercised by active Desktop product consumers. */
export type NimiDesktopRuntimeAgentPurposeClient =
  NimiDesktopAccountProductRuntimeClient['agents'];

export type NimiDesktopFirstPartyRuntimeClients = {
  readonly machineProduct: NimiDesktopMachineProductRuntimeClient;
  readonly accountProduct: NimiDesktopAccountProductRuntimeClient;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly aiExecution: NimiDesktopRuntimeAiExecutionClient;
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
  const machineProductRuntime = runtime.desktopMachineProduct;
  if (!machineProductRuntime) {
    throw createNimiError({
      message: 'Desktop machine product Runtime profile is unavailable.',
      reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
      actionHint: 'create_host_owned_desktop_runtime_client',
      source: 'sdk',
    });
  }
  const machineLoadouts = createNimiMachineLoadoutClient({
    runtime: machineProductRuntime,
  });
  const protectedAgent = <T extends RuntimeOperation>(operation: T): T => (
    bindProtectedAccountAgentOperation(operation, input.appId)
  );
  const accountAgents: NimiDesktopAccountProductRuntimeClient['agents'] = Object.freeze({
    listAgents: runtime.agents.listAgents,
    getAgent: protectedAgent(runtime.agents.getAgent),
    openConversationAnchor: runtime.agents.openConversationAnchor,
    getConversationAnchorSnapshot: runtime.agents.getConversationAnchorSnapshot,
    listAgentConversationSummaries: runtime.agents.listAgentConversationSummaries,
    getPublicChatSessionSnapshot: runtime.agents.getPublicChatSessionSnapshot,
    transcribeAgentVoiceInput: protectedAgent(runtime.agents.transcribeAgentVoiceInput),
    registerAvatarLiveInstanceBinding: runtime.agents.registerAvatarLiveInstanceBinding,
    resolveAvatarLiveInstanceBinding: runtime.agents.resolveAvatarLiveInstanceBinding,
    setAgentPresentationProfile: runtime.agents.setAgentPresentationProfile,
    getSharedLocalAgentAIConfig: runtime.agents.getSharedLocalAgentAIConfig,
    overwriteSharedLocalAgentAIConfig: runtime.agents.overwriteSharedLocalAgentAIConfig,
    listSharedLocalAgentAIConfigOptions: runtime.agents.listSharedLocalAgentAIConfigOptions,
    previewSharedLocalAgentAIProfile: runtime.agents.previewSharedLocalAgentAIProfile,
    applySharedLocalAgentAIProfile: runtime.agents.applySharedLocalAgentAIProfile,
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
    submitDelegatedApprovalDecision: protectedAgent(runtime.agents.submitDelegatedApprovalDecision),
  });
  const agentPurpose: NimiDesktopRuntimeAgentPurposeClient = accountAgents;
  const appAIConfig = (appId: string): NimiAppAIConfigClient => createNimiAppAIConfigClient({
    appId,
    runtime: {
      ai: {
        getAppAIConfig: runtime.ai.getAppAIConfig,
        overwriteAppAIConfig: runtime.ai.overwriteAppAIConfig,
        listAppAIConfigOptions: runtime.ai.listAppAIConfigOptions,
      },
    },
  });
  const profileContext = async () => {
    const subjectUserId = String(await input.getSubjectUserId?.() || '').trim();
    if (!subjectUserId) {
      throw createNimiError({
        message: 'Portable AIProfile catalog requires an authenticated account.',
        reasonCode: ReasonCode.SDK_RUNTIME_APP_AUTH_SUBJECT_USER_ID_REQUIRED,
        actionHint: 'authenticate_runtime_account',
        source: 'sdk',
      });
    }
    return {
      appId: input.appId,
      subjectUserId,
      ownerUserId: subjectUserId,
      runtimeSourceRef: '',
      localAgentRef: '',
    };
  };
  const portableProfileRecord = (record: PortableAIProfileRecord | undefined): NimiDesktopPortableAIProfileCatalogRecord => {
    if (!record?.profileJson?.length) {
      throw createNimiError({
        message: 'Portable AIProfile catalog returned an invalid record.',
        reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
        actionHint: 'inspect_runtime_ai_profile_catalog',
        source: 'runtime',
      });
    }
    const artifactJson = new TextDecoder().decode(record.profileJson);
    const source = parseNimiPortableAIProfile(artifactJson);
    if (source.profileId !== record.profileId || source.title !== record.title) {
      throw createNimiError({
        message: 'Portable AIProfile catalog record identity does not match its document.',
        reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
        actionHint: 'inspect_runtime_ai_profile_catalog',
        source: 'runtime',
      });
    }
    return Object.freeze({ source, artifactJson, record });
  };
  // @nimi-authority: rule.nimi.runtime.local-compute.r028
  const profiles: NimiDesktopPortableAIProfileCatalogClient = Object.freeze({
    async import(profile) {
      const source = parseNimiPortableAIProfile(profile);
      const response = await runtime.agents.importPortableAIProfile({
        context: await profileContext(),
        profileJson: new TextEncoder().encode(serializeNimiPortableAIProfile(source)),
      }, withNimiRuntimeIdempotencyMetadata({}, createNimiClientId('portable-ai-profile-import')));
      return portableProfileRecord(response.profile);
    },
    async list() {
      const response = await runtime.agents.listPortableAIProfiles({ context: await profileContext() });
      const isolated: NimiDesktopPortableAIProfileCatalogRecord[] = [];
      for (const record of response.profiles) {
        try {
          isolated.push(portableProfileRecord(record));
        } catch (error) {
          const reason = extractNimiErrorFields(error).reasonCode;
          if (reason !== 'AI_PROFILE_INVALID' && reason !== ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED) throw error;
          // A malformed persisted sibling is not allowed to hide healthy Profile records.
        }
      }
      return Object.freeze(isolated);
    },
  });
  return Object.freeze({
    machineProduct: Object.freeze({
      local: Object.freeze({
        collectDeviceProfile: runtime.local.collectDeviceProfile,
        resolveLocalEnvironmentPlan: runtime.local.resolveLocalEnvironmentPlan,
        applyLocalEnvironmentPlan: runtime.local.applyLocalEnvironmentPlan,
        listLocalEnvironmentDependencyJobs: runtime.local.listLocalEnvironmentDependencyJobs,
        startLocalEnvironmentDependencyJob: runtime.local.startLocalEnvironmentDependencyJob,
        cancelLocalEnvironmentDependencyJob: runtime.local.cancelLocalEnvironmentDependencyJob,
        retryLocalEnvironmentDependencyJob: runtime.local.retryLocalEnvironmentDependencyJob,
        repairLocalEnvironmentDependency: runtime.local.repairLocalEnvironmentDependency,
        importModelAsset: runtime.local.importModelAsset,
        listModelAssets: runtime.local.listModelAssets,
        getModelAsset: runtime.local.getModelAsset,
        removeModelAsset: runtime.local.removeModelAsset,
        listVerifiedAssets: runtime.local.listVerifiedAssets,
        searchCatalogModels: runtime.local.searchCatalogModels,
        listCatalogVariants: runtime.local.listCatalogVariants,
        getRecommendationFeed: runtime.local.getRecommendationFeed,
        resolveModelInstallPlan: runtime.local.resolveModelInstallPlan,
        installModelFromPlan: runtime.local.installModelFromPlan,
        listLocalTransfers: runtime.local.listLocalTransfers,
        pauseLocalTransfer: runtime.local.pauseLocalTransfer,
        resumeLocalTransfer: runtime.local.resumeLocalTransfer,
        cancelLocalTransfer: runtime.local.cancelLocalTransfer,
        watchLocalTransfers: runtime.local.watchLocalTransfers,
        listLocalAudits: runtime.local.listLocalAudits,
        loadouts: machineLoadouts,
      }),
      connectors: Object.freeze({
        listConnectors: machineIntentRuntime.connectors.listConnectors,
        listProviderCatalog: runtime.connectors.listProviderCatalog,
      }),
      audit: Object.freeze({
        getRuntimeHealth: runtime.audit.getRuntimeHealth,
        listDesktopAuditEvents: runtime.audit.listDesktopAuditEvents,
        listUsageStats: runtime.audit.listUsageStats,
        subscribeRuntimeHealthEvents: runtime.audit.subscribeRuntimeHealthEvents,
      }),
      externalAgents: Object.freeze({
        getExternalAgentGatewayStatus: runtime.externalAgents.getExternalAgentGatewayStatus,
        issueExternalAgentToken: runtime.externalAgents.issueExternalAgentToken,
        revokeExternalAgentToken: runtime.externalAgents.revokeExternalAgentToken,
        listExternalAgentTokens: runtime.externalAgents.listExternalAgentTokens,
      }),
      scheduling: Object.freeze({
        peekScheduling: runtime.scheduling.peekScheduling,
      }),
    }),
    accountProduct: Object.freeze({
      appAIConfig,
      profiles,
      agents: accountAgents,
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
        putArtifact: runtime.artifacts.putArtifact,
      }),
      materializeRealmSource: runtime.materializeRealmSource.bind(runtime),
    }),
    auth: Object.freeze({}),
    aiExecution: Object.freeze({
      executeScenario: runtime.ai.executeScenario,
      streamScenario: runtime.ai.streamScenario,
      submitScenarioJob: runtime.ai.submitScenarioJob,
      getScenarioJob: runtime.ai.getScenarioJob,
      cancelScenarioJob: runtime.ai.cancelScenarioJob,
      subscribeScenarioJobEvents: runtime.ai.subscribeScenarioJobEvents,
      getScenarioArtifacts: runtime.ai.getScenarioArtifacts,
      listPresetVoices: runtime.ai.listPresetVoices,
      listVoiceAssets: runtime.ai.listVoiceAssets,
    }),
    agentPurpose,
  });
}

export function withNimiDesktopFirstPartyProductCallOptions<T>(
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  return operation({});
}
