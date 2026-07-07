import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultAgentCenterLocalConfig,
  validateAgentCenterAvatarAssetImportResult,
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

const CONFIG_IDENTITY = {
  account_id: 'account_1',
  owner_user_id: 'owner_1',
  runtime_source_ref: 'agent_1',
  local_agent_ref: 'local-agent:owner_1:agent_1',
} as const;

test('Agent Center local config bridge parser accepts Rust store payload shape', () => {
  const result = validateAgentCenterLocalConfig({
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    ...CONFIG_IDENTITY,
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
        live2d_calibration_ref: null,
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
      voice: {
        schema_version: 1,
        avatar_autoplay: false,
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
    ...CONFIG_IDENTITY,
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
        live2d_calibration_ref: null,
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
      voice: {
        schema_version: 1,
        avatar_autoplay: false,
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

test('Agent Center local config bridge rejects Runtime execution and transcript truth in store payloads', () => {
  const result = validateAgentCenterLocalConfig({
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    ...CONFIG_IDENTITY,
    execution_config: { revision: 'runtime-revision-1' },
    provider_route: { provider: 'runtime-provider', model: 'runtime-model' },
    runtime_snapshot: { ready: true },
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
        provider: 'runtime-provider',
      },
      avatar_asset: {
        schema_version: 1,
        conversation_anchor_scope: 'current_anchor',
        local_avatar_asset_ref: null,
        live2d_adapter_manifest_source: 'none',
        live2d_adapter_manifest_ref: null,
        live2d_calibration_ref: null,
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
        memory: { records: [] },
      },
      local_history: {
        schema_version: 1,
        last_cleared_at: null,
        transcript: [{ role: 'assistant', content: 'owned elsewhere' }],
      },
      voice: {
        schema_version: 1,
        avatar_autoplay: false,
        audio_synthesize: { route: 'runtime-audio' },
      },
      ui: {
        schema_version: 1,
        last_section: 'overview',
        model: 'runtime-model',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /config\.execution_config: unknown field/u);
  assert.match(result.errors.join('\n'), /config\.provider_route: unknown field/u);
  assert.match(result.errors.join('\n'), /config\.runtime_snapshot: unknown field/u);
  assert.match(result.errors.join('\n'), /modules\.appearance\.provider: unknown field/u);
  assert.match(result.errors.join('\n'), /modules\.avatar_asset\.memory: unknown field/u);
  assert.match(result.errors.join('\n'), /modules\.local_history\.transcript: unknown field/u);
  assert.match(result.errors.join('\n'), /modules\.voice\.audio_synthesize: unknown field/u);
  assert.match(result.errors.join('\n'), /modules\.ui\.model: unknown field/u);
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
    accountId: CONFIG_IDENTITY.account_id,
    ownerUserId: CONFIG_IDENTITY.owner_user_id,
    runtimeSourceRef: CONFIG_IDENTITY.runtime_source_ref,
    localAgentRef: CONFIG_IDENTITY.local_agent_ref,
  });

  assert.equal(config.account_id, CONFIG_IDENTITY.account_id);
  assert.equal(config.local_agent_ref, CONFIG_IDENTITY.local_agent_ref);
  assert.equal(config.modules.avatar_asset.backend_kind, 'live2d');
  assert.equal(config.modules.avatar_asset.live2d_adapter_manifest_source, 'none');
  assert.equal(config.modules.avatar_asset.live2d_adapter_manifest_ref, null);
  assert.equal(config.modules.avatar_asset.live2d_calibration_ref, null);
  assert.equal(config.modules.avatar_asset.avatar_instance_policy, 'reuse_active_instance');
  assert.equal(config.modules.avatar_asset.generated_motion_provider_policy, 'require_profile_support');
  assert.equal(config.modules.avatar_asset.launch_mode, 'manual');
  assert.equal(config.modules.avatar_asset.debug_profile, 'standard');
  assert.equal(config.modules.avatar_asset.provenance.source, 'runtime_projection');
  assert.equal(config.modules.local_history.last_cleared_at, null);
  assert.equal(config.modules.voice.avatar_autoplay, false);
  assert.equal(validateAgentCenterLocalConfig(config).ok, true);
});

test('Agent Center local config bridge rejects retired launch package config field', () => {
  const result = validateAgentCenterLocalConfig({
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    ...CONFIG_IDENTITY,
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
        live2d_calibration_ref: null,
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
      voice: {
        schema_version: 1,
        avatar_autoplay: false,
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

test('Agent Center Avatar asset validation parser accepts Rust payload shape', () => {
  const result = validateAgentCenterAvatarAssetValidationResult({
    schema_version: 1,
    local_asset_id: 'live2d_ab12cd34ef56',
    checked_at: '2026-04-27T00:00:00Z',
    status: 'valid',
    errors: [],
    warnings: [],
  });

  assert.equal(result.ok, true);
});

test('Agent Center Avatar asset import parser accepts Rust payload shape', () => {
  const result = validateAgentCenterAvatarAssetImportResult({
    local_asset_id: 'vrm_ab12cd34ef56',
    backend_kind: 'vrm',
    selected: true,
    materialization_ref: 'agent-center-avatar-asset:account_1:local_agent_1:vrm:vrm_ab12cd34ef56',
    backend_capability_profile_ref: 'avatar.backend_profile:vrm:vrm_ab12cd34ef56:import_validated',
    validation: {
      schema_version: 1,
      local_asset_id: 'vrm_ab12cd34ef56',
      checked_at: '2026-04-27T00:00:00Z',
      status: 'valid',
      errors: [],
      warnings: [],
    },
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

test('Agent Center resource removal parser accepts active quarantine payload shapes', () => {
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

  assert.equal(backgroundResult.ok, true);
  assert.equal(agentResult.ok, true);
  assert.equal(accountResult.ok, true);
});

test('Agent Center resource removal parser rejects decommissioned avatar asset quarantine payloads', () => {
  const result = validateAgentCenterLocalResourceRemoveResult({
    resource_kind: 'avatar_asset',
    resource_id: 'live2d_ab12cd34ef56',
    quarantined: true,
    operation_id: 'op_ab12cd34ef56',
    status: 'completed',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /invalid resource kind/u);
});
