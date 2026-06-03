import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  arbitrateAvatarLaunch,
  evaluateStartWithChatGate,
  type AvatarLaunchArbitrationInput,
  type StartWithChatGateConditionId,
  type StartWithChatGateInput,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-launch-arbitration';

const LOCAL_AGENT = 'local-agent:owner-1:agent-1';
const REUSE_INSTANCE = 'desktop-avatar-local-agent-owner-1-agent-1-thread-1';
const NEW_INSTANCE = 'desktop-avatar-local-agent-owner-1-agent-1-thread-1-nonce-1';

function passingGateInput(): StartWithChatGateInput {
  return {
    userLoggedIn: true,
    localAgentRef: LOCAL_AGENT,
    realmAgentId: 'agent-1',
    conversationAnchorId: 'anchor-1',
    localAvatarAssetRef: 'asset-ref-1',
    localAvatarAssetValidationStatus: 'valid',
    backendCapabilityProfileRef: 'backend-profile-1',
    runtimeProjectionAuthorization: 'authorized',
    launchMode: 'start_with_chat',
    avatarInstancePolicy: 'reuse_active_instance',
  };
}

// --- D-LLM-105 — eight-condition start_with_chat gate ---

test('start_with_chat gate auto-launches when all eight conditions hold', () => {
  const result = evaluateStartWithChatGate(passingGateInput());
  assert.equal(result.decision, 'auto_launch');
  assert.equal(result.conditions.length, 8);
  assert.ok(result.conditions.every((condition) => condition.passed));
  if (result.decision === 'auto_launch') {
    assert.equal(result.avatarInstancePolicy, 'reuse_active_instance');
  }
});

test('start_with_chat gate fails closed when any single condition is false', () => {
  const mutators: Array<{ id: StartWithChatGateConditionId; mutate: (input: StartWithChatGateInput) => void }> = [
    { id: 'user_logged_in', mutate: (input) => { input.userLoggedIn = false; } },
    { id: 'local_agent_target', mutate: (input) => { input.localAgentRef = 'agent-1'; input.realmAgentId = 'agent-1'; } },
    { id: 'conversation_anchor_present', mutate: (input) => { input.conversationAnchorId = null; } },
    { id: 'local_avatar_asset_valid', mutate: (input) => { input.localAvatarAssetRef = null; } },
    { id: 'backend_capability_posture_valid', mutate: (input) => { input.backendCapabilityProfileRef = null; } },
    { id: 'runtime_projection_authorized', mutate: (input) => { input.runtimeProjectionAuthorization = 'unauthorized'; } },
    { id: 'launch_mode_start_with_chat', mutate: (input) => { input.launchMode = 'manual'; } },
    { id: 'instance_policy_resolvable', mutate: (input) => { input.avatarInstancePolicy = 'bogus_policy'; } },
  ];
  for (const { id, mutate } of mutators) {
    const input = passingGateInput();
    mutate(input);
    const result = evaluateStartWithChatGate(input);
    assert.equal(result.decision, 'no_launch', `${id} should fail the gate closed`);
    if (result.decision === 'no_launch') {
      assert.equal(result.failedCondition, id, `gate must report ${id} as the failed condition`);
    }
  }
});

test('start_with_chat gate condition 2 rejects a RealmAgent target', () => {
  const input = passingGateInput();
  input.localAgentRef = 'realm-agent-99';
  input.realmAgentId = 'realm-agent-99';
  const result = evaluateStartWithChatGate(input);
  assert.equal(result.decision, 'no_launch');
  if (result.decision === 'no_launch') {
    assert.equal(result.failedCondition, 'local_agent_target');
  }
});

test('start_with_chat gate condition 6 rejects an unknown runtime authorization verdict', () => {
  const input = passingGateInput();
  input.runtimeProjectionAuthorization = 'unknown';
  const result = evaluateStartWithChatGate(input);
  assert.equal(result.decision, 'no_launch');
  if (result.decision === 'no_launch') {
    assert.equal(result.failedCondition, 'runtime_projection_authorized');
  }
});

test('start_with_chat gate condition 5 fails when local asset validation is not valid', () => {
  const input = passingGateInput();
  input.localAvatarAssetValidationStatus = 'unsupported_backend';
  const result = evaluateStartWithChatGate(input);
  assert.equal(result.decision, 'no_launch');
  if (result.decision === 'no_launch') {
    // Condition 4 catches the non-valid status first; condition 5 also depends on it.
    assert.equal(result.failedCondition, 'local_avatar_asset_valid');
  }
});

// --- D-LLM-106 — instance-policy launch arbitration ---

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

test('reuse_active_instance launches exactly one when no live instance exists', () => {
  const result = arbitrateAvatarLaunch(arbitrationInput());
  assert.equal(result.decision, 'launch_instance');
  if (result.decision === 'launch_instance') {
    assert.equal(result.avatarInstanceId, REUSE_INSTANCE);
    assert.equal(result.policy, 'reuse_active_instance');
  }
});

test('reuse_active_instance reuses the matching live instance instead of spawning a second', () => {
  const result = arbitrateAvatarLaunch(arbitrationInput({
    liveInstances: [{ avatarInstanceId: REUSE_INSTANCE, localAgentRef: LOCAL_AGENT }],
  }));
  assert.equal(result.decision, 'reuse_instance');
  if (result.decision === 'reuse_instance') {
    assert.equal(result.avatarInstanceId, REUSE_INSTANCE);
  }
});

test('reuse_active_instance fails closed on instance conflict (non-matching live instance)', () => {
  const result = arbitrateAvatarLaunch(arbitrationInput({
    liveInstances: [{ avatarInstanceId: 'desktop-avatar-stale-instance', localAgentRef: LOCAL_AGENT }],
  }));
  assert.equal(result.decision, 'fail_closed');
  if (result.decision === 'fail_closed') {
    assert.equal(result.state, 'instance_conflict');
  }
});

test('launch_new_instance spawns at most one instance per start_with_chat open event', () => {
  const first = arbitrateAvatarLaunch(arbitrationInput({
    avatarInstancePolicy: 'launch_new_instance',
    trigger: 'start_with_chat',
    newInstanceAlreadySpawnedForThisOpenEvent: false,
  }));
  assert.equal(first.decision, 'launch_instance');
  if (first.decision === 'launch_instance') {
    assert.equal(first.avatarInstanceId, NEW_INSTANCE);
  }
  const second = arbitrateAvatarLaunch(arbitrationInput({
    avatarInstancePolicy: 'launch_new_instance',
    trigger: 'start_with_chat',
    newInstanceAlreadySpawnedForThisOpenEvent: true,
  }));
  assert.equal(second.decision, 'fail_closed');
  if (second.decision === 'fail_closed') {
    assert.equal(second.state, 'instance_conflict');
  }
});

test('launch_new_instance for an explicit user action is not blocked by the open-event guard', () => {
  const result = arbitrateAvatarLaunch(arbitrationInput({
    avatarInstancePolicy: 'launch_new_instance',
    trigger: 'explicit_user_action',
    newInstanceAlreadySpawnedForThisOpenEvent: true,
  }));
  assert.equal(result.decision, 'launch_instance');
  if (result.decision === 'launch_instance') {
    assert.equal(result.avatarInstanceId, NEW_INSTANCE);
  }
});

test('require_user_selection prompts and never auto-resolves', () => {
  const withLive = arbitrateAvatarLaunch(arbitrationInput({
    avatarInstancePolicy: 'require_user_selection',
    liveInstances: [{ avatarInstanceId: REUSE_INSTANCE, localAgentRef: LOCAL_AGENT }],
  }));
  assert.equal(withLive.decision, 'require_user_selection');
  if (withLive.decision === 'require_user_selection') {
    assert.deepEqual(withLive.candidateInstanceIds, [REUSE_INSTANCE]);
  }
  const withoutLive = arbitrateAvatarLaunch(arbitrationInput({
    avatarInstancePolicy: 'require_user_selection',
  }));
  assert.equal(withoutLive.decision, 'require_user_selection');
  if (withoutLive.decision === 'require_user_selection') {
    assert.deepEqual(withoutLive.candidateInstanceIds, []);
  }
});

test('arbitration fails closed when the conversation anchor is unavailable', () => {
  for (const policy of ['reuse_active_instance', 'launch_new_instance', 'require_user_selection'] as const) {
    const result = arbitrateAvatarLaunch(arbitrationInput({
      avatarInstancePolicy: policy,
      conversationAnchorId: null,
    }));
    assert.equal(result.decision, 'fail_closed', `${policy} must fail closed without an anchor`);
    if (result.decision === 'fail_closed') {
      assert.equal(result.state, 'anchor_unavailable');
    }
  }
});

test('arbitration fails closed when the instance policy is unresolved', () => {
  const result = arbitrateAvatarLaunch(arbitrationInput({ avatarInstancePolicy: 'bogus_policy' }));
  assert.equal(result.decision, 'fail_closed');
  if (result.decision === 'fail_closed') {
    assert.equal(result.state, 'instance_policy_unresolved');
    assert.equal(result.policy, null);
  }
});

test('the three policies produce three distinct launch-time outcomes', () => {
  const reuse = arbitrateAvatarLaunch(arbitrationInput({
    avatarInstancePolicy: 'reuse_active_instance',
    liveInstances: [{ avatarInstanceId: REUSE_INSTANCE, localAgentRef: LOCAL_AGENT }],
  }));
  const launchNew = arbitrateAvatarLaunch(arbitrationInput({
    avatarInstancePolicy: 'launch_new_instance',
    trigger: 'explicit_user_action',
  }));
  const requireSelection = arbitrateAvatarLaunch(arbitrationInput({
    avatarInstancePolicy: 'require_user_selection',
    liveInstances: [{ avatarInstanceId: REUSE_INSTANCE, localAgentRef: LOCAL_AGENT }],
  }));
  assert.equal(reuse.decision, 'reuse_instance');
  assert.equal(launchNew.decision, 'launch_instance');
  assert.equal(requireSelection.decision, 'require_user_selection');
});

// --- D-LLM-105 — single actuation site + D-LLM-072 payload triple ---

const repoRoot = join(import.meta.dirname, '..');

test('start_with_chat is actuated only by the launch-arbitration gate (single actuation site)', () => {
  const controlsSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-local-avatar-launch-controls.ts'),
    'utf8',
  );
  // The controls hook is the single actuation site: it imports and calls the
  // D-LLM-105 gate evaluator.
  assert.match(controlsSource, /evaluateStartWithChatGate/u);
  assert.match(controlsSource, /arbitrateAvatarLaunch/u);
  // The launch executor branches every launch on instance-policy arbitration
  // before any handoff is emitted.
  const launchExecutor = controlsSource.match(
    /executeArbitratedLaunch[\s\S]*?launchDesktopAvatarHandoff\(\{[\s\S]*?\}\)/u,
  );
  assert.ok(launchExecutor, 'executeArbitratedLaunch must wrap the handoff call');
  assert.match(launchExecutor[0], /arbitrateAvatarLaunch\(/u);

  // No other Desktop source emits a start_with_chat launch source string
  // outside the arbitration module + the controls actuation site.
  const sourceRoot = join(repoRoot, 'src');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/u.test(entry.name)) {
        continue;
      }
      if (full.endsWith('chat-agent-local-avatar-launch-controls.ts')) {
        continue;
      }
      const text = readFileSync(full, 'utf8');
      if (/desktop-agent-chat-start-with-chat/u.test(text)) {
        offenders.push(full);
      }
    }
  };
  walk(sourceRoot);
  assert.deepEqual(offenders, [], 'start_with_chat launch source must originate only from the actuation site');
});

test('start_with_chat condition 6 is not inferred from local readiness', () => {
  const controlsSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-local-avatar-launch-controls.ts'),
    'utf8',
  );
  assert.match(controlsSource, /No admitted projection exists/u);
  assert.doesNotMatch(
    controlsSource,
    /avatarHandoffReady\s*&&\s*avatarRuntimeAccountReady[\s\S]{0,120}'authorized'/u,
  );
});

test('start_with_chat launch keeps the D-LLM-072 payload triple and does not widen it', () => {
  const controlsSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-local-avatar-launch-controls.ts'),
    'utf8',
  );
  const launchCall = controlsSource.match(/launchDesktopAvatarHandoff\(\{[\s\S]*?\}\)/u);
  assert.ok(launchCall, 'launchDesktopAvatarHandoff call must stay visible to the guard');
  assert.match(launchCall[0], /agentId/u);
  assert.match(launchCall[0], /avatarInstanceId/u);
  assert.match(launchCall[0], /launchSource/u);
  // The D-LLM-072 hard cut: no package / descriptor / path / profile / token /
  // account / binding / carrier / config record copied into the payload.
  assert.doesNotMatch(launchCall[0], /package|descriptor|path|profile|token|account|binding|carrier|config/u);
});
