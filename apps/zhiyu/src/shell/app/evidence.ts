import type {
  RuntimeAgentConversationProjectionState,
} from '@nimiplatform/kit/features/chat/headless';
import type {
  AvatarLaunchHandoffResult,
  AvatarEmotionCue,
  RuntimeAgentEmotionId,
  RuntimeAgentEmotionIntensity,
} from '@nimiplatform/kit/features/avatar/headless';
import type {
  NimiRuntimeAgentExecutionBinding,
  NimiRuntimeAgentAutonomyMode,
  NimiRuntimeAgentIdentitySafetyProjection,
  NimiRuntimeAgentPresentationProfileProjection,
  NimiRuntimeAgentSourceContextStatus,
  NimiRuntimeAgentSourceRef,
  NimiRuntimeAgentTurnContextSummary,
  NimiRuntimeAgentProactiveDeliveryChannel,
  NimiRuntimeAgentProactiveFrequencyCapState,
  NimiRuntimeAgentProactiveOptInState,
  NimiRuntimeAgentProactiveQuietHoursState,
  NimiRuntimeAgentProactiveSuppressionReason,
} from '@nimiplatform/sdk/runtime';
import {
  createInitialZhiyuDelegationEvidence,
  type ZhiyuDelegationUxStatus,
} from './delegation-evidence';
import {
  createInitialZhiyuVoiceCaptureEvidence,
  type ZhiyuVoiceCaptureEvidence,
} from '../agent-chat/voice-capture-evidence';
import type {
  ZhiyuCompanionEmotionViolation,
} from '../agent/companion-emotion';

export type {
  ZhiyuDelegationApprovalDecision,
  ZhiyuDelegationApprovalState,
  ZhiyuDelegationAuditState,
  ZhiyuDelegationCandidateState,
  ZhiyuDelegationOutputFirewallState,
  ZhiyuDelegationPreviewState,
  ZhiyuDelegationReplayStage,
  ZhiyuDelegationRetryState,
  ZhiyuDelegationScopeEvidence,
  ZhiyuDelegationUxState,
  ZhiyuDelegationUxStatus,
} from './delegation-evidence';

export type ZhiyuMemoryObservatoryState =
  | 'blocked'
  | 'ready'
  | 'empty'
  | 'denied'
  | 'grant-missing'
  | 'no-provider'
  | 'runtime-unavailable'
  | 'partial';

export type ZhiyuProactiveInterruptibilityState =
  | 'blocked'
  | 'off'
  | 'suggested'
  | 'delivered'
  | 'suppressed'
  | 'quiet-hours-active'
  | 'frequency-capped'
  | 'permission-denied'
  | 'permission-revoked'
  | 'permission-missing'
  | 'permission-expired'
  | 'projected';

export type ZhiyuProactiveInterruptibilityStatus = {
  readonly transport: 'electron-ipc';
  readonly ready: boolean;
  readonly deliveryReady: boolean;
  readonly state: ZhiyuProactiveInterruptibilityState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId: string | null;
  readonly runtimeSourceRef: string | null;
  readonly localAgentRef: string | null;
  readonly observedAt: string | null;
  readonly projectionId: string | null;
  readonly projectionKind: string | null;
  readonly mode: NimiRuntimeAgentAutonomyMode | null;
  readonly optInState: NimiRuntimeAgentProactiveOptInState | null;
  readonly deliveryChannel: NimiRuntimeAgentProactiveDeliveryChannel | null;
  readonly quietHoursState: NimiRuntimeAgentProactiveQuietHoursState | null;
  readonly frequencyCapState: NimiRuntimeAgentProactiveFrequencyCapState | null;
  readonly suggestedReasonCode: string | null;
  readonly lastDeliveredReasonCode: string | null;
  readonly lastSuppressedReasonCode: string | null;
  readonly lastSuppressionReason: NimiRuntimeAgentProactiveSuppressionReason | null;
  readonly sourceHookId: string | null;
  readonly sourceCadenceId: string | null;
  readonly auditRefs: readonly string[];
  readonly unsupportedFields: readonly string[];
};

export type ZhiyuAgentAIConfigReadinessState = 'ready' | 'not_configured' | 'unavailable';

export type ZhiyuExecutionCapabilityEvidence = {
  readonly state: ZhiyuAgentAIConfigReadinessState;
  readonly reasonCode: string;
  readonly probedAt: string | null;
  readonly binding: NimiRuntimeAgentExecutionBinding | null;
};

export type ZhiyuRuntimeAgentChatStatus = {
  readonly transport: 'electron-ipc';
  readonly ready: boolean;
  readonly state: 'idle' | 'streaming' | 'completed' | 'failed' | 'canceled';
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId: string | null;
  readonly runtimeSourceRef: string | null;
  readonly localAgentRef: string | null;
  readonly conversationAnchorId: string | null;
  readonly requestId: string | null;
  readonly runtimeTurnId: string | null;
  readonly runtimeStreamId: string | null;
  readonly eventTypes: readonly string[];
  readonly messageCount: number;
  readonly messages: RuntimeAgentConversationProjectionState['messages'];
  readonly latestAssistantText: string | null;
  readonly reasoningText: string | null;
  readonly outputText: string | null;
  readonly diagnostics: RuntimeAgentConversationProjectionState['diagnostics'];
};

export type ZhiyuCompanionRuntimeProjectionEventEvidence = {
  readonly eventName: string;
  readonly localAgentRef: string | null;
  readonly conversationAnchorId: string | null;
  readonly turnId: string | null;
  readonly streamId: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly projectedExecutionState: string | null;
  readonly projectedStatusText: string | null;
  readonly projectedFields: readonly string[];
  readonly projectionReasonCode: string | null;
};

export type ZhiyuEvidence = {
  readonly appId: 'nimi.zhiyu';
  readonly phase: 'electron-bootstrap';
  readonly screen: 'home';
  readonly runtime: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
  };
  readonly auth: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly state: string;
    readonly reasonCode: string;
    readonly accountReasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly accountId: string | null;
    readonly displayName: string | null;
    readonly productionInert: boolean;
  };
  readonly source: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly ownerUserId: string | null;
    readonly runtimeSourceRef: string | null;
    readonly sourceRef: NimiRuntimeAgentSourceRef | null;
    readonly projectionState: 'ready' | 'blocked' | 'truncated' | 'failed' | 'unknown';
    readonly sourceContextStatus: NimiRuntimeAgentSourceContextStatus | null;
    readonly turnContextSummary: NimiRuntimeAgentTurnContextSummary | null;
  };
  readonly inventory: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly ownerUserId: string | null;
    readonly count: number;
    readonly localAgents: readonly {
      readonly localAgentRef: string;
      readonly ownerUserId: string;
      readonly runtimeSourceRef: string;
      readonly displayName: string;
      readonly sourceReady: boolean;
    }[];
  };
  readonly localAgent: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly ownerUserId: string | null;
    readonly runtimeSourceRef: string | null;
    readonly localAgentRef: string | null;
  };
  readonly conversation: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly ownerUserId: string | null;
    readonly runtimeSourceRef: string | null;
    readonly localAgentRef: string | null;
    readonly conversationAnchorId: string | null;
    readonly threadId: string | null;
  };
  readonly memory: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly state: ZhiyuMemoryObservatoryState;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly ownerUserId: string | null;
    readonly runtimeSourceRef: string | null;
    readonly localAgentRef: string | null;
    readonly observedAt: string | null;
    readonly recordCount: number;
    readonly bankCount: number;
    readonly bankReviewStatuses: readonly {
      readonly bankKey: string;
      readonly readiness: string;
      readonly eligibleNow: boolean;
      readonly reviewExecutorAvailable: boolean;
      readonly lastReviewRunId: string | null;
      readonly checkpointBasis: string | null;
      readonly lastCompletedAt: string | null;
      readonly nextEligibleAt: string | null;
      readonly recoverableReviewRunId: string | null;
      readonly source: string;
    }[];
    readonly unsupportedLifecycleFields: readonly string[];
    readonly records: readonly {
      readonly memoryId: string;
      readonly bankKey: string;
      readonly authorityClass: 'canonical-agent-memory';
      readonly canonicalClass: string | null;
      readonly kind: string | null;
      readonly payloadKind: string;
      readonly summary: string;
      readonly timelineAt: string | null;
      readonly lineage: {
        readonly sourceSystem: string | null;
        readonly sourceEventId: string | null;
        readonly traceId: string | null;
        readonly committedAt: string | null;
      };
      readonly confidence: {
        readonly state: string;
        readonly value: number | null;
        readonly source: string | null;
        readonly reasonCode: string | null;
      };
      readonly reviewState: string;
      readonly redactionState: string;
      readonly forgetIntentState: string;
    }[];
  };
  readonly companion: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly state: 'blocked' | 'projected';
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly ownerUserId: string | null;
    readonly runtimeSourceRef: string | null;
    readonly localAgentRef: string | null;
    readonly observedAt: string | null;
    readonly stateUpdatedAt: string | null;
    readonly executionState: string | null;
    readonly statusText: string | null;
    readonly voiceOutputMode: string | null;
    readonly voicePlaybackState: string | null;
    readonly voiceAudioArtifactId: string | null;
    readonly voiceAudioMimeType: string | null;
    readonly voicePlaybackTarget: string | null;
    readonly voiceStreamId: string | null;
    readonly activeWorldId: string | null;
    readonly activeUserId: string | null;
    readonly currentEmotion: RuntimeAgentEmotionId | null;
    readonly currentEmotionId: RuntimeAgentEmotionId | null;
    readonly currentEmotionCue: AvatarEmotionCue | null;
    readonly currentEmotionIntensity: RuntimeAgentEmotionIntensity | null;
    readonly emotionViolation: ZhiyuCompanionEmotionViolation | null;
    readonly participationMode: 'world' | 'dyadic' | 'idle' | 'not_projected';
    readonly participationSource: string | null;
    readonly projectedFields: readonly string[];
    readonly unsupportedExplainabilityFields: readonly string[];
    readonly diagnostics: {
      readonly runtimeProjectionEvents: readonly ZhiyuCompanionRuntimeProjectionEventEvidence[];
    };
    readonly proactiveInterruptibility: ZhiyuProactiveInterruptibilityStatus;
  };
  readonly voiceCapture: ZhiyuVoiceCaptureEvidence;
  readonly delegation: ZhiyuDelegationUxStatus;
  readonly proposal: {
    readonly transport: 'sdk-proposal-intake';
    readonly ready: boolean;
    readonly state: 'draft' | 'submitted' | 'under-review' | 'revision-requested' | 'rejected' | 'accepted-for-admission' | 'blocked';
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly proposalId: string | null;
    readonly proposalKind: string;
    readonly sourceConversationAnchorId: string | null;
    readonly requesterSubjectRef: string | null;
    readonly ownerDomain: string;
    readonly requestedCapabilityRef: string;
    readonly riskTier: string;
    readonly requiredPermissionRefs: readonly string[];
    readonly nextReviewStep: string;
    readonly auditRef: string | null;
    readonly createdAt: string | null;
  };
  readonly avatar: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly state: 'blocked' | 'projected';
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly ownerUserId: string | null;
    readonly runtimeSourceRef: string | null;
    readonly localAgentRef: string | null;
    readonly projectionRef: string | null;
    readonly configurationRef: string | null;
    readonly backendKind: NimiRuntimeAgentPresentationProfileProjection['backendKind'] | null;
    readonly visualReadiness: 'not_projected' | 'projected';
    readonly voiceReadiness: 'not_projected' | 'projected';
    readonly launchAvailable: boolean;
    readonly manageAvailable: boolean;
    readonly launchHandoff: AvatarLaunchHandoffResult | null;
    readonly unsupportedFields: readonly string[];
  };
  readonly chat: ZhiyuRuntimeAgentChatStatus;
  readonly route: {
    readonly transport: 'electron-ipc';
    // Send readiness: runtime-projected text.generate readiness === 'ready'.
    readonly ready: boolean;
    readonly capability: 'text.generate';
    // Committed runtime agent AI Config projection (K-AGCORE-144~150).
    readonly configRevision: number | null;
    readonly readinessRevision: number | null;
    readonly updatedAt: string | null;
    readonly updatedByAppId: string | null;
    readonly capabilities: Readonly<Record<string, ZhiyuExecutionCapabilityEvidence>>;
    // Committed text.generate binding projection (display evidence only; the
    // runtime resolves every turn against its own committed config).
    readonly executionBinding: NimiRuntimeAgentExecutionBinding | null;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
  };
  readonly turn: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly ownerUserId: string | null;
    readonly runtimeSourceRef: string | null;
    readonly localAgentRef: string | null;
    readonly conversationAnchorId: string | null;
    readonly requestId: string | null;
    readonly runtimeTurnId: string | null;
    readonly runtimeStreamId: string | null;
    readonly messageId: string | null;
  };
  readonly composer: {
    readonly submitState: 'idle' | 'blocked' | 'ready' | 'submitting' | 'accepted' | 'failed';
    readonly draftLength: number;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
  };
  readonly identitySafety?: NimiRuntimeAgentIdentitySafetyProjection;
  readonly productRegions: readonly string[];
};

export function createInitialZhiyuEvidence(): ZhiyuEvidence {
  return {
    appId: 'nimi.zhiyu',
    phase: 'electron-bootstrap',
    screen: 'home',
    runtime: {
      transport: 'electron-ipc',
      ready: false,
      reasonCode: 'not-probed',
      actionHint: 'probe_runtime_status',
      source: 'renderer',
      message: 'Runtime status has not been probed.',
    },
    auth: {
      transport: 'electron-ipc',
      ready: false,
      state: 'not-probed',
      reasonCode: 'not-probed',
      accountReasonCode: 'UNKNOWN',
      actionHint: 'probe_runtime_account_status',
      source: 'renderer',
      message: 'Runtime account status has not been probed.',
      accountId: null,
      displayName: null,
      productionInert: false,
    },
    source: {
      transport: 'electron-ipc',
      ready: false,
      reasonCode: 'not-probed',
      actionHint: 'await_admitted_runtime_source_projection',
      source: 'renderer',
      message: 'Runtime source projection has not been probed.',
      ownerUserId: null,
      runtimeSourceRef: null,
      sourceRef: null,
      projectionState: 'unknown',
      sourceContextStatus: null,
      turnContextSummary: null,
    },
    inventory: {
      transport: 'electron-ipc',
      ready: false,
      reasonCode: 'not-probed',
      actionHint: 'list_runtime_local_agents',
      source: 'renderer',
      message: 'Runtime LocalAgent inventory has not been probed.',
      ownerUserId: null,
      count: 0,
      localAgents: [],
    },
    localAgent: {
      transport: 'electron-ipc',
      ready: false,
      reasonCode: 'not-probed',
      actionHint: 'probe_local_agent_discovery',
      source: 'renderer',
      message: 'LocalAgent discovery has not been probed.',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
    },
    conversation: {
      transport: 'electron-ipc',
      ready: false,
      reasonCode: 'not-probed',
      actionHint: 'open_runtime_conversation_anchor',
      source: 'renderer',
      message: 'Runtime conversation home has not been probed.',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      conversationAnchorId: null,
      threadId: null,
    },
    memory: {
      transport: 'electron-ipc',
      ready: false,
      state: 'blocked',
      reasonCode: 'not-probed',
      actionHint: 'probe_runtime_agent_memory_observatory',
      source: 'renderer',
      message: 'Runtime Agent Memory Observatory has not been probed.',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      observedAt: null,
      recordCount: 0,
      bankCount: 0,
      bankReviewStatuses: [],
      unsupportedLifecycleFields: ['review', 'redaction', 'forgetIntent'],
      records: [],
    },
    companion: {
      transport: 'electron-ipc',
      ready: false,
      state: 'blocked',
      reasonCode: 'not-probed',
      actionHint: 'probe_runtime_agent_state_projection',
      source: 'renderer',
      message: 'Runtime Agent companion state has not been probed.',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      observedAt: null,
      stateUpdatedAt: null,
      executionState: null,
      statusText: null,
      voiceOutputMode: null,
      voicePlaybackState: null,
      voiceAudioArtifactId: null,
      voiceAudioMimeType: null,
      voicePlaybackTarget: null,
      voiceStreamId: null,
      activeWorldId: null,
      activeUserId: null,
      currentEmotion: null,
      currentEmotionId: null,
      currentEmotionCue: null,
      currentEmotionIntensity: null,
      emotionViolation: null,
      participationMode: 'not_projected',
      participationSource: null,
      projectedFields: [],
      unsupportedExplainabilityFields: [
        'posture',
        'postureSource',
        'stateConfidence',
        'whyThisState',
        'relationshipContext',
        'stateChangeHistory',
      ],
      diagnostics: {
        runtimeProjectionEvents: [],
      },
      proactiveInterruptibility: {
        transport: 'electron-ipc',
        ready: false,
        deliveryReady: false,
        state: 'blocked',
        reasonCode: 'not-probed',
        actionHint: 'probe_runtime_agent_proactive_interruptibility',
        source: 'renderer',
        message: 'Runtime Agent proactive interruptibility has not been probed.',
        ownerUserId: null,
        runtimeSourceRef: null,
        localAgentRef: null,
        observedAt: null,
        projectionId: null,
        projectionKind: null,
        mode: null,
        optInState: null,
        deliveryChannel: null,
        quietHoursState: null,
        frequencyCapState: null,
        suggestedReasonCode: null,
        lastDeliveredReasonCode: null,
        lastSuppressedReasonCode: null,
        lastSuppressionReason: null,
        sourceHookId: null,
        sourceCadenceId: null,
        auditRefs: [],
        unsupportedFields: ['proactive_interruptibility'],
      },
    },
    voiceCapture: createInitialZhiyuVoiceCaptureEvidence(),
    delegation: createInitialZhiyuDelegationEvidence(),
    proposal: {
      transport: 'sdk-proposal-intake',
      ready: false,
      state: 'blocked',
      reasonCode: 'not-probed',
      actionHint: 'connect_platform_proposal_intake',
      source: 'renderer',
      message: 'Platform proposal intake has not been probed.',
      proposalId: null,
      proposalKind: 'capability_proposal',
      sourceConversationAnchorId: null,
      requesterSubjectRef: null,
      ownerDomain: 'Platform',
      requestedCapabilityRef: 'capability:text.generate.assistant',
      riskTier: 'medium',
      requiredPermissionRefs: ['permission:runtime.agent.turn.write'],
      nextReviewStep: 'platform_review_capability_proposal',
      auditRef: null,
      createdAt: null,
    },
    avatar: {
      transport: 'electron-ipc',
      ready: false,
      state: 'blocked',
      reasonCode: 'not-probed',
      actionHint: 'probe_avatar_facade_projection',
      source: 'renderer',
      message: 'Avatar facade presence has not been probed.',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      projectionRef: null,
      configurationRef: null,
      backendKind: null,
      visualReadiness: 'not_projected',
      voiceReadiness: 'not_projected',
      launchAvailable: false,
      manageAvailable: false,
      launchHandoff: null,
      unsupportedFields: [
        'configurationId',
        'displayName',
        'compatibilityTier',
        'readinessState',
        'liveInstanceBinding',
        'presentationHandoffState',
        'avatarDiagnosticCode',
        'assetManifestPath',
        'motionState',
        'expressionState',
      ],
    },
    chat: {
      transport: 'electron-ipc',
      ready: false,
      state: 'idle',
      reasonCode: 'runtime-agent-chat-idle',
      actionHint: 'send_runtime_agent_turn',
      source: 'renderer',
      message: 'Runtime Agent chat has not started.',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      conversationAnchorId: null,
      requestId: null,
      runtimeTurnId: null,
      runtimeStreamId: null,
      eventTypes: [],
      messageCount: 0,
      messages: [],
      latestAssistantText: null,
      reasoningText: null,
      outputText: null,
      diagnostics: null,
    },
    route: {
      transport: 'electron-ipc',
      ready: false,
      capability: 'text.generate',
      configRevision: null,
      readinessRevision: null,
      updatedAt: null,
      updatedByAppId: null,
      capabilities: {},
      executionBinding: null,
      reasonCode: 'not-probed',
      actionHint: 'fetch_runtime_agent_ai_config',
      source: 'renderer',
      message: 'Runtime Agent AI Config has not been fetched.',
    },
    turn: {
      transport: 'electron-ipc',
      ready: false,
      reasonCode: 'not-probed',
      actionHint: 'configure_runtime_agent_ai_config',
      source: 'renderer',
      message: 'Runtime turn readiness has not been probed.',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      conversationAnchorId: null,
      requestId: null,
      runtimeTurnId: null,
      runtimeStreamId: null,
      messageId: null,
    },
    composer: {
      submitState: 'idle',
      draftLength: 0,
      reasonCode: 'not-probed',
      actionHint: 'enter_runtime_agent_turn_text',
      source: 'renderer',
      message: 'Runtime Agent composer has not been used.',
    },
    productRegions: ['presence', 'conversation', 'memory', 'capability', 'proposal', 'delegation', 'identity', 'companion', 'avatar', 'diagnostics'],
  };
}
