import type {
  RuntimeAgentConversationProjectionState,
} from '@nimiplatform/kit/features/chat/headless';
import type {
  AvatarEmotionCue,
  AvatarHostHandoffResult,
  RuntimeAgentEmotionId,
  RuntimeAgentEmotionIntensity,
} from '@nimiplatform/kit/features/avatar/headless';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import {
  createInitialZhiyuDelegationEvidence,
  type ZhiyuDelegationUxStatus,
} from './delegation-evidence';
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

export type ZhiyuConversationActionProjection = {
  readonly actionId: string;
  readonly turnId: string;
  readonly capabilityContract: 'image.generate';
  readonly status: 'planned' | 'started' | 'completed' | 'failed';
  readonly reasonCode: string | null;
  readonly message: string | null;
};

export type ZhiyuRuntimeAgentChatStatus = {
  readonly transport: 'electron-ipc';
  readonly ready: boolean;
  readonly state: 'idle' | 'streaming' | 'completed' | 'failed' | 'canceled';
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly agentHandle: NimiLocalAppAgentHandle | null;
  readonly conversationAnchorId: string | null;
  readonly requestId: string | null;
  readonly runtimeTurnId: string | null;
  readonly runtimeStreamId: string | null;
  readonly eventTypes: readonly string[];
  readonly messageCount: number;
  readonly messages: RuntimeAgentConversationProjectionState['messages'];
	readonly actions: readonly ZhiyuConversationActionProjection[];
  readonly latestAssistantText: string | null;
  readonly reasoningText: string | null;
  readonly outputText: string | null;
  readonly diagnostics: RuntimeAgentConversationProjectionState['diagnostics'];
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
    readonly projectionState: 'ready' | 'blocked' | 'truncated' | 'failed' | 'unknown';
  };
  readonly inventory: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly count: number;
    readonly localAgents: readonly {
      readonly agentHandle: NimiLocalAppAgentHandle;
      readonly displayName: string;
      readonly avatarUrl: string | null;
    }[];
  };
  readonly localAgent: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly agentHandle: NimiLocalAppAgentHandle | null;
  };
  readonly conversation: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly agentHandle: NimiLocalAppAgentHandle | null;
    readonly conversationAnchorId: string | null;
    readonly threadId: string | null;
  };
  readonly companion: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly state: 'blocked' | 'projected';
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly agentHandle: NimiLocalAppAgentHandle | null;
    readonly observedAt: string | null;
    readonly stateUpdatedAt: string | null;
    readonly executionState: string | null;
    readonly statusText: string | null;
    readonly activityCategory: string | null;
    readonly activityIntensity: string | null;
    readonly postureActionFamily: string | null;
    readonly postureInterruptMode: string | null;
    readonly currentEmotion: RuntimeAgentEmotionId | null;
    readonly currentEmotionId: RuntimeAgentEmotionId | null;
    readonly currentEmotionCue: AvatarEmotionCue | null;
    readonly currentEmotionIntensity: RuntimeAgentEmotionIntensity | null;
    readonly emotionViolation: ZhiyuCompanionEmotionViolation | null;
    readonly projectedFields: readonly string[];
    readonly unsupportedExplainabilityFields: readonly string[];
  };
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
    readonly agentHandle: NimiLocalAppAgentHandle | null;
    readonly conversationAnchorId: string | null;
    readonly launchAvailable: boolean;
    readonly hostHandoff: AvatarHostHandoffResult | null;
  };
  readonly chat: ZhiyuRuntimeAgentChatStatus;
  readonly turn: {
    readonly transport: 'electron-ipc';
    readonly ready: boolean;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source: string;
    readonly message: string;
    readonly agentHandle: NimiLocalAppAgentHandle | null;
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
      projectionState: 'unknown',
    },
    inventory: {
      transport: 'electron-ipc',
      ready: false,
      reasonCode: 'not-probed',
      actionHint: 'list_runtime_local_agents',
      source: 'renderer',
      message: 'Runtime LocalAgent inventory has not been probed.',
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
      agentHandle: null,
    },
    conversation: {
      transport: 'electron-ipc',
      ready: false,
      reasonCode: 'not-probed',
      actionHint: 'open_runtime_conversation_anchor',
      source: 'renderer',
      message: 'Runtime conversation home has not been probed.',
      agentHandle: null,
      conversationAnchorId: null,
      threadId: null,
    },
    companion: {
      transport: 'electron-ipc',
      ready: false,
      state: 'blocked',
      reasonCode: 'not-probed',
      actionHint: 'probe_runtime_agent_state_projection',
      source: 'renderer',
      message: 'Runtime Agent companion state has not been probed.',
      agentHandle: null,
      observedAt: null,
      stateUpdatedAt: null,
      executionState: null,
      statusText: null,
      activityCategory: null,
      activityIntensity: null,
      postureActionFamily: null,
      postureInterruptMode: null,
      currentEmotion: null,
      currentEmotionId: null,
      currentEmotionCue: null,
      currentEmotionIntensity: null,
      emotionViolation: null,
      projectedFields: [],
      unsupportedExplainabilityFields: [
        'posture',
        'postureSource',
        'stateConfidence',
        'whyThisState',
        'relationshipContext',
        'stateChangeHistory',
      ],
    },
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
      message: 'Avatar Host handoff target has not been projected.',
      agentHandle: null,
      conversationAnchorId: null,
      launchAvailable: false,
      hostHandoff: null,
    },
    chat: {
      transport: 'electron-ipc',
      ready: false,
      state: 'idle',
      reasonCode: 'runtime-agent-chat-idle',
      actionHint: 'send_runtime_agent_turn',
      source: 'renderer',
      message: 'Runtime Agent chat has not started.',
      agentHandle: null,
      conversationAnchorId: null,
      requestId: null,
      runtimeTurnId: null,
      runtimeStreamId: null,
      eventTypes: [],
      messageCount: 0,
      messages: [],
		actions: [],
      latestAssistantText: null,
      reasoningText: null,
      outputText: null,
      diagnostics: null,
    },
    turn: {
      transport: 'electron-ipc',
      ready: false,
      reasonCode: 'not-probed',
      actionHint: 'open_runtime_conversation_anchor',
      source: 'renderer',
      message: 'Runtime turn readiness has not been probed.',
      agentHandle: null,
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
