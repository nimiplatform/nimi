import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_CENTER_LOCAL_CONFIG_KIND,
  createDefaultAgentCenterLocalConfig,
  validateAgentCenterLocalConfig,
} from '../src/shell/renderer/features/chat/chat-agent-center-local-config';

function createConfig() {
  return createDefaultAgentCenterLocalConfig();
}

test('Agent Center local config validates the admitted module platform shape', () => {
  const config = createConfig();

  config.modules.appearance.background_asset_id = 'bg_ab12cd34ef56';
  config.modules.avatar_asset.local_avatar_asset_ref = 'live2d_ab12cd34ef56';
  config.modules.avatar_asset.backend_capability_profile_ref = 'avatar_profile_live2d_ab12cd34ef56';

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.config_kind, AGENT_CENTER_LOCAL_CONFIG_KIND);
    assert.equal(result.config.modules.avatar_asset.local_avatar_asset_ref, 'live2d_ab12cd34ef56');
  }
});

test('Agent Center local config rejects persisted identity fields', () => {
  const config = {
    ...createConfig(),
    account_id: 'account_123',
    owner_user_id: 'owner_123',
    realm_agent_id: 'agent_456',
    local_agent_ref: 'local-agent:owner_123:agent_456',
  };

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('config.account_id: unknown field')));
    assert.ok(result.errors.some((error) => error.includes('config.owner_user_id: unknown field')));
    assert.ok(result.errors.some((error) => error.includes('config.realm_agent_id: unknown field')));
    assert.ok(result.errors.some((error) => error.includes('config.local_agent_ref: unknown field')));
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
