import {
  NIMI_APP_AI_PROFILE_FACTORY_ROWS,
  parseNimiAppAccountLibraryRecord,
  parseNimiAppBridgeProjection,
  selectNimiAppFactoryAIProfileForFirstRun,
} from '@nimiplatform/sdk/app';
import { aggregateNimiFirstRunMaterializationDownloadProgress, buildNimiRuntimeLocalImageNativeEnvironmentPlanInput, buildRuntimeAgentRequestContext, buildNimiRuntimeAgentSnapshotRecoveryEvents, buildNimiRuntimeRouteRequestMetadata, buildNimiRuntimeRouteTargetCallOptions, bridgeNimiRuntimeLocalProfile, createEmptyNimiMemoryEmbeddingConfig, extractNimiRuntimeReasonCodeFromError, findNimiRuntimeRouteModelProfile, fromNimiRuntimeProtoStruct, getNimiRuntimeReasonCodeDefaultMessage, isNimiRuntimeLocalEnvironmentDependencyJobActiveState, isNimiRuntimeLocalEnvironmentDependencyJobRetryableState, isNimiRuntimeLocalEnvironmentDependencyJobTransferringState, isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState, isNimiRuntimeLocalEnvironmentDependencyStartableState, isNimiRuntimeAgentProjectionEvent, isNimiRuntimeRouteLocalOptionSelectable, nimiRuntimeLocalRecommendationTierToRunGrade, matchesNimiRuntimeAgentProjectionScope, parseNimiRuntimeLocalRecommendationFeedCacheStateId, normalizeNimiRuntimeLocalProfilesDeclaration, normalizeNimiRuntimeReasonCode, parseNimiRuntimeLocalRecommendationFeedSourceId, projectNimiRuntimeLocalEnvironmentDependencyJob, projectNimiRuntimeLocalEnvironmentPlan, projectNimiRuntimeLocalRecommendationFeed, productStateForNimiFirstRunMaterializationStatus, projectNimiMemoryEmbeddingRouteAvailability, projectNimiRuntimeAgentCanonicalMemoryBankStatus, projectNimiRuntimeAuditCallerKindName, projectNimiRuntimeHealthStatusName, projectNimiRuntimeHealthSummary, projectRuntimeLocalAgentIdentity, projectNimiRuntimeRouteCapabilityCoverage, projectNimiRuntimeUsageWindowName, repairableNimiFirstRunMaterializationDependencies, retryableInterruptedNimiFirstRunMaterializationJobs, nimiRuntimeRouteBindingsMatch, nimiRuntimeRouteLocalOptionToBinding, summarizeNimiRuntimeLocalRecommendationFeedCacheState, summarizeNimiRuntimeAgentProjectionEvent, summarizeNimiRuntimeAgentTimeline, toCanonicalNimiRuntimeLocalAssetId, toCanonicalNimiRuntimeLocalAssetLookupKey, toNimiRuntimeIsoFromTimestamp, toNimiRuntimeProtoStruct, toNimiRuntimeUserFacingError, type NimiRuntimeAgentConsumeEvent, type NimiRuntimeLocalExecutionPlan, type NimiRuntimeResolvedBinding, type NimiRuntimeRouteDescribeResult } from '@nimiplatform/sdk/runtime';
import { AgentCanonicalMemoryBankMode, CallerKind, RuntimeHealthStatus, ReasonCode as RuntimeReasonCode, UsageWindow } from '@nimiplatform/sdk/runtime/generated';
import { classifyOfflineError, classifyOfflineReasonCode, createOfflineNimiError, extractNimiErrorFields, ReasonCode } from '@nimiplatform/sdk/types';
import { summarizeTargetRef } from '@nimiplatform/kit/features/model-config/headless';
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
    cacheState: summarizeNimiRuntimeLocalRecommendationFeedCacheState({
      cacheState: parseNimiRuntimeLocalRecommendationFeedCacheStateId('LOCAL_RECOMMENDATION_FEED_CACHE_STATE_FRESH'),
    }),
    source: parseNimiRuntimeLocalRecommendationFeedSourceId('LOCAL_RECOMMENDATION_FEED_SOURCE_MODEL_INDEX') ?? 'unknown',
    grade: nimiRuntimeLocalRecommendationTierToRunGrade('LOCAL_RECOMMENDATION_TIER_RUNNABLE'),
  };
  const recommendationFeedParserProjection = projectNimiRuntimeLocalRecommendationFeed({
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
    message: getNimiRuntimeReasonCodeDefaultMessage(ReasonCode.AI_PROVIDER_TIMEOUT) ?? 'unknown',
    credentialMissing: getNimiRuntimeReasonCodeDefaultMessage(ReasonCode.AI_CONNECTOR_CREDENTIAL_MISSING) ?? 'unknown',
    numeric: normalizeNimiRuntimeReasonCode(351) || 'unknown',
    extracted: extractNimiRuntimeReasonCodeFromError(new Error('runtime failed: reason=411')) ?? 'unknown',
    presented: toNimiRuntimeUserFacingError({
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
    dependencyStartable: isNimiRuntimeLocalEnvironmentDependencyStartableState('needs_confirmation'),
    jobActive: isNimiRuntimeLocalEnvironmentDependencyJobActiveState('downloading'),
    jobRetryable: isNimiRuntimeLocalEnvironmentDependencyJobRetryableState('failed'),
    jobTransferring: isNimiRuntimeLocalEnvironmentDependencyJobTransferringState('verifying'),
    dependencyRepairRequired: isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState('repair_required'),
  };
  const runtimeDependencyPlanProjection = projectNimiRuntimeLocalEnvironmentPlan({
    planId: 'tester-plan',
    packId: 'tester-local-speech',
    productLabel: 'Tester Local Speech',
    hostProfileId: 'tester-host',
    platformTuple: 'darwin-arm64',
    runtimeDataRoot: '/tester/runtime',
    consumerScope: 'tester.settings',
    cloudOnlyImpact: 'none',
    state: 'needs_confirmation',
    reasonCode: ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
    dependencies: [{
      dependencyFamily: 'python',
      dependencyId: 'tester-python',
      consumerScope: 'tester.settings',
      required: true,
      state: 'needs_confirmation',
      sourceKind: 'managed_download',
      confirmationRequired: true,
      selectedSourceRecordId: 'tester-managed-download',
      environmentKey: 'tester-local-speech',
      canonicalRoot: '/tester/runtime/local-speech',
      reasonCode: ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
      detail: 'tester local speech dependency requires explicit confirmation',
    }],
  });
  const runtimeDependencyJobProjection = projectNimiRuntimeLocalEnvironmentDependencyJob({
    jobId: 'tester-job',
    environmentKey: 'tester-local-speech',
    dependencyFamily: 'python',
    dependencyId: 'tester-python',
    consumerScope: 'tester.settings',
    state: 'downloading',
    sourceKind: 'managed_download',
    canonicalRoot: '/tester/runtime/local-speech',
    selectedSourceRecordId: 'tester-managed-download',
    failureDetail: '',
    retryable: true,
    createdAt: '2026-05-31T00:00:00Z',
    updatedAt: '2026-05-31T00:00:01Z',
    reasonCode: '',
    recoveryDisposition: '',
    bytesReceived: '512',
    bytesTotal: '1024',
    percent: 50,
    speedBytesPerSec: '256',
    etaSeconds: '2',
  });
  const firstRunProfileProjection = {
    minimal: selectNimiAppFactoryAIProfileForFirstRun(NIMI_APP_AI_PROFILE_FACTORY_ROWS, 'minimal')?.alias ?? 'none',
    recommended: selectNimiAppFactoryAIProfileForFirstRun(NIMI_APP_AI_PROFILE_FACTORY_ROWS, 'recommended')?.alias ?? 'none',
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
    productState: productStateForNimiFirstRunMaterializationStatus('failed'),
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
    productState: productStateForNimiFirstRunMaterializationStatus('repair_required'),
    reason: 'runtime_materialization_repair_required',
    dependencies: [{
      packId: runtimeDependencyPlanProjection.packId,
      dependency: { ...runtimeFirstRunDependency, state: 'repair_required' },
      job: null,
    }],
  };
  const runtimeFirstRunMaterializationProgress = aggregateNimiFirstRunMaterializationDownloadProgress([{
    packId: runtimeDependencyPlanProjection.packId,
    dependency: runtimeFirstRunDependency,
    job: runtimeDependencyJobProjection,
  }]);
  const runtimeFirstRunMaterializationSummary = {
    retryableJobs: retryableInterruptedNimiFirstRunMaterializationJobs(runtimeFirstRunMaterializationProjection).length,
    repairableDependencies: repairableNimiFirstRunMaterializationDependencies(runtimeFirstRunRepairProjection).length,
    productState: runtimeFirstRunMaterializationProjection.productState,
    recoveryDisposition: runtimeFirstRunFailedJob.recoveryDisposition,
    percent: runtimeFirstRunMaterializationProgress?.percent ?? null,
  };
  const localRuntimeAssetIdProjection = { assetId: toCanonicalNimiRuntimeLocalAssetId('local/tester-model'), lookupKey: toCanonicalNimiRuntimeLocalAssetLookupKey('LOCAL/Tester-Model') };
  const localRuntimeAssetKindProjection = createTesterLocalRuntimeAssetKindProjection();
  const runtimeConfigProjection = createTesterRuntimeConfigProjection();
  const runtimeTargetCallOptionsProjection = buildNimiRuntimeRouteTargetCallOptions({
    targetId: 'tester.settings.runtime-route',
    timeoutMs: 5000,
    callerKind: 'third-party-app',
    surfaceId: 'tester.settings',
    connectorId: 'tester-cloud',
    callerIdPrefix: 'tester-runtime',
  });
  const runtimeRequestMetadataProjection = buildNimiRuntimeRouteRequestMetadata({
    connectorId: 'tester-cloud',
    traceIdPrefix: 'tester-metadata',
  });
  const runtimeLocalAiReasonProjection = normalizeNimiRuntimeReasonCode(ReasonCode.AI_STREAM_BROKEN) || 'unknown';
  const memoryEmbeddingConfig = {
    ...createEmptyNimiMemoryEmbeddingConfig({
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
  const memoryEmbeddingRouteProjection = projectNimiMemoryEmbeddingRouteAvailability({
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
  const runtimeAgentMemoryProjection = projectNimiRuntimeAgentCanonicalMemoryBankStatus({
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
  const runtimeRouteModelProfileProjection = findNimiRuntimeRouteModelProfile({
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
      selectable: isNimiRuntimeRouteLocalOptionSelectable(option),
      binding: nimiRuntimeRouteLocalOptionToBinding(option, {
        defaultEndpoint: 'http://127.0.0.1:19000/v1',
      }),
    };
  })();
  const runtimeRouteBindingMatchProjection = nimiRuntimeRouteBindingsMatch(localRouteOptionProjection.binding, {
    ...localRouteOptionProjection.binding,
    model: 'local/tester-embedding',
    localModelId: 'tester-local-embedding',
  });
  const localRuntimeImageNativeEnvironmentPlanPayload = buildNimiRuntimeLocalImageNativeEnvironmentPlanInput(
    { assetId: 'tester-image-asset', localAssetId: 'tester-local-image-asset' },
    { os: 'linux', arch: 'x64', gpu: { vendor: 'nvidia' } },
  );
  const runtimeCapabilityCoverageProjection = projectNimiRuntimeRouteCapabilityCoverage({
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
  const runtimeRouteReasoningProjection = {
    supported: false,
    reason: 'reasoning_metadata_helper_not_public',
    traceMode: 'none',
  };
  const modelConfigBindingProjection = {
    source: 'cloud',
    connectorId: 'tester-cloud',
    model: 'tester-config-model',
    provider: 'tester',
  };
  const modelConfigBindingSummaryProjection = summarizeTargetRef({
    kind: 'cloud-connector',
    connectorId: modelConfigBindingProjection.connectorId,
    providerModelId: modelConfigBindingProjection.model,
    provider: modelConfigBindingProjection.provider,
  });
  const runtimeHealthSummaryProjection = projectNimiRuntimeHealthSummary({
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
    statusName: projectNimiRuntimeHealthStatusName(RuntimeHealthStatus.READY) ?? 'unknown',
    sampledAt: toNimiRuntimeIsoFromTimestamp({ seconds: '1710000000', nanos: 0 }) ?? 'unknown',
  };
  const localRuntimeProfileProjection = (() => {
    const [profile] = normalizeNimiRuntimeLocalProfilesDeclaration([
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
    const bridge = profile ? bridgeNimiRuntimeLocalProfile(profile, 'chat') : null;
    return {
      profileCount: profile ? 1 : 0,
      runtimeEntryCount: bridge?.runtimeEntries?.required?.length ?? 0,
      assetCount: bridge?.assets.length ?? 0,
    };
  })();
  const localRuntimeExecutionPlanProjection: NimiRuntimeLocalExecutionPlan = {
    planId: 'tester-execution-plan',
    targetId: 'tester-runtime',
    capability: 'chat',
    deviceProfile: {
      os: 'darwin',
      arch: 'arm64',
      totalRamBytes: 17179869184,
      availableRamBytes: 8589934592,
      gpu: {
        available: true,
        vendor: 'apple',
        model: 'integrated',
        totalVramBytes: 8589934592,
        availableVramBytes: 4294967296,
        memoryModel: 'unified',
      },
      python: { available: true, version: '3.12' },
      npu: { available: false, ready: false, vendor: '', runtime: '', detail: 'not present' },
      diskFreeBytes: 1024,
      ports: [{ port: 7341, available: true }],
    },
    entries: [{
      entryId: 'tester-service',
      kind: 'service',
      capability: 'chat',
      required: true,
      selected: true,
      preferred: true,
      serviceId: 'tester-runtime',
      warnings: [],
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
    reasonCode: ReasonCode.ACTION_EXECUTED,
  };
  const localRuntimeServiceNodeProjection = {
    service: {
      serviceId: 'tester-service',
      title: 'Tester Service',
      engine: 'speech',
      artifactType: 'attached-endpoint',
      capabilities: ['audio.synthesize'],
      status: 'active',
      reasonCode: ReasonCode.ACTION_EXECUTED,
      installedAt: '2026-05-31T00:00:00Z',
      updatedAt: '2026-05-31T00:00:00Z',
    },
    node: {
      nodeId: 'tester-node',
      title: 'Tester Node',
      serviceId: 'tester-service',
      capabilities: ['audio.synthesize'],
      adapter: 'SPEECH_NATIVE_ADAPTER',
      available: true,
      readOnly: true,
    },
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
  const accountAppLibraryProjection = parseNimiAppAccountLibraryRecord({
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
    callerKindName: projectNimiRuntimeAuditCallerKindName(CallerKind.THIRD_PARTY_APP) ?? 'unknown',
    usageWindowName: projectNimiRuntimeUsageWindowName(UsageWindow.HOUR) ?? 'unknown',
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
    } as NimiRuntimeAgentConsumeEvent;
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
    } as NimiRuntimeAgentConsumeEvent;
    const recoveryEvents = buildNimiRuntimeAgentSnapshotRecoveryEvents({
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
    const projectionSummary = summarizeNimiRuntimeAgentProjectionEvent(projectionEvent);
    const timelineSummary = summarizeNimiRuntimeAgentTimeline(timelineEvent);
    const terminal = recoveryEvents[recoveryEvents.length - 1];
    return {
      projectionScoped: isNimiRuntimeAgentProjectionEvent(projectionEvent) && matchesNimiRuntimeAgentProjectionScope({
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
    const encoded = toNimiRuntimeProtoStruct({
      surfaceId: 'tester.settings',
      audit: {
        kind: 'diagnostic',
        retryable: false,
      },
      tags: ['runtime', 'settings'],
    });
    const decoded = fromNimiRuntimeProtoStruct(encoded);
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
