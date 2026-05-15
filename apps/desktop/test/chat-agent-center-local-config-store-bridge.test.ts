import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultAgentCenterLocalConfig,
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
    account_id: 'account_1',
    owner_user_id: 'owner_1',
    realm_agent_id: 'agent_1',
    local_agent_ref: 'local-agent:owner_1:agent_1',
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_package: {
        schema_version: 1,
        conversation_anchor_scope: 'current_anchor',
        avatar_package_ref: 'runtime-avatar-ref:vrm_ab12cd34ef56',
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
          evidence_ref: 'runtime-avatar-ref:vrm_ab12cd34ef56',
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
    account_id: 'account_1',
    owner_user_id: 'owner_1',
    realm_agent_id: 'agent_1',
    local_agent_ref: 'local-agent:owner_1:agent_1',
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_package: {
        schema_version: 1,
        selected_package: {
          kind: 'vrm',
          package_id: 'vrm_ab12cd34ef56',
        },
        conversation_anchor_scope: 'current_anchor',
        avatar_package_ref: 'vrm_ab12cd34ef56',
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
  const config = createDefaultAgentCenterLocalConfig({
    accountId: 'account_1',
    ownerUserId: 'owner_1',
    realmAgentId: 'agent_1',
    localAgentRef: 'local-agent:owner_1:agent_1',
  });

  assert.equal(config.modules.avatar_package.backend_kind, 'live2d');
  assert.equal(config.modules.avatar_package.live2d_adapter_manifest_source, 'none');
  assert.equal(config.modules.avatar_package.live2d_adapter_manifest_ref, null);
  assert.equal(config.modules.avatar_package.avatar_instance_policy, 'reuse_active_instance');
  assert.equal(config.modules.avatar_package.generated_motion_provider_policy, 'require_profile_support');
  assert.equal(config.modules.avatar_package.launch_mode, 'manual');
  assert.equal(config.modules.avatar_package.debug_profile, 'standard');
  assert.equal(config.modules.avatar_package.provenance.source, 'runtime_projection');
  assert.equal(validateAgentCenterLocalConfig(config).ok, true);
});

test('Agent Center local config bridge rejects retired launch package config field', () => {
  const result = validateAgentCenterLocalConfig({
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    account_id: 'account_1',
    owner_user_id: 'owner_1',
    realm_agent_id: 'agent_1',
    local_agent_ref: 'local-agent:owner_1:agent_1',
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_package: {
        schema_version: 1,
        conversation_anchor_scope: 'current_anchor',
        avatar_package_ref: null,
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
        last_launch_package_id: null,
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
  assert.match(result.errors.join('\n'), /last_launch_package_id: unknown field/u);
});

test('Agent Center Live2D adapter manifest import parser accepts Rust payload shape', () => {
  const result = validateAgentCenterLive2dAdapterManifestImportResult({
    manifest_ref: 'live2d_adapter_ab12cd34ef56',
    package_id: 'live2d_ab12cd34ef56',
    selected: true,
    sha256: 'a'.repeat(64),
    bytes: 128,
    imported_at: '2026-05-01T00:00:00Z',
  });

  assert.equal(result.ok, true);
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
    resource_kind: 'avatar_package',
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
