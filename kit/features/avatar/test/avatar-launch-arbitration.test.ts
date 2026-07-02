import { describe, expect, it } from 'vitest';
import {
  arbitrateAvatarLaunch,
  evaluateStartWithChatGate,
  type AvatarLaunchArbitrationInput,
  type StartWithChatGateConditionId,
  type StartWithChatGateInput,
} from '../src/headless';

const LOCAL_AGENT = 'local-agent:owner-1:agent-1';
const REUSE_INSTANCE = 'avatar-instance:reuse';
const NEW_INSTANCE = 'avatar-instance:new';

function passingGateInput(): StartWithChatGateInput {
  return {
    userLoggedIn: true,
    localAgentRef: LOCAL_AGENT,
    runtimeSourceRef: 'runtime-source:agent-1',
    conversationAnchorId: 'anchor-1',
    localAvatarAssetRef: 'avatar-asset:1',
    localAvatarAssetValidationStatus: 'valid',
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
    localAgentRef: LOCAL_AGENT,
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
    const mutators: Array<{ id: StartWithChatGateConditionId; mutate: (input: StartWithChatGateInput) => void }> = [
      { id: 'user_logged_in', mutate: (input) => { input.userLoggedIn = false; } },
      { id: 'local_agent_target', mutate: (input) => { input.localAgentRef = 'runtime-source:agent-1'; input.runtimeSourceRef = 'runtime-source:agent-1'; } },
      { id: 'conversation_anchor_present', mutate: (input) => { input.conversationAnchorId = null; } },
      { id: 'local_avatar_asset_valid', mutate: (input) => { input.localAvatarAssetRef = null; } },
      { id: 'backend_capability_posture_valid', mutate: (input) => { input.backendCapabilityProfileRef = null; } },
      { id: 'runtime_projection_authorized', mutate: (input) => { input.runtimeProjectionAuthorization = 'unknown'; } },
      { id: 'launch_mode_start_with_chat', mutate: (input) => { input.launchMode = 'manual'; } },
      { id: 'instance_policy_resolvable', mutate: (input) => { input.avatarInstancePolicy = 'invalid_policy'; } },
    ];

    for (const { id, mutate } of mutators) {
      const input = passingGateInput();
      mutate(input);
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
      liveInstances: [{ avatarInstanceId: REUSE_INSTANCE, localAgentRef: LOCAL_AGENT }],
    }))).toEqual({
      decision: 'reuse_instance',
      avatarInstanceId: REUSE_INSTANCE,
      policy: 'reuse_active_instance',
    });
    expect(arbitrateAvatarLaunch(arbitrationInput({
      avatarInstancePolicy: 'require_user_selection',
      liveInstances: [{ avatarInstanceId: REUSE_INSTANCE, localAgentRef: LOCAL_AGENT }],
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
      liveInstances: [{ avatarInstanceId: 'avatar-instance:other', localAgentRef: LOCAL_AGENT }],
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
