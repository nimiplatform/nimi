import type {
  PortableAIProfileRecord,
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { RuntimeTypedClient } from '../core-generated/runtime-typed-client';
import { CoreClient, type CoreTransport } from '../core-client';
import {
  createRuntime,
  type RuntimeMaterializeRealmSourceInput,
  type RuntimeMaterializeRealmSourceResult,
  type RuntimeOptions,
  type RuntimeTransportConfig,
} from './index';
import {
  RUNTIME_AGENT_METHODS,
  RUNTIME_AI_METHODS,
  type RuntimeMethodModule,
  type RuntimeTypedMethodName,
} from './runtime-method-modules.js';
import { createRuntimeElectronIpcTransport } from './electron-ipc';
import { createRuntimeTauriIpcTransport } from './tauri-ipc';
import type {
  DesktopAccountProductRuntimeMethods,
  DesktopMachineProductRuntimeMethods,
} from './first-party-protected-runtime-profiles.generated';
import type { NimiRuntimeAgentAuthClient } from './runtime-agent-protected';
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
  createNimiRuntimeAIModel,
  type NimiAiModel,
  type NimiRuntimeAIModelOptions,
} from '../core/ai';
import { assertRouteOnlyLocalAIConfigIntents } from '../core/ai/capability-configuration-local-intent.js';
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
  delete(profileId: string): Promise<void>;
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
    | 'getCatalogModelCard'
    | 'listFeaturedModelAssets'
    | 'listFactoryProfileRecommendations'
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
  // @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040a
  readonly apps: Pick<DesktopMachineProductRuntimeMethods,
    | 'listApprovedAppCatalogTargets'
    | 'startAppPackageInstall'
    | 'prepareLocalAppPackage'
    | 'getAppPackageInfo'
    | 'discardLocalAppPackage'
    | 'startLocalAppPackageInstall'
    | 'startLocalAppPackageUpdate'
    | 'startAppPackageUpdate'
    | 'startAppPackageUninstall'
    | 'listCommittedAppReleases'
    | 'listAppPackageJobs'
    | 'getAppPackageJob'
    | 'cancelAppPackageJob'
    | 'pauseAppPackageJob'
    | 'resumeAppPackageJob'
    | 'reorderAppPackageJob'>;
  readonly scheduling: Pick<DesktopMachineProductRuntimeMethods, 'peekScheduling'>;
};

export type NimiDesktopAccountProductRuntimeClient = {
  readonly audit: Pick<DesktopAccountProductRuntimeMethods,
    | 'getDesktopAIActivitySnapshot'
    | 'subscribeDesktopAIActivity'
    | 'listDesktopAICloudHistory'> & {
      readonly getDesktopAIUsageSummary: (request: Omit<Parameters<DesktopAccountProductRuntimeMethods['getDesktopAIUsageSummary']>[0], 'connectorRef'> & { readonly connectorRef?: string }, options?: RuntimeTypedCallOptions) => ReturnType<DesktopAccountProductRuntimeMethods['getDesktopAIUsageSummary']>;
    };
  readonly configurationReferences: Pick<DesktopAccountProductRuntimeMethods, 'listDesktopConnectorReferences'>;
  readonly appAIConfig: (appId: string) => NimiAppAIConfigClient;
  readonly profiles: NimiDesktopPortableAIProfileCatalogClient;
  readonly agents: Pick<DesktopAccountProductRuntimeMethods,
    | 'listAgents'
    | 'resolveDesktopAgentReference'
    | 'getAgent'
    | 'openConversationAnchor'
    | 'getConversationAnchorSnapshot'
    | 'listAgentConversationSummaries'
    | 'getPublicChatSessionSnapshot'
    | 'readConversationArtifact'
    | 'transcribeAgentVoiceInput'
    | 'getSharedLocalAgentAIConfig'
    | 'overwriteSharedLocalAgentAIConfig'
    | 'listSharedLocalAgentAIConfigOptions'
    | 'previewSharedLocalAgentAIProfile'
    | 'applySharedLocalAgentAIProfile'
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

export type NimiDesktopExternalAIHostModelOptions = Pick<
  NimiRuntimeAIModelOptions,
  'timeoutMs' | 'metadata' | 'reasoning'
>;

export type NimiDesktopExternalAIHostClient = {
  createTextModel(options?: NimiDesktopExternalAIHostModelOptions): NimiAiModel;
};

/** Exact Agent methods exercised by active Desktop product consumers. */
export type NimiDesktopRuntimeAgentPurposeClient =
  NimiDesktopAccountProductRuntimeClient['agents'];

export type NimiDesktopFirstPartyRuntimeClients = {
  readonly machineProduct: NimiDesktopMachineProductRuntimeClient;
  readonly accountProduct: NimiDesktopAccountProductRuntimeClient;
  readonly externalAIHost: NimiDesktopExternalAIHostClient;
  readonly auth: NimiRuntimeAgentAuthClient;
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

function protectedDesktopTransport(transport: RuntimeTransportConfig): CoreTransport {
  if ('unary' in transport && 'serverStream' in transport) return transport;
  if (transport.type === 'electron-ipc') return createRuntimeElectronIpcTransport(transport);
  if (transport.type === 'tauri-ipc') return createRuntimeTauriIpcTransport(transport);
  throw createNimiError({
    message: 'Desktop protected Runtime requires the verified native carrier.',
    reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
    actionHint: 'use_desktop_protected_runtime_carrier',
    source: 'sdk',
  });
}

function createProtectedDesktopTypedClient(transport: RuntimeTransportConfig): RuntimeTypedClient {
  return new RuntimeTypedClient(new CoreClient({
    transport: protectedDesktopTransport(transport),
    authMetadata: async () => ({
      protocolVersion: '1.0.0',
      participantProtocolVersion: '1.0.0',
      domain: 'runtime.rpc',
    }),
  }));
}

function bindProtectedRuntimeModule<const Keys extends readonly RuntimeTypedMethodName[]>(
  client: RuntimeTypedClient,
  keys: Keys,
): RuntimeMethodModule<Keys> {
  const module: Partial<Record<RuntimeTypedMethodName, unknown>> = {};
  for (const key of keys) {
    const method = client[key];
    if (typeof method !== 'function') {
      throw new Error(`Runtime generated client is missing protected method: ${key}`);
    }
    module[key] = method.bind(client);
  }
  return Object.freeze(module) as RuntimeMethodModule<Keys>;
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
  const protectedGenerated = createProtectedDesktopTypedClient(input.transport);
  // @nimi-authority: rule.nimi.sdks.client-core.home-ai-observation
  const accountAudit: NimiDesktopAccountProductRuntimeClient['audit'] = Object.freeze({
    getDesktopAIActivitySnapshot: (request, options) => protectedGenerated.getDesktopAIActivitySnapshot(
      validateHomeAIActivityRequest(request), options,
    ),
    subscribeDesktopAIActivity: (request, options) => protectedGenerated.subscribeDesktopAIActivity(
      validateHomeAIActivityRequest(request), options,
    ),
    getDesktopAIUsageSummary: (request, options) => protectedGenerated.getDesktopAIUsageSummary(
      validateHomeAIUsageRequest(request), options,
    ),
    listDesktopAICloudHistory: (request, options) => protectedGenerated.listDesktopAICloudHistory(validateCloudHistoryRequest(request), options),
  });
  const boundProtectedAgents = bindProtectedRuntimeModule(protectedGenerated, RUNTIME_AGENT_METHODS);
  const protectedAgents = Object.freeze({
    ...boundProtectedAgents,
    overwriteSharedLocalAgentAIConfig: async (
      request: Parameters<typeof boundProtectedAgents.overwriteSharedLocalAgentAIConfig>[0],
      options?: RuntimeTypedCallOptions,
    ) => {
      if (Array.isArray(request?.capabilities)) {
        assertRouteOnlyLocalAIConfigIntents(request.capabilities, invalidProtectedAIConfigMutation);
      }
      return boundProtectedAgents.overwriteSharedLocalAgentAIConfig(request, options);
    },
  });
  const boundProtectedAI = bindProtectedRuntimeModule(protectedGenerated, RUNTIME_AI_METHODS);
  const protectedAI = Object.freeze({
    ...boundProtectedAI,
    overwriteAppAIConfig: async (
      request: Parameters<typeof boundProtectedAI.overwriteAppAIConfig>[0],
      options?: RuntimeTypedCallOptions,
    ) => {
      if (Array.isArray(request?.config?.capabilities)) {
        assertRouteOnlyLocalAIConfigIntents(request.config.capabilities, invalidProtectedAIConfigMutation);
      }
      return boundProtectedAI.overwriteAppAIConfig(request, options);
    },
  });
  // @nimi-authority: rule.nimi.runtime.ai-provider.r125
  const externalAIHost: NimiDesktopExternalAIHostClient = Object.freeze({
    createTextModel(options = {}) {
      return createNimiRuntimeAIModel({
        ...options,
        appId: input.appId,
        getSubjectUserId: input.getSubjectUserId,
        runtime: {
          ai: {
            executeScenario: protectedAI.executeScenario,
            streamScenario: protectedAI.streamScenario,
          },
        },
      });
    },
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
    listAgents: protectedAgents.listAgents,
    resolveDesktopAgentReference: protectedAgents.resolveDesktopAgentReference,
    getAgent: protectedAgent(protectedAgents.getAgent),
    openConversationAnchor: protectedAgents.openConversationAnchor,
    getConversationAnchorSnapshot: protectedAgents.getConversationAnchorSnapshot,
    listAgentConversationSummaries: protectedAgents.listAgentConversationSummaries,
    getPublicChatSessionSnapshot: protectedAgents.getPublicChatSessionSnapshot,
    readConversationArtifact: (request, options) => (
      protectedAgents.readConversationArtifact({
        ...request,
        context: {
          appId: input.appId,
          subjectUserId: request.context?.subjectUserId ?? '',
          ownerUserId: request.context?.ownerUserId ?? '',
          runtimeSourceRef: request.context?.runtimeSourceRef ?? '',
          localAgentRef: request.context?.localAgentRef ?? '',
        },
      }, options)
    ),
    transcribeAgentVoiceInput: protectedAgent(protectedAgents.transcribeAgentVoiceInput),
    getSharedLocalAgentAIConfig: protectedAgents.getSharedLocalAgentAIConfig,
    overwriteSharedLocalAgentAIConfig: protectedAgents.overwriteSharedLocalAgentAIConfig,
    listSharedLocalAgentAIConfigOptions: protectedAgents.listSharedLocalAgentAIConfigOptions,
    previewSharedLocalAgentAIProfile: protectedAgents.previewSharedLocalAgentAIProfile,
    applySharedLocalAgentAIProfile: protectedAgents.applySharedLocalAgentAIProfile,
    getDelegatedControlSurfaceSnapshot: protectedAgent(protectedAgents.getDelegatedControlSurfaceSnapshot),
    getDelegatedReplayTrace: protectedAgent(protectedAgents.getDelegatedReplayTrace),
    submitDelegatedApprovalDecision: protectedAgent(protectedAgents.submitDelegatedApprovalDecision),
  });
  const agentPurpose: NimiDesktopRuntimeAgentPurposeClient = accountAgents;
  const appAIConfig = (appId: string): NimiAppAIConfigClient => createNimiAppAIConfigClient({
    appId,
    runtime: {
      ai: {
        getAppAIConfig: protectedAI.getAppAIConfig,
        overwriteAppAIConfig: protectedAI.overwriteAppAIConfig,
        listAppAIConfigOptions: protectedAI.listAppAIConfigOptions,
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
      const response = await protectedAgents.importPortableAIProfile({
        context: await profileContext(),
        profileJson: new TextEncoder().encode(serializeNimiPortableAIProfile(source)),
      }, withNimiRuntimeIdempotencyMetadata({}, createNimiClientId('portable-ai-profile-import')));
      return portableProfileRecord(response.profile);
    },
    async list() {
      const response = await protectedAgents.listPortableAIProfiles({ context: await profileContext() });
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
    async delete(profileId) {
      await protectedAgents.deletePortableAIProfile({
        context: await profileContext(),
        profileId,
      }, withNimiRuntimeIdempotencyMetadata({}, createNimiClientId('portable-ai-profile-delete')));
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
        getCatalogModelCard: runtime.local.getCatalogModelCard,
        listFeaturedModelAssets: runtime.local.listFeaturedModelAssets,
        listFactoryProfileRecommendations: runtime.local.listFactoryProfileRecommendations,
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
      apps: Object.freeze({
        listApprovedAppCatalogTargets: machineProductRuntime.listApprovedAppCatalogTargets,
          startAppPackageInstall: machineProductRuntime.startAppPackageInstall,
          prepareLocalAppPackage: machineProductRuntime.prepareLocalAppPackage,
          getAppPackageInfo: machineProductRuntime.getAppPackageInfo,
          discardLocalAppPackage: machineProductRuntime.discardLocalAppPackage,
          startLocalAppPackageInstall: machineProductRuntime.startLocalAppPackageInstall,
          startLocalAppPackageUpdate: machineProductRuntime.startLocalAppPackageUpdate,
          startAppPackageUpdate: machineProductRuntime.startAppPackageUpdate,
          startAppPackageUninstall: machineProductRuntime.startAppPackageUninstall,
        listCommittedAppReleases: machineProductRuntime.listCommittedAppReleases,
        listAppPackageJobs: machineProductRuntime.listAppPackageJobs,
        getAppPackageJob: machineProductRuntime.getAppPackageJob,
        cancelAppPackageJob: machineProductRuntime.cancelAppPackageJob,
        pauseAppPackageJob: machineProductRuntime.pauseAppPackageJob,
        resumeAppPackageJob: machineProductRuntime.resumeAppPackageJob,
        reorderAppPackageJob: machineProductRuntime.reorderAppPackageJob,
      }),
      scheduling: Object.freeze({
        peekScheduling: runtime.scheduling.peekScheduling,
      }),
    }),
    accountProduct: Object.freeze({
      audit: accountAudit,
      configurationReferences: Object.freeze({
        listDesktopConnectorReferences: (request: Parameters<DesktopAccountProductRuntimeMethods['listDesktopConnectorReferences']>[0], options?: RuntimeTypedCallOptions) => protectedGenerated.listDesktopConnectorReferences(validateConnectorReferencesRequest(request), options),
      }),
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
    externalAIHost,
    auth: Object.freeze({}),
    agentPurpose,
  });
}

function invalidProtectedAIConfigMutation(message: string): never {
  throw createNimiError({
    message,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint: 'provide_route_only_local_ai_config_intent',
    source: 'sdk',
  });
}

function exactHomeAIRequest(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) {
    return invalidHomeAIRequest(`${name} must contain only ${keys.join(', ')}.`);
  }
  return value as Record<string, unknown>;
}

function validateHomeAIActivityRequest(request: { readonly limit: number }): { limit: number } {
  const value = exactHomeAIRequest(request, ['limit'], 'Home AI activity request');
  if (!Number.isInteger(value.limit) || Number(value.limit) < 0 || Number(value.limit) > 100) {
    return invalidHomeAIRequest('Home AI activity limit must be an integer from 0 through 100; 0 uses the Runtime default.');
  }
  return { limit: value.limit as number };
}

function homeAITimestamp(value: unknown): { seconds: string; nanos: number } {
  const timestamp = exactHomeAIRequest(value, ['seconds', 'nanos'], 'Home AI usage timestamp');
  if (typeof timestamp.seconds !== 'string' || !/^-?\d{1,19}$/u.test(timestamp.seconds)
    || !Number.isInteger(timestamp.nanos) || Number(timestamp.nanos) < 0 || Number(timestamp.nanos) > 999_999_999) {
    return invalidHomeAIRequest('Home AI usage timestamps require integer seconds and valid nanoseconds.');
  }
  return { seconds: timestamp.seconds, nanos: timestamp.nanos as number };
}

function validateHomeAIUsageRequest(request: Parameters<NimiDesktopAccountProductRuntimeClient['audit']['getDesktopAIUsageSummary']>[0]) {
  const value = exactHomeAIRequest(request, ['fromTime', 'toTime', 'connectorRef'], 'Home AI usage request');
  const fromTime = homeAITimestamp(value.fromTime);
  const toTime = homeAITimestamp(value.toTime);
  const fromNanos = BigInt(fromTime.seconds) * 1_000_000_000n + BigInt(fromTime.nanos);
  const toNanos = BigInt(toTime.seconds) * 1_000_000_000n + BigInt(toTime.nanos);
  if (fromNanos >= toNanos || toNanos - fromNanos > 7n * 24n * 60n * 60n * 1_000_000_000n) {
    return invalidHomeAIRequest('Home AI usage requires a non-empty half-open interval no longer than seven days.');
  }
  return { fromTime, toTime, connectorRef: homeConnectionRef(value.connectorRef ?? '') };
}

function homeConnectionRef(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || value.trim() !== value) return invalidHomeAIRequest('Invalid connection reference.');
  return value;
}

function boundedHomePage(value: Record<string, unknown>, maximum: number) {
  if (!Number.isInteger(value.pageSize) || Number(value.pageSize) < 0 || Number(value.pageSize) > maximum || typeof value.pageToken !== 'string' || value.pageToken.length > 2048) return invalidHomeAIRequest('Invalid bounded page request.');
  return { pageSize: value.pageSize as number, pageToken: value.pageToken };
}

function validateConnectorReferencesRequest(request: Parameters<DesktopAccountProductRuntimeMethods['listDesktopConnectorReferences']>[0]) {
  const value = exactHomeAIRequest(request, ['connectorRef', 'pageSize', 'pageToken'], 'Home connection reference request');
  const connectorRef = homeConnectionRef(value.connectorRef);
  if (!connectorRef) return invalidHomeAIRequest('Connection reference is required.');
  return { connectorRef, ...boundedHomePage(value, 200) };
}

function validateCloudHistoryRequest(request: Parameters<DesktopAccountProductRuntimeMethods['listDesktopAICloudHistory']>[0]) {
  const value = exactHomeAIRequest(request, ['fromTime', 'toTime', 'connectorRef', 'pageSize', 'pageToken'], 'Home cloud history request');
  const window = validateHomeAIUsageRequest({ fromTime: homeAITimestamp(value.fromTime), toTime: homeAITimestamp(value.toTime), connectorRef: homeConnectionRef(value.connectorRef) });
  return { ...window, ...boundedHomePage(value, 100) };
}

function invalidHomeAIRequest(message: string): never {
  throw createNimiError({
    message,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint: 'provide_bounded_home_ai_observation_request',
    source: 'sdk',
  });
}

export function withNimiDesktopFirstPartyProductCallOptions<T>(
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  return operation({});
}
