const LOCAL_AGENT_REF_PREFIX = 'local-agent:';

export const AVATAR_INSTANCE_POLICY_VALUES = [
  'reuse_active_instance',
  'launch_new_instance',
  'require_user_selection',
] as const;

export type AvatarInstancePolicy = typeof AVATAR_INSTANCE_POLICY_VALUES[number];

export type AvatarRuntimeProjectionAuthorization = 'authorized' | 'unauthorized' | 'unknown';

export type StartWithChatGateConditionId =
  | 'user_logged_in'
  | 'local_agent_target'
  | 'conversation_anchor_present'
  | 'local_avatar_asset_valid'
  | 'backend_capability_posture_valid'
  | 'runtime_projection_authorized'
  | 'launch_mode_start_with_chat'
  | 'instance_policy_resolvable';

export type StartWithChatGateInput = {
  readonly userLoggedIn: boolean;
  readonly localAgentRef: string | null;
  readonly runtimeSourceRef: string | null;
  readonly conversationAnchorId: string | null;
  readonly localAvatarAssetRef: string | null;
  readonly localAvatarAssetValidationStatus: string | null;
  readonly backendCapabilityProfileRef: string | null;
  readonly runtimeProjectionAuthorization: AvatarRuntimeProjectionAuthorization;
  readonly launchMode: string | null;
  readonly avatarInstancePolicy: string | null;
};

export type StartWithChatGateConditionResult = {
  readonly id: StartWithChatGateConditionId;
  readonly passed: boolean;
};

export type StartWithChatGateResult =
  | {
      readonly decision: 'auto_launch';
      readonly conditions: readonly StartWithChatGateConditionResult[];
      readonly avatarInstancePolicy: AvatarInstancePolicy;
    }
  | {
      readonly decision: 'no_launch';
      readonly conditions: readonly StartWithChatGateConditionResult[];
      readonly failedCondition: StartWithChatGateConditionId;
    };

export type AvatarLiveInstanceView = {
  readonly avatarInstanceId: string;
  readonly localAgentRef: string;
};

export type AvatarLaunchArbitrationFailClosedState =
  | 'anchor_unavailable'
  | 'instance_conflict'
  | 'instance_policy_unresolved'
  | 'user_selection_required';

export type AvatarLaunchArbitrationResult =
  | {
      readonly decision: 'reuse_instance';
      readonly avatarInstanceId: string;
      readonly policy: AvatarInstancePolicy;
    }
  | {
      readonly decision: 'launch_instance';
      readonly avatarInstanceId: string;
      readonly policy: AvatarInstancePolicy;
    }
  | {
      readonly decision: 'require_user_selection';
      readonly policy: AvatarInstancePolicy;
      readonly candidateInstanceIds: readonly string[];
    }
  | {
      readonly decision: 'fail_closed';
      readonly state: AvatarLaunchArbitrationFailClosedState;
      readonly policy: AvatarInstancePolicy | null;
    };

export type AvatarLaunchTrigger = 'start_with_chat' | 'explicit_user_action';

export type AvatarLaunchArbitrationInput = {
  readonly avatarInstancePolicy: string | null;
  readonly trigger: AvatarLaunchTrigger;
  readonly localAgentRef: string | null;
  readonly conversationAnchorId: string | null;
  readonly reuseInstanceId: string;
  readonly newInstanceId: string;
  readonly liveInstances: readonly AvatarLiveInstanceView[];
  readonly newInstanceAlreadySpawnedForThisOpenEvent: boolean;
};

function isResolvableInstancePolicy(value: string | null): value is AvatarInstancePolicy {
  return value !== null && (AVATAR_INSTANCE_POLICY_VALUES as readonly string[]).includes(value);
}

function isLocalAgentTarget(localAgentRef: string | null, runtimeSourceRef: string | null): boolean {
  if (!localAgentRef) {
    return false;
  }
  if (!localAgentRef.startsWith(LOCAL_AGENT_REF_PREFIX)) {
    return false;
  }
  return runtimeSourceRef === null || localAgentRef !== runtimeSourceRef;
}

export function evaluateStartWithChatGate(input: StartWithChatGateInput): StartWithChatGateResult {
  const conditions: StartWithChatGateConditionResult[] = [
    { id: 'user_logged_in', passed: input.userLoggedIn === true },
    { id: 'local_agent_target', passed: isLocalAgentTarget(input.localAgentRef, input.runtimeSourceRef) },
    { id: 'conversation_anchor_present', passed: Boolean(input.conversationAnchorId?.trim()) },
    {
      id: 'local_avatar_asset_valid',
      passed: Boolean(input.localAvatarAssetRef?.trim() && input.localAvatarAssetValidationStatus === 'valid'),
    },
    {
      id: 'backend_capability_posture_valid',
      passed: Boolean(input.backendCapabilityProfileRef?.trim() && input.localAvatarAssetValidationStatus === 'valid'),
    },
    { id: 'runtime_projection_authorized', passed: input.runtimeProjectionAuthorization === 'authorized' },
    { id: 'launch_mode_start_with_chat', passed: input.launchMode === 'start_with_chat' },
    { id: 'instance_policy_resolvable', passed: isResolvableInstancePolicy(input.avatarInstancePolicy) },
  ];

  const firstFailed = conditions.find((condition) => !condition.passed);
  if (firstFailed) {
    return {
      decision: 'no_launch',
      conditions,
      failedCondition: firstFailed.id,
    };
  }

  return {
    decision: 'auto_launch',
    conditions,
    avatarInstancePolicy: input.avatarInstancePolicy as AvatarInstancePolicy,
  };
}

export function arbitrateAvatarLaunch(input: AvatarLaunchArbitrationInput): AvatarLaunchArbitrationResult {
  if (!isResolvableInstancePolicy(input.avatarInstancePolicy)) {
    return { decision: 'fail_closed', state: 'instance_policy_unresolved', policy: null };
  }
  const policy = input.avatarInstancePolicy;

  if (!input.conversationAnchorId?.trim()) {
    return { decision: 'fail_closed', state: 'anchor_unavailable', policy };
  }

  const liveForTarget = input.liveInstances.filter((instance) => instance.localAgentRef === input.localAgentRef);
  const reuseInstance = liveForTarget.find((instance) => instance.avatarInstanceId === input.reuseInstanceId);

  if (policy === 'reuse_active_instance') {
    if (reuseInstance) {
      return { decision: 'reuse_instance', avatarInstanceId: reuseInstance.avatarInstanceId, policy };
    }
    if (liveForTarget.length > 0) {
      return { decision: 'fail_closed', state: 'instance_conflict', policy };
    }
    return { decision: 'launch_instance', avatarInstanceId: input.reuseInstanceId, policy };
  }

  if (policy === 'launch_new_instance') {
    if (input.trigger === 'start_with_chat' && input.newInstanceAlreadySpawnedForThisOpenEvent) {
      return { decision: 'fail_closed', state: 'instance_conflict', policy };
    }
    return { decision: 'launch_instance', avatarInstanceId: input.newInstanceId, policy };
  }

  return {
    decision: 'require_user_selection',
    policy,
    candidateInstanceIds: liveForTarget.map((instance) => instance.avatarInstanceId),
  };
}
