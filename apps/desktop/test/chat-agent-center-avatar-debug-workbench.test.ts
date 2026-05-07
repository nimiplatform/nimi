import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AvatarDebugProbeKind,
  AvatarDebugReplayRedactionState,
  AvatarDebugReplayVisibility,
  AvatarDebugProbeStatus,
  type AvatarDebugProbeResultEnvelope,
  type AvatarDebugReplayRef,
} from '@nimiplatform/sdk/runtime';
import {
  AVATAR_DEBUG_WORKBENCH_PROBES,
  avatarDebugProbeFailClosedReason,
  avatarDebugProbePresentationStatusLabel,
  avatarDebugProbeRemediation,
  avatarDebugProbeStatusLabel,
  buildAvatarDebugWorkbenchDiagnostics,
  buildAvatarDebugWorkbenchLaunchHealth,
} from '../src/shell/renderer/features/chat/chat-agent-center-avatar-debug-workbench.js';
import type { AgentCenterAvatarPackageModule } from '../src/shell/renderer/features/chat/chat-agent-center-avatar-config-types.js';

function buildConfig(overrides: Partial<AgentCenterAvatarPackageModule> = {}): AgentCenterAvatarPackageModule {
  return {
    schema_version: 1,
    selected_package: { kind: 'vrm', package_id: 'pkg-vrm-1' },
    conversation_anchor_scope: 'current_anchor',
    avatar_package_ref: 'avatar-package:pkg-vrm-1',
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
    last_validated_at: '2026-05-01T00:00:00.000Z',
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
    redactionState: AvatarDebugReplayRedactionState.REDACTED,
    visibility: AvatarDebugReplayVisibility.DESKTOP_DEBUG_WORKBENCH,
    ...overrides,
  };
}

test('avatar debug workbench launch health is fail-closed before typed Runtime probes can run', () => {
  assert.equal(buildAvatarDebugWorkbenchLaunchHealth({
    avatarPackageValid: true,
    avatarPackageChecking: false,
    selectedAvatarPackage: { kind: 'vrm', package_id: 'pkg-vrm-1' },
    conversationAnchorId: null,
    routeReady: true,
  }).status, 'needs_anchor');

  assert.equal(buildAvatarDebugWorkbenchLaunchHealth({
    avatarPackageValid: false,
    avatarPackageChecking: false,
    selectedAvatarPackage: null,
    conversationAnchorId: 'anchor-1',
    routeReady: true,
  }).status, 'needs_package');

  assert.equal(buildAvatarDebugWorkbenchLaunchHealth({
    avatarPackageValid: true,
    avatarPackageChecking: false,
    selectedAvatarPackage: { kind: 'vrm', package_id: 'pkg-vrm-1' },
    conversationAnchorId: 'anchor-1',
    routeReady: false,
  }).status, 'runtime_unavailable');
});

test('avatar debug workbench diagnostics treats package/profile refs as opaque control state', () => {
  assert.deepEqual(buildAvatarDebugWorkbenchDiagnostics(buildConfig(), { kind: 'vrm', package_id: 'pkg-vrm-1' }), {
    backendKind: 'vrm',
    packageRefState: 'linked',
    profileRefState: 'linked',
    generatedMotionPolicy: 'require_profile_support',
    debugProfile: 'route_matrix',
  });

  assert.deepEqual(buildAvatarDebugWorkbenchDiagnostics(buildConfig({
    avatar_package_ref: null,
    backend_capability_profile_ref: null,
  }), { kind: 'vrm', package_id: 'pkg-vrm-1' }), {
    backendKind: 'vrm',
    packageRefState: 'missing',
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

test('avatar debug workbench exposes the pinned emotion expression probe category', () => {
  assert.ok(AVATAR_DEBUG_WORKBENCH_PROBES.some((probe) => probe.kind === AvatarDebugProbeKind.EMOTION_EXPRESSION));
});

test('avatar debug workbench fails closed when a passed probe lacks required evidence refs', () => {
  const result = buildProbeResult({
    evidenceRefs: [],
  });

  assert.equal(avatarDebugProbeFailClosedReason(result, buildReplayRef()), 'required_probe_evidence_missing');
  assert.equal(avatarDebugProbePresentationStatusLabel(result, buildReplayRef()), 'Failed');
  assert.match(avatarDebugProbeRemediation(result, buildReplayRef()), /Required probe evidence is missing/);
});

test('avatar debug workbench fails closed when Runtime replay evidence is missing', () => {
  const result = buildProbeResult();

  assert.equal(avatarDebugProbeFailClosedReason(result, null), 'runtime_replay_missing');
  assert.equal(avatarDebugProbePresentationStatusLabel(result, null), 'Failed');
  assert.match(avatarDebugProbeRemediation(result, null), /runtime_replay_missing/);
});

test('avatar debug workbench presents passed only when required evidence and replay refs exist', () => {
  const result = buildProbeResult();
  const replayRef = buildReplayRef();

  assert.equal(avatarDebugProbeFailClosedReason(result, replayRef), null);
  assert.equal(avatarDebugProbePresentationStatusLabel(result, replayRef), 'Passed');
  assert.match(avatarDebugProbeRemediation(result, replayRef), /Evidence is linked/);
});
