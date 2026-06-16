import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { AvatarDebugProbeKind } from '../src/shell/renderer/features/chat/chat-agent-center-avatar-debug-workbench.js';
import type { AgentCenterAvatarAssetModule } from '../src/shell/renderer/features/chat/chat-agent-center-avatar-config-types.js';
import {
  LIVE2D_CALIBRATION_FORBIDDEN_CONFIG_FIELD_IDS,
  buildLive2dCalibrationWorkbenchModel,
} from '../src/shell/renderer/features/chat/chat-agent-center-live2d-calibration-workbench-model.js';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, '..', relativePath), 'utf8');
}

function buildConfig(overrides: Partial<AgentCenterAvatarAssetModule> = {}): AgentCenterAvatarAssetModule {
  return {
    schema_version: 1,
    conversation_anchor_scope: 'current_anchor',
    local_avatar_asset_ref: 'live2d_ab12cd34ef56',
    live2d_adapter_manifest_source: 'external_sidecar_manifest',
    live2d_adapter_manifest_ref: 'live2d_adapter_ab12cd34ef56',
    live2d_calibration_ref: 'live2d_calibration_ab12cd34ef56',
    avatar_instance_policy: 'reuse_active_instance',
    backend_kind: 'live2d',
    backend_capability_profile_ref: 'avatar_profile_live2d_ab12cd34ef56',
    generated_motion_provider_policy: 'require_profile_support',
    launch_mode: 'manual',
    debug_profile: 'standard',
    updated_at: '2026-05-01T00:00:00.000Z',
    provenance: {
      source: 'runtime_projection',
      evidence_ref: 'runtime-agent-avatar-config',
    },
    ...overrides,
  };
}

test('Live2D calibration workbench is visible only for Live2D backend config', () => {
  assert.equal(buildLive2dCalibrationWorkbenchModel({
    config: buildConfig(),
    avatarAssetValid: true,
    avatarAssetChecking: false,
  }).visible, true);

  assert.equal(buildLive2dCalibrationWorkbenchModel({
    config: buildConfig({
      backend_kind: 'vrm',
      local_avatar_asset_ref: 'vrm_ab12cd34ef56',
      live2d_adapter_manifest_source: 'none',
      live2d_adapter_manifest_ref: null,
      live2d_calibration_ref: null,
    }),
    avatarAssetValid: true,
    avatarAssetChecking: false,
  }).visible, false);
});

function sourceIdentifierPattern(identifier: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_])${identifier}([^A-Za-z0-9_]|$)`, 'u');
}

test('Live2D calibration workbench reviews asset evidence with effect-pending calibration ref projection', () => {
  const model = buildLive2dCalibrationWorkbenchModel({
    config: buildConfig(),
    avatarAssetValid: true,
    avatarAssetChecking: false,
  });

  assert.equal(model.launchEvidenceReady, true);
  assert.equal(model.adapterManifestRef, 'live2d_adapter_ab12cd34ef56');
  assert.equal(model.calibrationRef, 'live2d_calibration_ab12cd34ef56');
  assert.deepEqual(
    model.reviewItems.map((item) => [item.id, item.status, item.probeKind]),
    [
      ['preview_artifact', 'probe_required', AvatarDebugProbeKind.BACKEND_LOAD],
      ['model_framing', 'effect_projection_pending', AvatarDebugProbeKind.WINDOW_HIT_REGION],
      ['render_policy', 'effect_projection_pending', AvatarDebugProbeKind.BACKEND_LOAD],
      ['expression_inventory', 'probe_required', AvatarDebugProbeKind.EMOTION_EXPRESSION],
      ['adapter_manifest', 'ready', AvatarDebugProbeKind.CAPABILITY_PROFILE],
    ],
  );
  assert.deepEqual(model.debugProbeShortcutKinds, [
    AvatarDebugProbeKind.BACKEND_LOAD,
    AvatarDebugProbeKind.CAPABILITY_PROFILE,
    AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX,
    AvatarDebugProbeKind.GENERATED_MOTION,
    AvatarDebugProbeKind.EMOTION_EXPRESSION,
    AvatarDebugProbeKind.SPEECH_LIPSYNC,
    AvatarDebugProbeKind.WINDOW_HIT_REGION,
  ]);
  assert.deepEqual(model.persistence, {
    admitted: true,
    resolverRefProjectionAdmitted: true,
    resolverEffectProjectionAdmitted: false,
    calibrationRef: 'live2d_calibration_ab12cd34ef56',
    reasonCode: 'desktop_live2d_calibration_ref_projected_effect_pending',
    forbiddenFieldIds: LIVE2D_CALIBRATION_FORBIDDEN_CONFIG_FIELD_IDS,
  });
});

test('Live2D calibration workbench fails closed when local asset or profile evidence is missing', () => {
  const model = buildLive2dCalibrationWorkbenchModel({
    config: buildConfig({
      local_avatar_asset_ref: null,
      backend_capability_profile_ref: null,
      live2d_adapter_manifest_source: 'none',
      live2d_adapter_manifest_ref: null,
      live2d_calibration_ref: null,
    }),
    avatarAssetValid: false,
    avatarAssetChecking: false,
  });

  assert.equal(model.launchEvidenceReady, false);
  assert.deepEqual(
    model.reviewItems.map((item) => [item.id, item.status]),
    [
      ['preview_artifact', 'blocked'],
      ['model_framing', 'blocked'],
      ['render_policy', 'blocked'],
      ['expression_inventory', 'blocked'],
      ['adapter_manifest', 'missing'],
    ],
  );
});

test('Live2D calibration workbench is wired into Desktop settings but not config mutation or launch handoff', () => {
  const settingsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-avatar-settings-content.tsx');
  const mutationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-center-avatar-config-mutation.ts');
  const configTypesSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-center-avatar-config-types.ts');
  const launchSource = readWorkspaceFile('src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher.ts');

  assert.match(settingsSource, /AgentCenterLive2dCalibrationWorkbench/);
  assert.match(configTypesSource, /live2d_calibration_ref/u);
  assert.doesNotMatch(mutationSource, /live2d_calibration_ref/u);
  assert.match(launchSource, /live2dCalibrationRef/u);
  assert.match(launchSource, /live2d_calibration_ref/u);
  for (const forbiddenField of LIVE2D_CALIBRATION_FORBIDDEN_CONFIG_FIELD_IDS) {
    assert.doesNotMatch(mutationSource, sourceIdentifierPattern(forbiddenField));
    assert.doesNotMatch(configTypesSource, sourceIdentifierPattern(forbiddenField));
  }
  assert.doesNotMatch(mutationSource, /calibration/i);
  assert.doesNotMatch(configTypesSource, /live2d_calibration(?!_ref)/u);
});
