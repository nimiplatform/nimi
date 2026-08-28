import { describe, expect, it } from 'vitest';
import {
  arbitrateAvatarLaunch,
  evaluateStartWithChatGate,
  type AvatarLaunchArbitrationInput,
  type StartWithChatGateConditionId,
  type StartWithChatGateInput,
} from '../src/headless';

const AGENT_HANDLE = `agent_ref_${'A'.repeat(43)}`;
const REUSE_INSTANCE = 'avatar-instance:reuse';
const NEW_INSTANCE = 'avatar-instance:new';

function passingGateInput(): StartWithChatGateInput {
  return {
    userLoggedIn: true,
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: 'anchor-1',
    avatarAssetRef: 'avatar-asset:1',
    avatarAssetValidationStatus: 'valid',
    backendCapabilityProfileRef: 'backend-profile:1',
    runtimeProjectionAuthorization: 'authorized',
    launchMode: 'start_with_chat',
    avatarInstancePolicy: 'reuse_active_instance',
  };
}

function arbitrationInput(overrides: Partial<AvatarLaunchArbitrationInput> = {}): AvatarLaunchArbitrationInput {
  return {
    avatarInstancePolicy: 'reuse_active_instance',
    trigger: 'start_with_chat',
    agentHandle: AGENT_HANDLE,
    conversationAnchorId: 'anchor-1',
    reuseInstanceId: REUSE_INSTANCE,
    newInstanceId: NEW_INSTANCE,
    liveInstances: [],
    newInstanceAlreadySpawnedForThisOpenEvent: false,
    ...overrides,
  };
}

describe('avatar launch arbitration', () => {
  it('auto-launches only when all start_with_chat gate conditions hold', () => {
    const result = evaluateStartWithChatGate(passingGateInput());
    expect(result.decision).toBe('auto_launch');
    expect(result.conditions).toHaveLength(8);
    expect(result.conditions.every((condition) => condition.passed)).toBe(true);
    if (result.decision === 'auto_launch') {
      expect(result.avatarInstancePolicy).toBe('reuse_active_instance');
    }
  });

  it('fails closed on each individual start_with_chat gate condition', () => {
    const cases: Array<{ id: StartWithChatGateConditionId; patch: Partial<StartWithChatGateInput> }> = [
      { id: 'user_logged_in', patch: { userLoggedIn: false } },
      { id: 'local_agent_target', patch: { agentHandle: 'local-agent:owner-1:agent-1' } },
      { id: 'conversation_anchor_present', patch: { conversationAnchorId: null } },
      { id: 'local_avatar_asset_valid', patch: { avatarAssetRef: null } },
      { id: 'backend_capability_posture_valid', patch: { backendCapabilityProfileRef: null } },
      { id: 'runtime_projection_authorized', patch: { runtimeProjectionAuthorization: 'unknown' } },
      { id: 'launch_mode_start_with_chat', patch: { launchMode: 'manual' } },
      { id: 'instance_policy_resolvable', patch: { avatarInstancePolicy: 'invalid_policy' } },
    ];

    for (const { id, patch } of cases) {
      const input = { ...passingGateInput(), ...patch };
      const result = evaluateStartWithChatGate(input);
      expect(result.decision).toBe('no_launch');
      if (result.decision === 'no_launch') {
        expect(result.failedCondition).toBe(id);
      }
    }
  });

  it('branches explicit and start_with_chat launch decisions on instance policy', () => {
    expect(arbitrateAvatarLaunch(arbitrationInput())).toEqual({
      decision: 'launch_instance',
      avatarInstanceId: REUSE_INSTANCE,
      policy: 'reuse_active_instance',
    });
    expect(arbitrateAvatarLaunch(arbitrationInput({
      liveInstances: [{ avatarInstanceId: REUSE_INSTANCE, agentHandle: AGENT_HANDLE }],
    }))).toEqual({
      decision: 'reuse_instance',
      avatarInstanceId: REUSE_INSTANCE,
      policy: 'reuse_active_instance',
    });
    expect(arbitrateAvatarLaunch(arbitrationInput({
      avatarInstancePolicy: 'require_user_selection',
      liveInstances: [{ avatarInstanceId: REUSE_INSTANCE, agentHandle: AGENT_HANDLE }],
    }))).toEqual({
      decision: 'require_user_selection',
      policy: 'require_user_selection',
      candidateInstanceIds: [REUSE_INSTANCE],
    });
    expect(arbitrateAvatarLaunch(arbitrationInput({
      avatarInstancePolicy: 'launch_new_instance',
      trigger: 'explicit_user_action',
      newInstanceAlreadySpawnedForThisOpenEvent: true,
    }))).toEqual({
      decision: 'launch_instance',
      avatarInstanceId: NEW_INSTANCE,
      policy: 'launch_new_instance',
    });
  });

  it('fails closed for missing anchors, conflicts, and unresolved policies', () => {
    expect(arbitrateAvatarLaunch(arbitrationInput({ conversationAnchorId: null }))).toEqual({
      decision: 'fail_closed',
      state: 'anchor_unavailable',
      policy: 'reuse_active_instance',
    });
    expect(arbitrateAvatarLaunch(arbitrationInput({
      liveInstances: [{ avatarInstanceId: 'avatar-instance:other', agentHandle: AGENT_HANDLE }],
    }))).toEqual({
      decision: 'fail_closed',
      state: 'instance_conflict',
      policy: 'reuse_active_instance',
    });
    expect(arbitrateAvatarLaunch(arbitrationInput({ avatarInstancePolicy: 'invalid_policy' }))).toEqual({
      decision: 'fail_closed',
      state: 'instance_policy_unresolved',
      policy: null,
    });
    expect(arbitrateAvatarLaunch(arbitrationInput({
      avatarInstancePolicy: 'launch_new_instance',
      trigger: 'start_with_chat',
      newInstanceAlreadySpawnedForThisOpenEvent: true,
    }))).toEqual({
      decision: 'fail_closed',
      state: 'instance_conflict',
      policy: 'launch_new_instance',
    });
  });
});
