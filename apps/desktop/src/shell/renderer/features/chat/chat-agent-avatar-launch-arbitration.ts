/**
 * D-LLM-105 `start_with_chat` auto-launch gate and D-LLM-106 instance-policy
 * launch arbitration.
 *
 * This module is the single launch-decision authority for Desktop Avatar:
 *
 * - `evaluateStartWithChatGate` is the sole actuation authority for
 *   `launch_mode='start_with_chat'` (D-LLM-105). It evaluates all eight
 *   admitted conditions on every Agent-Chat-open event for the selected
 *   LocalAgent. Any false condition fails the whole gate closed to a typed
 *   non-launch outcome.
 * - `arbitrateAvatarLaunch` branches every launch decision — both the
 *   `start_with_chat` gate and the explicit launch entries — on the configured
 *   `avatar_instance_policy` (D-LLM-106). Instance-conflict and
 *   anchor-unavailable fail closed to typed product states.
 *
 * The module is pure (no React, no I/O). The launch payload it authorizes
 * stays the D-LLM-072 triple; this module never widens it.
 */

import type { AgentCenterAvatarInstancePolicy } from './chat-agent-center-avatar-config-types';
import { AVATAR_INSTANCE_POLICY_VALUES } from './chat-agent-center-avatar-config-types';

const LOCAL_AGENT_REF_PREFIX = 'local-agent:';

/**
 * Typed runtime authorization result for D-LLM-105 condition 6. It MUST be a
 * typed authorization verdict, never inferred from a configuration record or
 * prior same-agent traffic.
 */
export type AvatarRuntimeProjectionAuthorization = 'authorized' | 'unauthorized' | 'unknown';

/** Closed identifier set for each of the eight D-LLM-105 gate conditions. */
export type StartWithChatGateConditionId =
  | 'user_logged_in'
  | 'local_agent_target'
  | 'conversation_anchor_present'
  | 'local_avatar_asset_valid'
  | 'backend_capability_posture_valid'
  | 'runtime_projection_authorized'
  | 'launch_mode_start_with_chat'
  | 'instance_policy_resolvable';

/**
 * Typed inputs for the eight-condition gate. Every field is a typed evidence
 * value resolved upstream; the gate never re-derives upstream truth.
 */
export type StartWithChatGateInput = {
  /** Condition 1 — user is logged in (typed account projection present). */
  userLoggedIn: boolean;
  /** Condition 2 — the selected target's LocalAgent ref, or null. */
  localAgentRef: string | null;
  /**
   * Condition 2 — the bare RealmAgent id of the selected target. Used to
   * fail closed when a target resolves to a RealmAgent rather than a LocalAgent.
   */
  realmAgentId: string | null;
  /** Condition 3 — the resolved conversation anchor id, or null. */
  conversationAnchorId: string | null;
  /** Condition 4 — the selected local Avatar asset ref, or null. */
  localAvatarAssetRef: string | null;
  /**
   * Condition 4 + 5 — the typed local-asset validation verdict. `valid` is the
   * only passing value; any other typed status fails the gate closed.
   */
  localAvatarAssetValidationStatus: string | null;
  /** Condition 5 — the resolved backend capability profile ref, or null. */
  backendCapabilityProfileRef: string | null;
  /** Condition 6 — typed runtime projection authorization verdict. */
  runtimeProjectionAuthorization: AvatarRuntimeProjectionAuthorization;
  /** Condition 7 — the configured launch mode for the selected LocalAgent. */
  launchMode: string | null;
  /** Condition 8 — the configured instance policy for the selected LocalAgent. */
  avatarInstancePolicy: string | null;
};

export type StartWithChatGateConditionResult = {
  id: StartWithChatGateConditionId;
  passed: boolean;
};

/**
 * Typed gate outcome. `decision: 'auto_launch'` is the only outcome that emits
 * a launch intent; `decision: 'no_launch'` is the fail-closed typed non-launch
 * outcome and always carries the first failed condition.
 */
export type StartWithChatGateResult =
  | {
      decision: 'auto_launch';
      conditions: readonly StartWithChatGateConditionResult[];
      /** The resolved instance policy, guaranteed valid when the gate passes. */
      avatarInstancePolicy: AgentCenterAvatarInstancePolicy;
    }
  | {
      decision: 'no_launch';
      conditions: readonly StartWithChatGateConditionResult[];
      /** The first condition that failed; the gate fails closed on the first false. */
      failedCondition: StartWithChatGateConditionId;
    };

function isResolvableInstancePolicy(value: string | null): value is AgentCenterAvatarInstancePolicy {
  return value !== null && (AVATAR_INSTANCE_POLICY_VALUES as readonly string[]).includes(value);
}

function isLocalAgentTarget(localAgentRef: string | null, realmAgentId: string | null): boolean {
  if (!localAgentRef) {
    return false;
  }
  if (!localAgentRef.startsWith(LOCAL_AGENT_REF_PREFIX)) {
    return false;
  }
  // A bare RealmAgent id is not a LocalAgent target.
  if (realmAgentId !== null && localAgentRef === realmAgentId) {
    return false;
  }
  return true;
}

/**
 * D-LLM-105 — evaluate the eight-condition `start_with_chat` auto-launch gate.
 *
 * All eight conditions are evaluated. The gate emits an `auto_launch` decision
 * only when every condition is true; a single false condition fails the whole
 * gate closed to a typed `no_launch` outcome. The function is the only place
 * that decides whether a `start_with_chat` launch intent may be emitted.
 */
export function evaluateStartWithChatGate(input: StartWithChatGateInput): StartWithChatGateResult {
  const conditions: StartWithChatGateConditionResult[] = [
    {
      id: 'user_logged_in',
      passed: input.userLoggedIn === true,
    },
    {
      id: 'local_agent_target',
      passed: isLocalAgentTarget(input.localAgentRef, input.realmAgentId),
    },
    {
      id: 'conversation_anchor_present',
      passed: Boolean(input.conversationAnchorId && input.conversationAnchorId.trim()),
    },
    {
      id: 'local_avatar_asset_valid',
      passed: Boolean(
        input.localAvatarAssetRef
          && input.localAvatarAssetRef.trim()
          && input.localAvatarAssetValidationStatus === 'valid',
      ),
    },
    {
      id: 'backend_capability_posture_valid',
      passed: Boolean(
        input.backendCapabilityProfileRef
          && input.backendCapabilityProfileRef.trim()
          && input.localAvatarAssetValidationStatus === 'valid',
      ),
    },
    {
      id: 'runtime_projection_authorized',
      passed: input.runtimeProjectionAuthorization === 'authorized',
    },
    {
      id: 'launch_mode_start_with_chat',
      passed: input.launchMode === 'start_with_chat',
    },
    {
      id: 'instance_policy_resolvable',
      passed: isResolvableInstancePolicy(input.avatarInstancePolicy),
    },
  ];

  const firstFailed = conditions.find((condition) => !condition.passed);
  if (firstFailed) {
    return {
      decision: 'no_launch',
      conditions,
      failedCondition: firstFailed.id,
    };
  }

  // All eight conditions hold; instance policy is therefore resolvable.
  return {
    decision: 'auto_launch',
    conditions,
    avatarInstancePolicy: input.avatarInstancePolicy as AgentCenterAvatarInstancePolicy,
  };
}

/** A live Avatar instance as seen by the launch decision. */
export type AvatarLiveInstanceView = {
  avatarInstanceId: string;
  localAgentRef: string;
};

/** Typed non-launch product states produced by instance-policy arbitration. */
export type AvatarLaunchArbitrationFailClosedState =
  | 'anchor_unavailable'
  | 'instance_conflict'
  | 'instance_policy_unresolved'
  | 'user_selection_required';

/**
 * Typed arbitration outcome. The launch decision branches on
 * `avatar_instance_policy` and produces exactly one of:
 *
 * - `reuse_instance` — an existing live instance is reused; no new launch.
 * - `launch_instance` — exactly one launch intent with a resolved instance id.
 * - `require_user_selection` — a user selection must be presented before launch.
 * - `fail_closed` — a typed non-launch product state (anchor unavailable,
 *   instance conflict, unresolved policy).
 */
export type AvatarLaunchArbitrationResult =
  | {
      decision: 'reuse_instance';
      avatarInstanceId: string;
      policy: AgentCenterAvatarInstancePolicy;
    }
  | {
      decision: 'launch_instance';
      avatarInstanceId: string;
      policy: AgentCenterAvatarInstancePolicy;
    }
  | {
      decision: 'require_user_selection';
      policy: AgentCenterAvatarInstancePolicy;
      candidateInstanceIds: readonly string[];
    }
  | {
      decision: 'fail_closed';
      state: AvatarLaunchArbitrationFailClosedState;
      policy: AgentCenterAvatarInstancePolicy | null;
    };

/** How a launch decision is being driven. */
export type AvatarLaunchTrigger = 'start_with_chat' | 'explicit_user_action';

export type AvatarLaunchArbitrationInput = {
  /** The configured instance policy for the selected LocalAgent. */
  avatarInstancePolicy: string | null;
  /** What is driving this launch decision. */
  trigger: AvatarLaunchTrigger;
  /** The selected target's LocalAgent ref. */
  localAgentRef: string | null;
  /** The resolved conversation anchor id, or null. */
  conversationAnchorId: string | null;
  /** The deterministic reuse instance id for `{ LocalAgent, conversation anchor }`. */
  reuseInstanceId: string;
  /** The fresh instance id to use when launching a new instance. */
  newInstanceId: string;
  /** Live Avatar instances currently observed for the selected LocalAgent. */
  liveInstances: readonly AvatarLiveInstanceView[];
  /**
   * True when this open event has already spawned a new instance under
   * `launch_new_instance`. The launch decision MUST NOT spawn again on
   * re-evaluation of the same Agent-Chat-open event.
   */
  newInstanceAlreadySpawnedForThisOpenEvent: boolean;
};

/**
 * D-LLM-106 — branch the launch decision on `avatar_instance_policy`.
 *
 * Every launch decision (the `start_with_chat` gate and explicit launch
 * entries) routes through this function. The three policies produce three
 * distinct launch-time outcomes; instance-conflict and anchor-unavailable fail
 * closed to typed product states. The repeated-spawn guard for
 * `launch_new_instance` is a launch-decision concern only — it never makes
 * Desktop an Avatar instance lifecycle owner.
 */
export function arbitrateAvatarLaunch(input: AvatarLaunchArbitrationInput): AvatarLaunchArbitrationResult {
  if (!isResolvableInstancePolicy(input.avatarInstancePolicy)) {
    return { decision: 'fail_closed', state: 'instance_policy_unresolved', policy: null };
  }
  const policy: AgentCenterAvatarInstancePolicy = input.avatarInstancePolicy;

  // Anchor-unavailable fails closed for every policy: D-LLM-106 forbids
  // substituting a guessed or remembered anchor.
  if (!input.conversationAnchorId || !input.conversationAnchorId.trim()) {
    return { decision: 'fail_closed', state: 'anchor_unavailable', policy };
  }

  const liveForTarget = input.liveInstances.filter(
    (instance) => instance.localAgentRef === input.localAgentRef,
  );
  const reuseInstance = liveForTarget.find(
    (instance) => instance.avatarInstanceId === input.reuseInstanceId,
  );

  if (policy === 'reuse_active_instance') {
    if (reuseInstance) {
      // Reuse the active instance for the same { LocalAgent, conversation anchor }.
      return { decision: 'reuse_instance', avatarInstanceId: reuseInstance.avatarInstanceId, policy };
    }
    // A live instance for this LocalAgent exists but does not match the
    // { LocalAgent, conversation anchor } reuse target: the policy cannot
    // resolve the collision without a duplicate spawn, so fail closed.
    if (liveForTarget.length > 0) {
      return { decision: 'fail_closed', state: 'instance_conflict', policy };
    }
    // No live instance — launch exactly one.
    return { decision: 'launch_instance', avatarInstanceId: input.reuseInstanceId, policy };
  }

  if (policy === 'launch_new_instance') {
    if (input.trigger === 'start_with_chat') {
      // Repeated-spawn guard: a single Agent-Chat-open event spawns at most one
      // new instance. Re-evaluation of D-LLM-105 on the same open event must
      // not spawn additional instances.
      if (input.newInstanceAlreadySpawnedForThisOpenEvent) {
        return { decision: 'fail_closed', state: 'instance_conflict', policy };
      }
    }
    return { decision: 'launch_instance', avatarInstanceId: input.newInstanceId, policy };
  }

  // require_user_selection — present a selection when more than one valid
  // launch posture exists; never auto-resolve.
  if (liveForTarget.length > 0) {
    return {
      decision: 'require_user_selection',
      policy,
      candidateInstanceIds: liveForTarget.map((instance) => instance.avatarInstanceId),
    };
  }
  // No live instance: a single fresh launch posture exists, but the policy
  // requires the user to confirm which posture to launch.
  return {
    decision: 'require_user_selection',
    policy,
    candidateInstanceIds: [],
  };
}
