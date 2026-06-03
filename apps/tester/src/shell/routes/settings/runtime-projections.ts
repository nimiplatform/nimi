import {
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  selectFactoryAIProfileForFirstRun,
} from '@nimiplatform/sdk/platform-catalog';
import {
  parseAccountAppLibraryRecord,
  parseNimiAppBridgeProjection,
} from '@nimiplatform/sdk/app';
import {
  AgentCanonicalMemoryBankMode,
  aggregateMaterializationDownloadProgress,
  buildLocalRuntimeImageNativeEnvironmentPlanPayload,
  buildRuntimeAgentRequestContext,
  buildRuntimeAgentSnapshotRecoveryEvents,
  buildRuntimeRequestMetadata,
  buildRuntimeTargetCallOptions,
  bridgeLocalRuntimeProfile,
  CallerKind,
  createEmptyMemoryEmbeddingConfig,
  extractRuntimeReasonCodeFromError,
  findRuntimeRouteModelProfile,
  fromProtoStruct,
  getRuntimeReasonCodeDefaultMessage,
  isLocalRuntimeEnvironmentDependencyJobActiveState,
  isLocalRuntimeEnvironmentDependencyJobRetryableState,
  isLocalRuntimeEnvironmentDependencyJobTransferringState,
  isLocalRuntimeEnvironmentDependencyRepairRequiredState,
  isLocalRuntimeEnvironmentDependencyStartableState,
  isRuntimeAgentProjectionEvent,
  isRuntimeRouteLocalOptionSelectable,
  localRecommendationTierToRunGrade,
  matchesRuntimeAgentProjectionScope,
  mapRuntimeErrorToLocalAiReasonCode,
  normalizeLocalRecommendationFeedCacheStateId,
  normalizeLocalRuntimeProfilesDeclaration,
  normalizeRuntimeReasonCode,
  parseLocalRecommendationFeedSourceId,
  parseLocalRuntimeEnvironmentDependencyJobProjection,
  parseLocalRuntimeEnvironmentPlanProjection,
  parseLocalRuntimeExecutionPlan,
  parseLocalRuntimeNodeDescriptor,
  parseLocalRuntimeServiceDescriptor,
  parseRuntimeLocalRecommendationFeedDescriptor,
  productStateForMaterializationStatus,
  projectMemoryEmbeddingRouteAvailability,
  projectRuntimeAgentCanonicalMemoryBankStatus,
  projectRuntimeAuditCallerKindName,
  projectRuntimeHealthStatusName,
  projectRuntimeHealthSummary,
  projectRuntimeLocalAgentIdentity,
  projectRuntimeRouteCapabilityCoverage,
  projectRuntimeUsageWindowName,
  repairableFirstRunMaterializationDependencies,
  resolveRuntimeRouteReasoningConfig,
  resolveRuntimeTextRouteReasoningSupport,
  retryableInterruptedFirstRunMaterializationJobs,
  runtimeRouteBindingsMatch,
  runtimeRouteLocalOptionToBinding,
  RuntimeHealthStatus,
  RuntimeReasonCode,
  summarizeLocalRecommendationFeedCacheState,
  summarizeRuntimeAgentProjectionEvent,
  summarizeRuntimeAgentTimeline,
  toCanonicalLocalRuntimeAssetId,
  toCanonicalLocalRuntimeAssetLookupKey,
  toIsoFromTimestamp,
  toProtoStruct,
  toRuntimeUserFacingError,
  UsageWindow,
  type RuntimeAgentConsumeEvent,
  type RuntimeResolvedBinding,
  type RuntimeRouteDescribeResult,
} from '@nimiplatform/sdk/runtime';
import { classifyOfflineError, classifyOfflineReasonCode, createOfflineNimiError, extractNimiErrorFields, ReasonCode } from '@nimiplatform/sdk/types';
import { pickerSelectionToBinding, summarizeBinding } from '@nimiplatform/kit/features/model-config/headless';
import { createTesterExternalAgentProjection } from '../../../tester/tester-external-agent-projection';
import { createTesterMemoryEmbeddingRuntimeProjection } from '../../../tester/tester-memory-embedding-runtime-projection';
import { createTesterRuntimeAgentPresentationProfileProjection } from '../../../tester/tester-runtime-agent-presentation-profile';
import { createTesterRuntimeAgentInspectProjection } from '../../../tester/tester-runtime-agent-inspect-projection';
import { createTesterLocalRecommendationCopyProjection } from '../../../tester/tester-local-recommendation-copy-projection';
import { createTesterLocalRuntimeAssetKindProjection } from '../../../tester/tester-local-runtime-asset-kind-projection';
import { createTesterRuntimeConfigProjection } from '../../../tester/tester-runtime-config-projection';
import { runtimeHealthCoordinatorDiagnostics } from './fixtures';

export function createTesterSettingsRuntimeProjections() {
  const recommendationFeedProjection = {
    cacheState: summarizeLocalRecommendationFeedCacheState({
      cacheState: normalizeLocalRecommendationFeedCacheStateId('LOCAL_RECOMMENDATION_FEED_CACHE_STATE_FRESH'),
    }),
    source: parseLocalRecommendationFeedSourceId('LOCAL_RECOMMENDATION_FEED_SOURCE_MODEL_INDEX') ?? 'unknown',
    grade: localRecommendationTierToRunGrade('LOCAL_RECOMMENDATION_TIER_RUNNABLE'),
  };
  const recommendationFeedParserProjection = parseRuntimeLocalRecommendationFeedDescriptor({
    deviceProfile: { surface: 'tester.settings' },
    activeCapability: 'LOCAL_RECOMMENDATION_FEED_CAPABILITY_IMAGE',
    cacheState: 'LOCAL_RECOMMENDATION_FEED_CACHE_STATE_STALE',
    items: [{
      itemId: 'tester-image',
      source: 'LOCAL_RECOMMENDATION_FEED_SOURCE_MODEL_INDEX',
      repo: 'tester/image-model',
      title: 'Tester Image',
      preferredEngine: 'media',
      installPayload: {
        modelId: 'tester/image-model',
        kind: 'LOCAL_ASSET_KIND_IMAGE',
        repo: 'tester/image-model',
      },
    }],
  }, (value: unknown) => value as { surface: string });
  const recommendationCopyProjection = createTesterLocalRecommendationCopyProjection();
  const runtimeReasonProjection = {
    reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
    message: getRuntimeReasonCodeDefaultMessage(ReasonCode.AI_PROVIDER_TIMEOUT) ?? 'unknown',
    credentialMissing: getRuntimeReasonCodeDefaultMessage(ReasonCode.AI_CONNECTOR_CREDENTIAL_MISSING) ?? 'unknown',
    numeric: normalizeRuntimeReasonCode(351) || 'unknown',
    extracted: extractRuntimeReasonCodeFromError(new Error('runtime failed: reason=411')) ?? 'unknown',
    presented: toRuntimeUserFacingError({
      reasonCode: ReasonCode.AI_STREAM_BROKEN,
      actionHint: 'retry stream request',
      message: 'retry stream request',
      traceId: 'tester-runtime-user-facing',
      retryable: true,
      source: 'runtime',
    }, {
      fallbackMessage: 'Tester runtime call failed',
    }).message,
    traceId: extractNimiErrorFields({
      reason_code: ReasonCode.RUNTIME_CALL_FAILED,
      action_hint: 'retry_runtime_call',
      trace_id: 'tester-runtime-trace',
      retryable: true,
    }).traceId ?? 'unknown',
  };
  const runtimeLocalAgentIdentityProjection = projectRuntimeLocalAgentIdentity({
    ownerUserId: 'tester-owner',
    realmAgentId: 'tester-realm-agent',
  });
  const runtimeAgentRequestContextProjection = buildRuntimeAgentRequestContext({
    runtimeAppId: 'tester',
    subjectUserId: 'tester-owner',
    localAgentRef: runtimeLocalAgentIdentityProjection.localAgentRef,
  });
  const offlineReasonProjection = {
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    owner: classifyOfflineReasonCode(ReasonCode.RUNTIME_UNAVAILABLE) ?? 'unknown',
    errorOwner: classifyOfflineError(createOfflineNimiError({
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: 'retry_realm_request',
      message: 'Realm unavailable in Tester offline projection',
      source: 'realm',
    })) ?? 'unknown',
  };
  const runtimeDependencyStateProjection = {
    dependencyStartable: isLocalRuntimeEnvironmentDependencyStartableState('needs_confirmation'),
    jobActive: isLocalRuntimeEnvironmentDependencyJobActiveState('downloading'),
    jobRetryable: isLocalRuntimeEnvironmentDependencyJobRetryableState('failed'),
    jobTransferring: isLocalRuntimeEnvironmentDependencyJobTransferringState('verifying'),
    dependencyRepairRequired: isLocalRuntimeEnvironmentDependencyRepairRequiredState('repair_required'),
  };
  const runtimeDependencyPlanProjection = parseLocalRuntimeEnvironmentPlanProjection({
    planId: 'tester-plan',
    packId: 'tester-local-speech',
    productLabel: 'Tester Local Speech',
    hostProfileId: 'tester-host',
    platformTuple: 'darwin-arm64',
    state: 'needs_confirmation',
    dependencies: [{
      dependencyFamily: 'python',
      dependencyId: 'tester-python',
      required: true,
      state: 'needs_confirmation',
      sourceKind: 'managed_download',
      confirmationRequired: true,
      environmentKey: 'tester-local-speech',
      reasonCode: ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
    }],
  });
  const runtimeDependencyJobProjection = parseLocalRuntimeEnvironmentDependencyJobProjection({
    jobId: 'tester-job',
    environmentKey: 'tester-local-speech',
    dependencyFamily: 'python',
    dependencyId: 'tester-python',
    state: 'downloading',
    sourceKind: 'managed_download',
    retryable: true,
    bytesReceived: '512',
    bytesTotal: '1024',
    percent: 50,
    speedBytesPerSec: '256',
    etaSeconds: '2',
  });
  const firstRunProfileProjection = {
    minimal: selectFactoryAIProfileForFirstRun(PLATFORM_AI_PROFILE_FACTORY_ROWS, 'minimal')?.alias ?? 'none',
    recommended: selectFactoryAIProfileForFirstRun(PLATFORM_AI_PROFILE_FACTORY_ROWS, 'recommended')?.alias ?? 'none',
  };
  const runtimeDependencyPlanItem = runtimeDependencyPlanProjection.dependencies[0]!;
  const runtimeFirstRunDependency = {
    ...runtimeDependencyPlanItem,
    dependencyFamily: 'model.asset',
    state: 'needs_confirmation',
  };
  const runtimeFirstRunFailedJob = {
    ...runtimeDependencyJobProjection,
    dependencyFamily: 'model.asset',
    state: 'failed',
    failureDetail: 'unexpected eof while reading body',
    recoveryDisposition: 'auto_retry_transient',
  };
  const runtimeFirstRunMaterializationProjection = {
    status: 'failed' as const,
    productState: productStateForMaterializationStatus('failed'),
    reason: 'runtime_materialization_job_failed',
    missingDependencyFamilies: [],
    dependencies: [{
      packId: runtimeDependencyPlanProjection.packId,
      dependency: runtimeFirstRunDependency,
      job: runtimeFirstRunFailedJob,
    }],
  };
  const runtimeFirstRunRepairProjection = {
    ...runtimeFirstRunMaterializationProjection,
    status: 'repair_required' as const,
    productState: productStateForMaterializationStatus('repair_required'),
    reason: 'runtime_materialization_repair_required',
    dependencies: [{
      packId: runtimeDependencyPlanProjection.packId,
      dependency: { ...runtimeFirstRunDependency, state: 'repair_required' },
      job: null,
    }],
  };
  const runtimeFirstRunMaterializationProgress = aggregateMaterializationDownloadProgress([{
    packId: runtimeDependencyPlanProjection.packId,
    dependency: runtimeFirstRunDependency,
    job: runtimeDependencyJobProjection,
  }]);
  const runtimeFirstRunMaterializationSummary = {
    retryableJobs: retryableInterruptedFirstRunMaterializationJobs(runtimeFirstRunMaterializationProjection).length,
    repairableDependencies: repairableFirstRunMaterializationDependencies(runtimeFirstRunRepairProjection).length,
    productState: runtimeFirstRunMaterializationProjection.productState,
    recoveryDisposition: runtimeFirstRunFailedJob.recoveryDisposition,
    percent: runtimeFirstRunMaterializationProgress?.percent ?? null,
  };
  const localRuntimeAssetIdProjection = { assetId: toCanonicalLocalRuntimeAssetId('local/tester-model'), lookupKey: toCanonicalLocalRuntimeAssetLookupKey('LOCAL/Tester-Model') };
  const localRuntimeAssetKindProjection = createTesterLocalRuntimeAssetKindProjection();
  const runtimeConfigProjection = createTesterRuntimeConfigProjection();
  const runtimeTargetCallOptionsProjection = buildRuntimeTargetCallOptions({
    targetId: 'tester.settings.runtime-route',
    timeoutMs: 5000,
    callerKind: 'third-party-app',
    surfaceId: 'tester.settings',
    connectorId: 'tester-cloud',
    createTraceId: (prefix = 'tester-runtime') => `${prefix}-trace`,
  });
  const runtimeRequestMetadataProjection = buildRuntimeRequestMetadata({
    connectorId: 'tester-cloud',
    createTraceId: (prefix = 'tester-metadata') => `${prefix}-trace`,
  });
  const runtimeLocalAiReasonProjection = mapRuntimeErrorToLocalAiReasonCode({
    reasonCode: ReasonCode.AI_STREAM_BROKEN,
  }) ?? 'unknown';
  const memoryEmbeddingConfig = {
    ...createEmptyMemoryEmbeddingConfig({
      kind: 'feature',
      ownerId: 'tester',
      surfaceId: 'settings-memory-embedding',
    }),
    sourceKind: 'cloud' as const,
    bindingRef: {
      kind: 'cloud' as const,
      connectorId: 'tester-cloud',
      modelId: 'tester-embedding',
    },
  };
  const memoryEmbeddingRouteProjection = projectMemoryEmbeddingRouteAvailability({
    config: memoryEmbeddingConfig,
    routeOptions: {
      capability: 'text.embed',
      selected: null,
      local: { models: [] },
      connectors: [{
        id: 'tester-cloud',
        label: 'Tester Cloud',
        provider: 'tester',
        models: ['tester-embedding'],
      }],
    },
  });
  const runtimeAgentMemoryProjection = projectRuntimeAgentCanonicalMemoryBankStatus({
    mode: AgentCanonicalMemoryBankMode.STANDARD,
    bankId: 'tester-agent-bank',
    embeddingProfile: {
      provider: 'tester',
      modelId: 'tester-embedding',
      version: 'v1',
      dimension: 768,
      distanceMetric: 1,
      migrationPolicy: 1,
    },
    bindingSourceKind: 'cloud',
    blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    pendingCutover: false,
    canonicalBankStatus: 'bound_equivalent',
    bindAllowed: false,
    cutoverAllowed: false,
  });
  const memoryEmbeddingRuntimeProjection = createTesterMemoryEmbeddingRuntimeProjection();
  const runtimeAgentInspectProjection = createTesterRuntimeAgentInspectProjection();
  const runtimeAgentPresentationProfileProjection = createTesterRuntimeAgentPresentationProfileProjection();
  const externalAgentProjection = createTesterExternalAgentProjection();
  const runtimeRouteModelProfileProjection = findRuntimeRouteModelProfile({
    capability: 'text.generate',
    selected: null,
    local: { models: [] },
    connectors: [{
      id: 'tester-cloud',
      label: 'Tester Cloud',
      provider: 'tester',
      models: ['tester-text'],
      modelProfiles: [{
        model: 'tester-text',
        maxContextTokens: 32000,
        maxOutputTokens: 2048,
        contextSource: 'provider-api',
      }],
    }],
  }, {
    source: 'cloud',
    connectorId: 'tester-cloud',
    model: 'tester-text',
  });
  const localRouteOptionProjection = (() => {
    const option = {
      localModelId: 'tester-local-embedding',
      model: 'local/tester-embedding',
      modelId: 'local/tester-embedding',
      engine: 'sidecar',
      provider: 'sidecar',
      status: 'active',
      capabilities: ['text.embed'],
    };
    return {
      selectable: isRuntimeRouteLocalOptionSelectable(option),
      binding: runtimeRouteLocalOptionToBinding(option, {
        defaultEndpoint: 'http://127.0.0.1:19000/v1',
      }),
    };
  })();
  const runtimeRouteBindingMatchProjection = runtimeRouteBindingsMatch(localRouteOptionProjection.binding, {
    ...localRouteOptionProjection.binding,
    model: 'local/tester-embedding',
    localModelId: 'tester-local-embedding',
  });
  const localRuntimeImageNativeEnvironmentPlanPayload = buildLocalRuntimeImageNativeEnvironmentPlanPayload(
    { assetId: 'tester-image-asset', localAssetId: 'tester-local-image-asset' },
    { os: 'linux', arch: 'x64', gpu: { vendor: 'nvidia' } },
  );
  const runtimeCapabilityCoverageProjection = projectRuntimeRouteCapabilityCoverage({
    capability: 'image',
    localNodes: [],
    localModels: [],
    connectors: [{
      status: 'healthy',
      models: ['tester-image-model'],
      modelCapabilities: {
        'tester-image-model': ['image.generate'],
      },
    }],
  });
  const runtimeRouteReasoningProjection = (() => {
    const resolvedBinding: RuntimeResolvedBinding = {
      capability: 'text.generate',
      source: 'cloud',
      connectorId: 'tester-cloud',
      provider: 'tester',
      model: 'tester-reasoning-model',
      modelId: 'tester-reasoning-model',
      resolvedBindingRef: 'binding:tester-reasoning',
    };
    const metadata: RuntimeRouteDescribeResult = {
      capability: 'text.generate',
      metadataVersion: 'v1',
      resolvedBindingRef: 'binding:tester-reasoning',
      metadataKind: 'text.generate',
      metadata: {
        supportsThinking: true,
        traceModeSupport: 'separate',
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    };
    const support = resolveRuntimeTextRouteReasoningSupport({
      resolvedBinding,
      metadata,
    });
    const config = resolveRuntimeRouteReasoningConfig('on', support);
    return {
      supported: support.supported,
      reason: support.reason ?? 'ok',
      traceMode: config.traceMode ?? 'none',
    };
  })();
  const modelConfigBindingProjection = pickerSelectionToBinding({
    source: 'cloud',
    connectorId: 'tester-cloud',
    model: 'tester-config-model',
    provider: 'tester',
  });
  const modelConfigBindingSummaryProjection = summarizeBinding(modelConfigBindingProjection);
  const runtimeHealthSummaryProjection = projectRuntimeHealthSummary({
    status: RuntimeHealthStatus.READY,
    reason: 'tester runtime ready',
    queueDepth: 0,
    activeWorkflows: 0,
    activeInferenceJobs: 0,
    cpuMilli: '0',
    memoryBytes: '0',
    vramBytes: '0',
    sampledAt: { seconds: '1710000000', nanos: 0 },
  });
  const runtimeHealthWireProjection = {
    statusName: projectRuntimeHealthStatusName(RuntimeHealthStatus.READY) ?? 'unknown',
    sampledAt: toIsoFromTimestamp({ seconds: '1710000000', nanos: 0 }) ?? 'unknown',
  };
  const localRuntimeProfileProjection = (() => {
    const [profile] = normalizeLocalRuntimeProfilesDeclaration([
      {
        id: 'tester-profile',
        title: 'Tester Profile',
        consumeCapabilities: ['chat'],
        entries: [
          { entryId: 'tester-service', kind: 'service', capability: 'chat', serviceId: 'tester-runtime' },
          { entryId: 'tester-asset', kind: 'asset', capability: 'chat', assetId: 'tester/chat-model', assetKind: 'chat' },
        ],
      },
    ]);
    const bridge = profile ? bridgeLocalRuntimeProfile(profile, 'chat') : null;
    return {
      profileCount: profile ? 1 : 0,
      runtimeEntryCount: bridge?.runtimeEntries?.required?.length ?? 0,
      assetCount: bridge?.assets.length ?? 0,
    };
  })();
  const localRuntimeExecutionPlanProjection = parseLocalRuntimeExecutionPlan({
    planId: 'tester-execution-plan',
    targetId: 'tester-runtime',
    capability: 'chat',
    deviceProfile: {
      os: 'darwin',
      arch: 'arm64',
      gpu: { available: true, memoryModel: 'unified' },
      python: { available: true, version: '3.12' },
      npu: { available: false, ready: false },
      diskFreeBytes: 1024,
      ports: [{ port: 7341, available: true }],
    },
    entries: [{
      entryId: 'tester-service',
      kind: 'LOCAL_EXECUTION_ENTRY_KIND_SERVICE',
      capability: 'chat',
      required: true,
      selected: true,
      preferred: true,
    }],
    selectionRationale: [{
      entryId: 'tester-service',
      selected: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      detail: 'tester selected SDK execution decoder path',
    }],
    preflightDecisions: [{
      entryId: 'tester-service',
      target: 'port',
      check: 'port_available',
      ok: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      detail: 'tester port available',
    }],
    warnings: [],
  });
  const localRuntimeServiceNodeProjection = {
    service: parseLocalRuntimeServiceDescriptor({
      serviceId: 'tester-service',
      title: 'Tester Service',
      engine: 'speech',
      artifactType: 'attached-endpoint',
      capabilities: ['audio.synthesize'],
      status: 'LOCAL_SERVICE_STATUS_ACTIVE',
      reasonCode: ReasonCode.ACTION_EXECUTED,
      installedAt: '2026-05-31T00:00:00Z',
      updatedAt: '2026-05-31T00:00:00Z',
    }),
    node: parseLocalRuntimeNodeDescriptor({
      nodeId: 'tester-node',
      title: 'Tester Node',
      serviceId: 'tester-service',
      capabilities: ['audio.synthesize'],
      adapter: 'SPEECH_NATIVE_ADAPTER',
      available: true,
      readOnly: true,
    }),
  };
  const appBridgeProjection = parseNimiAppBridgeProjection({
    registryPath: '/tester/.nimi/apps/registry.json',
    packagesPath: '/tester/.nimi/apps/packages.json',
    registryRows: [{
      appId: 'tester.app',
      appKind: 'nimi-app',
      displayName: 'Tester App',
      publisher: 'Tester',
      trustTier: 'nimi-community',
      ordinaryVisibility: 'ordinary-visible',
      releaseDescriptorRef: 'tester.app.descriptor',
      installStoragePolicyRef: 'tester.storage',
      sourceRule: 'tester-fixture',
      admissionStatus: 'admitted',
      installedVersion: '1.0.0',
    }],
    releaseDescriptors: [{
      descriptorId: 'tester.app.descriptor',
      appId: 'tester.app',
      version: '1.0.0',
      descriptorClass: 'external-immutable-artifact',
      sourceKind: 'github-release',
      sourceRef: 'https://example.test/tester/releases/v1',
      artifactLocator: 'https://example.test/tester/releases/v1/app.tar.zst',
      digestAlgorithm: 'sha256',
      sha256: 'b'.repeat(64),
      size: '1024',
      provenanceRef: 'tester.provenance',
      packageKind: 'nimi-app',
      entryRef: 'index.html',
      sandboxRef: 'tester.sandbox',
      permissionsRef: 'tester.permissions',
      storagePolicyRef: 'tester.storage',
      admissionPath: 'tester-sdk-parser-proof',
      mutableSourceAllowed: false,
      installDigestVerificationRequired: 'required',
      sourceRule: 'tester-fixture',
    }],
  });
  const accountAppLibraryProjection = parseAccountAppLibraryRecord({
    schemaVersion: 1,
    accountId: 'tester-account',
    updatedAt: '2026-05-31T00:00:00Z',
    apps: [{
      appId: 'tester.app',
      libraryState: 'enabled',
      installed: true,
      dataPolicy: 'keep_on_uninstall',
    }],
  });
  const runtimeAuditWireProjection = {
    callerKindName: projectRuntimeAuditCallerKindName(CallerKind.THIRD_PARTY_APP) ?? 'unknown',
    usageWindowName: projectRuntimeUsageWindowName(UsageWindow.HOUR) ?? 'unknown',
  };
  const runtimeHealthCoordinatorProjection = runtimeHealthCoordinatorDiagnostics.getSnapshot();
  const runtimeAgentConsumerProjection = (() => {
    const projectionEvent = {
      eventName: 'runtime.agent.hook.pending',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      originatingTurnId: 'tester-turn',
      originatingStreamId: 'tester-stream',
      detail: { intentId: 'tester-hook' },
    } as RuntimeAgentConsumeEvent;
    const timelineEvent = {
      eventName: 'runtime.agent.turn.text_delta',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      turnId: 'tester-turn',
      streamId: 'tester-stream',
      timeline: {
        turnId: 'tester-turn',
        streamId: 'tester-stream',
        channel: 'text',
        offsetMs: 24,
        sequence: 2,
        startedAtWall: '2026-05-31T00:00:00.000Z',
        observedAtWall: '2026-05-31T00:00:00.024Z',
        timebaseOwner: 'runtime',
        projectionRuleId: 'K-AGCORE-051',
        clockBasis: 'monotonic_with_wall_anchor',
        providerNeutral: true,
        appLocalAuthority: false,
      },
      detail: { text: 'tester' },
    } as RuntimeAgentConsumeEvent;
    const recoveryEvents = buildRuntimeAgentSnapshotRecoveryEvents({
      turn: {
        turnId: 'tester-turn',
        streamId: 'tester-stream',
        status: 'completed',
        messageId: 'tester-message',
        text: 'tester done',
        structured: {
          message: {
            message_id: 'tester-message',
            text: 'tester done',
          },
        },
        finishReason: 'stop',
      },
      ownerUserId: 'tester-owner',
      realmAgentId: 'tester-agent',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      requestId: 'tester-request',
      currentTurnAccepted: false,
      currentRuntimeTurnId: '',
      currentRuntimeStreamId: '',
      hasStructuredEnvelope: false,
      hasCommittedMessage: false,
    });
    const projectionSummary = summarizeRuntimeAgentProjectionEvent(projectionEvent);
    const timelineSummary = summarizeRuntimeAgentTimeline(timelineEvent);
    const terminal = recoveryEvents[recoveryEvents.length - 1];
    return {
      projectionScoped: isRuntimeAgentProjectionEvent(projectionEvent) && matchesRuntimeAgentProjectionScope({
        event: projectionEvent,
        conversationAnchorId: 'tester-anchor',
        currentTurnAccepted: true,
        currentRuntimeTurnId: 'tester-turn',
      }),
      projectionEventName: projectionSummary.eventName,
      timelineChannel: timelineSummary?.channel ?? 'none',
      recoveryEventCount: recoveryEvents.length,
      terminalEventName: terminal?.eventName ?? 'none',
    };
  })();
  const runtimeStructProjection = (() => {
    const encoded = toProtoStruct({
      surfaceId: 'tester.settings',
      audit: {
        kind: 'diagnostic',
        retryable: false,
      },
      tags: ['runtime', 'settings'],
    });
    const decoded = fromProtoStruct(encoded);
    const audit = decoded.audit && typeof decoded.audit === 'object'
      ? decoded.audit as Record<string, unknown>
      : {};
    return {
      surfaceId: String(decoded.surfaceId || 'unknown'),
      auditKind: String(audit.kind || 'unknown'),
      tagCount: Array.isArray(decoded.tags) ? decoded.tags.length : 0,
    };
  })();
  return {
    recommendationFeedProjection,
    recommendationFeedParserProjection,
    recommendationCopyProjection,
    runtimeReasonProjection,
    runtimeAgentRequestContextProjection,
    offlineReasonProjection,
    runtimeDependencyStateProjection,
    runtimeDependencyPlanProjection,
    runtimeDependencyJobProjection,
    firstRunProfileProjection,
    runtimeFirstRunMaterializationSummary,
    localRuntimeAssetIdProjection,
    localRuntimeAssetKindProjection,
    runtimeConfigProjection,
    runtimeTargetCallOptionsProjection,
    runtimeRequestMetadataProjection,
    runtimeLocalAiReasonProjection,
    memoryEmbeddingRouteProjection,
    runtimeAgentMemoryProjection,
    memoryEmbeddingRuntimeProjection,
    runtimeAgentInspectProjection,
    runtimeAgentPresentationProfileProjection,
    externalAgentProjection,
    runtimeRouteModelProfileProjection,
    localRouteOptionProjection,
    runtimeRouteBindingMatchProjection,
    localRuntimeImageNativeEnvironmentPlanPayload,
    runtimeCapabilityCoverageProjection,
    runtimeRouteReasoningProjection,
    modelConfigBindingProjection,
    modelConfigBindingSummaryProjection,
    runtimeHealthSummaryProjection,
    runtimeHealthWireProjection,
    localRuntimeProfileProjection,
    localRuntimeExecutionPlanProjection,
    localRuntimeServiceNodeProjection,
    appBridgeProjection,
    accountAppLibraryProjection,
    runtimeAuditWireProjection,
    runtimeHealthCoordinatorProjection,
    runtimeAgentConsumerProjection,
    runtimeStructProjection,
  };
}

export type TesterSettingsRuntimeProjections = ReturnType<typeof createTesterSettingsRuntimeProjections>;
