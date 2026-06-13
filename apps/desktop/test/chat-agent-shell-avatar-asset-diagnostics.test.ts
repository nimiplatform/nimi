import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAvatarAssetValidationPresentation,
  type AvatarAssetValidationResult,
} from '../src/shell/renderer/features/chat/chat-agent-shell-avatar-asset-diagnostics';
import type { AgentCenterAvatarAssetModule } from '../src/shell/renderer/features/chat/chat-agent-center-avatar-config-types';

function buildConfig(overrides: Partial<AgentCenterAvatarAssetModule> = {}): AgentCenterAvatarAssetModule {
  return {
    schema_version: 1,
    conversation_anchor_scope: 'current_anchor',
    local_avatar_asset_ref: 'live2d_ab12cd34ef56',
    live2d_adapter_manifest_source: 'none',
    live2d_adapter_manifest_ref: null,
    avatar_instance_policy: 'reuse_active_instance',
    backend_kind: 'live2d',
    backend_capability_profile_ref: 'avatar_profile_live2d_ab12cd34ef56',
    generated_motion_provider_policy: 'require_profile_support',
    launch_mode: 'manual',
    debug_profile: 'standard',
    updated_at: '2026-05-17T00:00:00.000Z',
    provenance: {
      source: 'import_validation',
      evidence_ref: 'agent-center-avatar-settings',
    },
    ...overrides,
  };
}

function buildValidation(overrides: Partial<AvatarAssetValidationResult> = {}): AvatarAssetValidationResult {
  return {
    status: 'valid',
    errors: [],
    warnings: [],
    ...overrides,
  };
}

test('Avatar asset diagnostics presents ready local asset evidence', () => {
  const presentation = buildAvatarAssetValidationPresentation({
    config: buildConfig(),
    validation: buildValidation(),
    configured: true,
    valid: true,
    checking: false,
  });

  assert.equal(presentation.status, 'ready');
  assert.equal(presentation.validationStatus, 'valid');
  assert.equal(presentation.selectedAssetId, 'live2d_ab12cd34ef56');
  assert.equal(presentation.message, null);
});

test('Avatar asset diagnostics surfaces first blocking validation issue', () => {
  const presentation = buildAvatarAssetValidationPresentation({
    config: buildConfig(),
    validation: buildValidation({
      status: 'missing_entry',
      errors: [{
        code: 'AVATAR_ASSET_ENTRY_MISSING',
        message: 'model3.json was not found',
        path: 'manifest.entry_file',
        severity: 'error',
      }],
    }),
    configured: true,
    valid: false,
    checking: false,
  });

  assert.equal(presentation.status, 'invalid');
  assert.equal(presentation.validationStatus, 'missing_entry');
  assert.match(presentation.message || '', /AVATAR_ASSET_ENTRY_MISSING @ manifest\.entry_file: model3\.json was not found/u);
  assert.equal(presentation.issueRows.length, 1);
});

test('Avatar asset diagnostics fails visible when backend capability evidence is missing', () => {
  const presentation = buildAvatarAssetValidationPresentation({
    config: buildConfig({
      backend_capability_profile_ref: null,
    }),
    validation: buildValidation({
      status: 'valid',
    }),
    configured: true,
    valid: false,
    checking: false,
  });

  assert.equal(presentation.status, 'invalid');
  assert.equal(presentation.validationStatus, 'valid');
  assert.equal(presentation.selectedAssetId, 'live2d_ab12cd34ef56');
  assert.match(presentation.message || '', /Backend capability profile evidence is missing/u);
});

test('Avatar asset diagnostics fails visible before a local asset is selected', () => {
  const presentation = buildAvatarAssetValidationPresentation({
    config: buildConfig({
      local_avatar_asset_ref: null,
      backend_capability_profile_ref: null,
    }),
    validation: null,
    configured: false,
    valid: false,
    checking: false,
  });

  assert.equal(presentation.status, 'missing');
  assert.equal(presentation.validationStatus, 'selection_missing');
  assert.match(presentation.message || '', /Avatar-owned package evidence/u);
});
