import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultAgentCenterLocalConfig,
  validateAgentCenterAvatarAssetImportResult,
  validateAgentCenterAvatarAssetListResult,
  validateAgentCenterAvatarAssetValidationResult,
  validateAgentCenterLive2dAdapterManifestImportResult,
  validateAgentCenterBackgroundAssetResult,
  validateAgentCenterBackgroundImportResult,
  validateAgentCenterBackgroundValidationResult,
  validateAgentCenterLocalConfig,
  validateAgentCenterLocalResourceRemoveResult,
} from '../src/shell/renderer/features/chat/chat-agent-center-local-config';
import {
  agentCenterLocalConfigQueryKey,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-center-local-config-store';

test('Agent Center local config bridge parser accepts Rust store payload shape', () => {
  const result = validateAgentCenterLocalConfig({
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_asset: {
        schema_version: 1,
        conversation_anchor_scope: 'current_anchor',
        local_avatar_asset_ref: 'vrm_ab12cd34ef56',
        live2d_adapter_manifest_source: 'none',
        live2d_adapter_manifest_ref: null,
        avatar_instance_policy: 'reuse_active_instance',
        backend_kind: 'vrm',
        backend_capability_profile_ref: null,
        generated_motion_provider_policy: 'require_profile_support',
        launch_mode: 'manual',
        debug_profile: 'standard',
        updated_at: '2026-04-27T00:00:00Z',
        provenance: {
          source: 'runtime_projection',
          evidence_ref: 'vrm_ab12cd34ef56',
        },
      },
      local_history: {
        schema_version: 1,
        last_cleared_at: null,
      },
      ui: {
        schema_version: 1,
        last_section: 'overview',
      },
    },
  });

  assert.equal(result.ok, true);
});

test('Agent Center local config bridge rejects retired selected package truth', () => {
  const result = validateAgentCenterLocalConfig({
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_asset: {
        schema_version: 1,
        selected_package: {
          kind: 'vrm',
          local_asset_id: 'vrm_ab12cd34ef56',
        },
        conversation_anchor_scope: 'current_anchor',
        local_avatar_asset_ref: 'vrm_ab12cd34ef56',
        live2d_adapter_manifest_source: 'none',
        live2d_adapter_manifest_ref: null,
        avatar_instance_policy: 'reuse_active_instance',
        backend_kind: 'live2d',
        backend_capability_profile_ref: null,
        generated_motion_provider_policy: 'require_profile_support',
        launch_mode: 'manual',
        debug_profile: 'standard',
        updated_at: '2026-04-27T00:00:00Z',
        provenance: {
          source: 'import_validation',
          evidence_ref: 'vrm_ab12cd34ef56',
        },
      },
      local_history: {
        schema_version: 1,
        last_cleared_at: null,
      },
      ui: {
        schema_version: 1,
        last_section: 'overview',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /selected_package: unknown field/u);
});

test('Agent Center local config bridge exposes stable query key shape', () => {
  assert.deepEqual(agentCenterLocalConfigQueryKey('account_1', 'local-agent:owner_1:agent_1'), [
    'agent-center-local-config',
    'account_1',
    'local-agent:owner_1:agent_1',
  ]);
});

test('Agent Center local config default includes closed avatar configuration fields', () => {
  const config = createDefaultAgentCenterLocalConfig();

  assert.equal(config.modules.avatar_asset.backend_kind, 'live2d');
  assert.equal(config.modules.avatar_asset.live2d_adapter_manifest_source, 'none');
  assert.equal(config.modules.avatar_asset.live2d_adapter_manifest_ref, null);
  assert.equal(config.modules.avatar_asset.avatar_instance_policy, 'reuse_active_instance');
  assert.equal(config.modules.avatar_asset.generated_motion_provider_policy, 'require_profile_support');
  assert.equal(config.modules.avatar_asset.launch_mode, 'manual');
  assert.equal(config.modules.avatar_asset.debug_profile, 'standard');
  assert.equal(config.modules.avatar_asset.provenance.source, 'runtime_projection');
  assert.equal(config.modules.local_history.last_cleared_at, null);
  assert.equal(validateAgentCenterLocalConfig(config).ok, true);
});

test('Agent Center local config bridge rejects retired launch package config field', () => {
  const result = validateAgentCenterLocalConfig({
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_asset: {
        schema_version: 1,
        conversation_anchor_scope: 'current_anchor',
        local_avatar_asset_ref: null,
        live2d_adapter_manifest_source: 'none',
        live2d_adapter_manifest_ref: null,
        avatar_instance_policy: 'reuse_active_instance',
        backend_kind: 'live2d',
        backend_capability_profile_ref: null,
        generated_motion_provider_policy: 'require_profile_support',
        launch_mode: 'manual',
        debug_profile: 'standard',
        updated_at: '2026-04-27T00:00:00Z',
        provenance: {
          source: 'runtime_projection',
          evidence_ref: 'agent-center-avatar-config-default',
        },
        last_launch_local_asset_id: null,
      },
      local_history: {
        schema_version: 1,
        last_cleared_at: null,
      },
      ui: {
        schema_version: 1,
        last_section: 'overview',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /last_launch_local_asset_id: unknown field/u);
});

test('Agent Center Live2D adapter manifest import parser accepts Rust payload shape', () => {
  const result = validateAgentCenterLive2dAdapterManifestImportResult({
    manifest_ref: 'live2d_adapter_ab12cd34ef56',
    local_asset_id: 'live2d_ab12cd34ef56',
    selected: true,
    sha256: 'a'.repeat(64),
    bytes: 128,
    imported_at: '2026-05-01T00:00:00Z',
  });

  assert.equal(result.ok, true);
});

test('Agent Center avatar asset import parser accepts Rust payload shape', () => {
  const live2dResult = validateAgentCenterAvatarAssetImportResult({
    local_asset_id: 'live2d_ab12cd34ef56',
    backend_kind: 'live2d',
    backend_capability_profile_ref: null,
    selected: true,
    manifest_sha256: 'b'.repeat(64),
    asset_bytes: 512,
    file_count: 3,
    imported_at: '2026-05-01T00:00:00Z',
  });
  const vrmResult = validateAgentCenterAvatarAssetImportResult({
    local_asset_id: 'vrm_cd12ef34ab56',
    backend_kind: 'vrm',
    backend_capability_profile_ref: null,
    selected: true,
    manifest_sha256: 'c'.repeat(64),
    asset_bytes: 4096,
    file_count: 1,
    imported_at: '2026-05-01T00:00:00Z',
  });

  assert.equal(live2dResult.ok, true);
  assert.equal(vrmResult.ok, true);
});

test('Agent Center avatar asset validation parser accepts Rust payload shape', () => {
  const result = validateAgentCenterAvatarAssetValidationResult({
    schema_version: 1,
    local_asset_id: 'live2d_ab12cd34ef56',
    backend_kind: 'live2d',
    backend_capability_profile_ref: null,
    checked_at: '2026-05-01T00:00:00Z',
    status: 'valid',
    errors: [],
    warnings: [],
  });

  assert.equal(result.ok, true);
});

test('Agent Center avatar asset list parser accepts Rust payload shape', () => {
  const result = validateAgentCenterAvatarAssetListResult({
    selected_local_asset_id: 'live2d_ab12cd34ef56',
    assets: [
      {
        local_asset_id: 'live2d_ab12cd34ef56',
        backend_kind: 'live2d',
        display_name: 'Ren Live2D',
        source_label: 'ren_pro_zh',
        backend_capability_profile_ref: null,
        asset_bytes: 512,
        file_count: 3,
        imported_at: '2026-05-01T00:00:00Z',
        selected: true,
        validation: {
          schema_version: 1,
          local_asset_id: 'live2d_ab12cd34ef56',
          backend_kind: 'live2d',
          backend_capability_profile_ref: null,
          checked_at: '2026-05-01T00:00:00Z',
          status: 'valid',
          errors: [],
          warnings: [],
        },
      },
    ],
  });

  assert.equal(result.ok, true);
});

test('Agent Center avatar asset list parser rejects selected flag drift', () => {
  const result = validateAgentCenterAvatarAssetListResult({
    selected_local_asset_id: 'vrm_ab12cd34ef56',
    assets: [
      {
        local_asset_id: 'vrm_ab12cd34ef56',
        backend_kind: 'vrm',
        display_name: 'Ren VRM',
        source_label: 'ren.vrm',
        backend_capability_profile_ref: null,
        asset_bytes: 4096,
        file_count: 1,
        imported_at: '2026-05-01T00:00:00Z',
        selected: false,
        validation: {
          schema_version: 1,
          local_asset_id: 'vrm_ab12cd34ef56',
          backend_kind: 'vrm',
          backend_capability_profile_ref: null,
          checked_at: '2026-05-01T00:00:00Z',
          status: 'valid',
          errors: [],
          warnings: [],
        },
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /matching asset must be marked selected/u);
});

test('Agent Center background validation parser accepts sidecar payload shape', () => {
  const result = validateAgentCenterBackgroundValidationResult({
    schema_version: 1,
    background_asset_id: 'bg_ab12cd34ef56',
    checked_at: '2026-04-27T00:00:00Z',
    status: 'valid',
    errors: [],
    warnings: [],
  });

  assert.equal(result.ok, true);
});

test('Agent Center background import parser accepts Rust payload shape', () => {
  const result = validateAgentCenterBackgroundImportResult({
    background_asset_id: 'bg_ab12cd34ef56',
    selected: true,
    validation: {
      schema_version: 1,
      background_asset_id: 'bg_ab12cd34ef56',
      checked_at: '2026-04-27T00:00:00Z',
      status: 'valid',
      errors: [],
      warnings: [],
    },
  });

  assert.equal(result.ok, true);
});

test('Agent Center background asset parser accepts Rust payload shape', () => {
  const result = validateAgentCenterBackgroundAssetResult({
    background_asset_id: 'bg_ab12cd34ef56',
    file_url: 'file:///tmp/background.png',
    validation: {
      schema_version: 1,
      background_asset_id: 'bg_ab12cd34ef56',
      checked_at: '2026-04-27T00:00:00Z',
      status: 'valid',
      errors: [],
      warnings: [],
    },
  });

  assert.equal(result.ok, true);
});

test('Agent Center resource removal parser accepts quarantine payload shape', () => {
  const avatarResult = validateAgentCenterLocalResourceRemoveResult({
    resource_kind: 'avatar_asset',
    resource_id: 'live2d_ab12cd34ef56',
    quarantined: true,
    operation_id: 'op_ab12cd34ef56',
    status: 'completed',
  });
  const backgroundResult = validateAgentCenterLocalResourceRemoveResult({
    resource_kind: 'background',
    resource_id: 'bg_ab12cd34ef56',
    quarantined: true,
    operation_id: 'op_cd12ef34ab56',
    status: 'completed',
  });
  const agentResult = validateAgentCenterLocalResourceRemoveResult({
    resource_kind: 'agent_local_resources',
    resource_id: '~agent_1_tffk',
    quarantined: true,
    operation_id: 'op_ef12ab34cd56',
    status: 'completed',
  });
  const accountResult = validateAgentCenterLocalResourceRemoveResult({
    resource_kind: 'account_local_resources',
    resource_id: 'account_1',
    quarantined: true,
    operation_id: 'op_12ab34cd56ef',
    status: 'completed',
  });

  assert.equal(avatarResult.ok, true);
  assert.equal(backgroundResult.ok, true);
  assert.equal(agentResult.ok, true);
  assert.equal(accountResult.ok, true);
});
