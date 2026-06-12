import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  AVATAR_DEBUG_WORKBENCH_PROBES,
  AvatarDebugProbeKind,
  AvatarDebugProbeStatus,
  avatarDebugProbeFailClosedReason,
  avatarDebugProbePresentationStatusLabel,
  avatarDebugProbeRemediation,
  avatarDebugProbeStatusLabel,
  buildDesktopCompanionParticipationProjectionRequest,
  buildAvatarDebugWorkbenchDiagnostics,
  buildAvatarDebugWorkbenchLaunchHealth,
  desktopCompanionParticipationRemediation,
  desktopCompanionParticipationStatusLabel,
  type AvatarDebugProbeResultEnvelope,
  type AvatarDebugReplayRef,
} from '../src/shell/renderer/features/chat/chat-agent-center-avatar-debug-workbench.js';
import type { AgentCenterAvatarAssetModule } from '../src/shell/renderer/features/chat/chat-agent-center-avatar-config-types.js';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, '..', relativePath), 'utf8');
}

function buildConfig(overrides: Partial<AgentCenterAvatarAssetModule> = {}): AgentCenterAvatarAssetModule {
  return {
    schema_version: 1,
    conversation_anchor_scope: 'current_anchor',
    local_avatar_asset_ref: 'vrm_ab12cd34ef56',
    live2d_adapter_manifest_source: 'none',
    live2d_adapter_manifest_ref: null,
    avatar_instance_policy: 'reuse_active_instance',
    backend_kind: 'vrm',
    backend_capability_profile_ref: 'avatar-profile:pkg-vrm-1',
    generated_motion_provider_policy: 'require_profile_support',
    launch_mode: 'debug_session',
    debug_profile: 'route_matrix',
    updated_at: '2026-05-01T00:00:00.000Z',
    provenance: {
      source: 'runtime_projection',
      evidence_ref: 'runtime-agent-avatar-config',
    },
    ...overrides,
  };
}

function buildProbeResult(overrides: Partial<AvatarDebugProbeResultEnvelope> = {}): AvatarDebugProbeResultEnvelope {
  return {
    probeId: 'probe-1',
    agentId: 'agent-1',
    conversationAnchorId: 'anchor-1',
    probeKind: AvatarDebugProbeKind.GENERATED_MOTION,
    status: AvatarDebugProbeStatus.PASSED,
    evidenceRefs: ['runtime_probe_id:probe-1', 'avatar_backend_evidence_ref:probe-1'],
    reasonCode: 'avatar_debug_probe_passed',
    resultId: 'result-1',
    ...overrides,
  };
}

function buildReplayRef(overrides: Partial<AvatarDebugReplayRef> = {}): AvatarDebugReplayRef {
  return {
    probeId: 'probe-1',
    replayRef: 'runtime-replay:probe-1',
    redactionState: 1,
    visibility: 1,
    ...overrides,
  } as AvatarDebugReplayRef;
}

test('avatar debug workbench launch health is fail-closed before typed Runtime probes can run', () => {
  assert.equal(buildAvatarDebugWorkbenchLaunchHealth({
    avatarAssetValid: true,
    avatarAssetChecking: false,
    conversationAnchorId: null,
    routeReady: true,
  }).status, 'needs_anchor');

  assert.equal(buildAvatarDebugWorkbenchLaunchHealth({
    avatarAssetValid: false,
    avatarAssetChecking: false,
    conversationAnchorId: 'anchor-1',
    routeReady: true,
  }).status, 'needs_package');

  assert.equal(buildAvatarDebugWorkbenchLaunchHealth({
    avatarAssetValid: true,
    avatarAssetChecking: false,
    conversationAnchorId: 'anchor-1',
    routeReady: false,
  }).status, 'runtime_unavailable');
});

test('avatar debug workbench diagnostics treats package/profile refs as opaque control state', () => {
  assert.deepEqual(buildAvatarDebugWorkbenchDiagnostics(buildConfig()), {
    backendKind: 'vrm',
    localAssetRefState: 'linked',
    profileRefState: 'linked',
    generatedMotionPolicy: 'require_profile_support',
    debugProfile: 'route_matrix',
  });

  assert.deepEqual(buildAvatarDebugWorkbenchDiagnostics(buildConfig({
    local_avatar_asset_ref: null,
    backend_capability_profile_ref: null,
  })), {
    backendKind: 'vrm',
    localAssetRefState: 'missing',
    profileRefState: 'pending',
    generatedMotionPolicy: 'require_profile_support',
    debugProfile: 'route_matrix',
  });
});

test('avatar debug workbench status and remediation stay aligned to Runtime probe status enums', () => {
  assert.equal(avatarDebugProbeStatusLabel(AvatarDebugProbeStatus.PASSED), 'Passed');
  assert.equal(avatarDebugProbeStatusLabel(AvatarDebugProbeStatus.UNSUPPORTED), 'Unsupported');
  assert.match(avatarDebugProbeRemediation({
    probeId: 'probe-1',
    agentId: 'agent-1',
    conversationAnchorId: 'anchor-1',
    probeKind: AvatarDebugProbeKind.GENERATED_MOTION,
    status: AvatarDebugProbeStatus.UNSUPPORTED,
    evidenceRefs: ['avatar.debug.session-evidence:probe-1'],
    reasonCode: 'avatar_debug_route_unsupported',
    resultId: 'result-1',
  }), /supports this route/);
});

test('avatar debug workbench exposes every authority probe category', () => {
  assert.deepEqual(
    AVATAR_DEBUG_WORKBENCH_PROBES.map((probe) => probe.kind),
    [
      AvatarDebugProbeKind.PACKAGE_VALIDATION,
      AvatarDebugProbeKind.LAUNCH_READINESS,
      AvatarDebugProbeKind.BACKEND_LOAD,
      AvatarDebugProbeKind.CAPABILITY_PROFILE,
      AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX,
      AvatarDebugProbeKind.GENERATED_MOTION,
      AvatarDebugProbeKind.EMOTION_EXPRESSION,
      AvatarDebugProbeKind.SPEECH_LIPSYNC,
      AvatarDebugProbeKind.WINDOW_HIT_REGION,
      'runtime_replay',
    ],
  );
});

test('avatar debug workbench fails closed when a passed probe lacks required evidence refs', () => {
  const result = buildProbeResult({
    evidenceRefs: [],
  });

  assert.equal(avatarDebugProbeFailClosedReason(result, buildReplayRef()), 'required_probe_evidence_missing');
  assert.equal(avatarDebugProbePresentationStatusLabel(result, buildReplayRef()), 'Failed');
  assert.match(avatarDebugProbeRemediation(result, buildReplayRef()), /Required probe evidence is missing/);
});

test('avatar debug workbench fails closed when passed evidence refs have wrong identities', () => {
  const result = buildProbeResult({
    evidenceRefs: ['wrong_probe_id:probe-1', 'wrong_backend_ref:probe-1'],
  });

  assert.equal(avatarDebugProbeFailClosedReason(result, buildReplayRef()), 'required_probe_evidence_missing');
  assert.equal(avatarDebugProbePresentationStatusLabel(result, buildReplayRef()), 'Failed');
});

test('avatar debug workbench fails closed when Runtime replay evidence is missing', () => {
  const result = buildProbeResult();

  assert.equal(avatarDebugProbeFailClosedReason(result, null), 'runtime_replay_missing');
  assert.equal(avatarDebugProbePresentationStatusLabel(result, null), 'Failed');
  assert.match(avatarDebugProbeRemediation(result, null), /runtime_replay_missing/);
});

test('avatar debug workbench fails closed when Runtime replay evidence belongs to another probe', () => {
  const result = buildProbeResult();
  const replayRef = buildReplayRef({ probeId: 'probe-other' });

  assert.equal(avatarDebugProbeFailClosedReason(result, replayRef), 'runtime_replay_probe_mismatch');
  assert.equal(avatarDebugProbePresentationStatusLabel(result, replayRef), 'Failed');
  assert.match(avatarDebugProbeRemediation(result, replayRef), /runtime_replay_probe_mismatch/);
});

test('avatar debug workbench presents passed only when required evidence and replay refs exist', () => {
  const result = buildProbeResult();
  const replayRef = buildReplayRef();

  assert.equal(avatarDebugProbeFailClosedReason(result, replayRef), null);
  assert.equal(avatarDebugProbePresentationStatusLabel(result, replayRef), 'Passed');
  assert.match(avatarDebugProbeRemediation(result, replayRef), /Evidence is linked/);
});

test('desktop avatar debug workbench requests typed companion participation projection', () => {
  assert.deepEqual(buildDesktopCompanionParticipationProjectionRequest({
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
  }), {
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
    surfaceKind: 'avatar_debug_workbench',
    triggerSource: 'user_explicit',
  });
});

test('desktop companion participation presentation fails visible on Runtime refusal states', () => {
  const projection = {
    projectionId: 'projection-1',
    agentId: 'local-agent:owner-1:agent-1',
    surfaceKind: 'avatar_debug_workbench',
    profileRef: 'runtime.agent.profile/local-agent:owner-1:agent-1',
    roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
    triggerSource: 'user_explicit',
    status: 'blocked',
    refusalReason: 'runtime_policy_blocked',
    auditRef: 'runtime.audit.companion_participation/projection-1',
    conversationAnchorId: 'anchor-1',
  } as const;

  assert.equal(desktopCompanionParticipationStatusLabel(projection), 'Blocked');
  assert.equal(desktopCompanionParticipationRemediation(projection), 'runtime_policy_blocked');
  assert.match(desktopCompanionParticipationRemediation(null), /Refresh participation projection/);
});

test('avatar debug workbench is a SDK Runtime module consumer, not protected Runtime authority', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-center-avatar-debug-workbench.tsx');
  const model = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-center-avatar-debug-workbench-model.ts');

  assert.match(source, /createNimiRuntimeAgentConsumeClient/);
  assert.match(source, /getDesktopRuntime\(\)\.agents/);
  assert.match(source, /getDesktopAppId\(\)/);
  assert.match(source, /avatarDebug\.snapshot/);
  assert.match(source, /avatarDebug\.requestProbe/);
  assert.match(source, /avatarDebug\.getReplay/);
  assert.match(source, /companionParticipation\.getProjection/);
  assert.match(model, /NimiRuntimeAgentCompanionParticipationProjection/);
  assert.doesNotMatch(model, /RuntimeCompanionParticipationProjection/);
  assert.doesNotMatch(source, /getPlatformClient/);
  assert.doesNotMatch(source, /runtime\.avatarDebug/);
  assert.doesNotMatch(source, /runtime\.companionParticipation/);
  assert.doesNotMatch(source, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(source, /buildRuntimeAgentRequestContext/);
  assert.doesNotMatch(source, /getAvatarDebugSnapshot\(/);
  assert.doesNotMatch(source, /requestAvatarDebugProbe\(/);
  assert.doesNotMatch(source, /getAvatarDebugReplay\(/);
  assert.doesNotMatch(source, /getCompanionParticipationProjection\(/);
});
