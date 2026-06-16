import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_CENTER_LOCAL_CONFIG_KIND,
  createDefaultAgentCenterLocalConfig,
  validateAgentCenterLocalConfig,
} from '../src/shell/renderer/features/chat/chat-agent-center-local-config';

function createConfig() {
  return createDefaultAgentCenterLocalConfig({
    accountId: 'account_123',
    ownerUserId: 'owner_123',
    realmAgentId: 'agent_456',
    localAgentRef: 'local-agent:owner_123:agent_456',
  });
}

test('Agent Center local config validates the admitted module platform shape', () => {
  const config = createConfig();

  config.modules.appearance.background_asset_id = 'bg_ab12cd34ef56';
  config.modules.avatar_asset.local_avatar_asset_ref = 'live2d_ab12cd34ef56';
  config.modules.avatar_asset.live2d_calibration_ref = 'live2d_calibration_ab12cd34ef56';
  config.modules.avatar_asset.backend_capability_profile_ref = 'avatar_profile_live2d_ab12cd34ef56';

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.config_kind, AGENT_CENTER_LOCAL_CONFIG_KIND);
    assert.equal(result.config.modules.avatar_asset.local_avatar_asset_ref, 'live2d_ab12cd34ef56');
    assert.equal(result.config.modules.avatar_asset.live2d_calibration_ref, 'live2d_calibration_ab12cd34ef56');
  }
});

test('Agent Center local config admits scoped persisted identity fields', () => {
  const config = createConfig();

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.account_id, 'account_123');
    assert.equal(result.config.local_agent_ref, 'local-agent:owner_123:agent_456');
  }
});

test('Agent Center local config rejects identity drift from local agent ref', () => {
  const config = {
    ...createConfig(),
    local_agent_ref: 'local-agent:owner_123:agent_other',
  };

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('config.local_agent_ref: must equal')));
  }
});

test('Agent Center local config rejects unknown modules and arbitrary key growth', () => {
  const config = createConfig() as unknown as Record<string, unknown>;
  const modules = config.modules as Record<string, unknown>;
  modules.behavior = {
    schema_version: 1,
    proactive_enabled: true,
  };

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('config.modules.behavior: unknown field')));
  }
});

test('Agent Center local config rejects runtime-owned truth fields', () => {
  const config = createConfig() as unknown as Record<string, unknown>;
  config.personality = 'friendly';

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('config.personality: unknown field')));
  }
});

test('Agent Center avatar asset module rejects retired selected package truth', () => {
  const config = createConfig() as unknown as Record<string, unknown>;
  const modules = config.modules as Record<string, unknown>;
  const avatarAsset = modules.avatar_asset as Record<string, unknown>;
  avatarAsset.selected_package = {
    kind: 'vrm',
    local_asset_id: 'live2d_ab12cd34ef56',
  };

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('selected_package: unknown field')));
  }
});

test('Agent Center avatar asset module rejects forbidden path-bearing fields', () => {
  const config = createConfig() as unknown as Record<string, unknown>;
  const modules = config.modules as Record<string, unknown>;
  const avatarAsset = modules.avatar_asset as Record<string, unknown>;
  avatarAsset.package_path = '/tmp/avatar.vrm';
  avatarAsset.live2d_adapter_manifest_path = '/tmp/live2d-adapter.json';

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('package_path: unknown field')));
    assert.ok(result.errors.some((error) => error.includes('live2d_adapter_manifest_path: unknown field')));
  }
});

test('Agent Center avatar asset module rejects unadmitted Live2D calibration fields', () => {
  const config = createConfig() as unknown as Record<string, unknown>;
  const modules = config.modules as Record<string, unknown>;
  const avatarAsset = modules.avatar_asset as Record<string, unknown>;
  avatarAsset.model_digest = 'sha256:abcd';
  avatarAsset.preview_artifact_ref = 'avatar.carrier.preview-artifact:probe-1';
  avatarAsset.framing_calibration = { scale: 1.1 };
  avatarAsset.render_scale = 1.25;
  avatarAsset.target_fps = 60;
  avatarAsset.expression_inventory = ['happy'];
  avatarAsset.compatibility_tier = 'companion_complete';
  avatarAsset.avatar_compatibility_diagnostics = ['AVATAR_LIVE2D_COMPAT_OK'];

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    for (const field of [
      'model_digest',
      'preview_artifact_ref',
      'framing_calibration',
      'render_scale',
      'target_fps',
      'expression_inventory',
      'compatibility_tier',
      'avatar_compatibility_diagnostics',
    ]) {
      assert.ok(
        result.errors.some((error) => error.includes(`${field}: unknown field`)),
        `expected ${field} to be rejected`,
      );
    }
  }
});

test('Agent Center avatar asset module admits opaque Live2D calibration ref only for Live2D backend', () => {
  const config = createConfig();
  config.modules.avatar_asset.local_avatar_asset_ref = 'live2d_ab12cd34ef56';
  config.modules.avatar_asset.backend_kind = 'live2d';
  config.modules.avatar_asset.live2d_calibration_ref = 'live2d_calibration_ab12cd34ef56';

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.modules.avatar_asset.live2d_calibration_ref, 'live2d_calibration_ab12cd34ef56');
  }
});

test('Agent Center avatar asset module rejects malformed or backend-mismatched Live2D calibration ref', () => {
  const malformed = createConfig();
  malformed.modules.avatar_asset.live2d_calibration_ref = 'live2d_calibration_nothex';

  const malformedResult = validateAgentCenterLocalConfig(malformed);

  assert.equal(malformedResult.ok, false);
  if (!malformedResult.ok) {
    assert.ok(malformedResult.errors.some((error) => error.includes('live2d_calibration_ref: invalid Live2D calibration ref')));
  }

  const backendMismatch = createConfig();
  backendMismatch.modules.avatar_asset.local_avatar_asset_ref = 'vrm_ab12cd34ef56';
  backendMismatch.modules.avatar_asset.backend_kind = 'vrm';
  backendMismatch.modules.avatar_asset.live2d_calibration_ref = 'live2d_calibration_ab12cd34ef56';

  const backendMismatchResult = validateAgentCenterLocalConfig(backendMismatch);

  assert.equal(backendMismatchResult.ok, false);
  if (!backendMismatchResult.ok) {
    assert.ok(backendMismatchResult.errors.some((error) => error.includes('live2d_calibration_ref: requires live2d backend')));
  }
});

test('Agent Center avatar asset module rejects malformed opaque local asset refs', () => {
  const config = createConfig();
  config.modules.avatar_asset.local_avatar_asset_ref = 'live2d_nothex';
  config.modules.avatar_asset.backend_kind = 'live2d';

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('local_avatar_asset_ref: invalid local Avatar asset id')));
  }
});

test('Agent Center avatar asset module rejects backend drift from selected local asset', () => {
  const config = createConfig();
  config.modules.avatar_asset.local_avatar_asset_ref = 'live2d_ab12cd34ef56';
  config.modules.avatar_asset.backend_kind = 'vrm';

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('backend_kind: must match local Avatar asset id prefix')));
  }
});

test('Agent Center avatar asset module rejects future backend for selected local asset', () => {
  const config = createConfig();
  config.modules.avatar_asset.local_avatar_asset_ref = 'vrm_ab12cd34ef56';
  config.modules.avatar_asset.backend_kind = 'future';

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('future backend cannot be selected')));
  }
});
