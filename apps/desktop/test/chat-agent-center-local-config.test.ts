import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_CENTER_LOCAL_CONFIG_KIND,
  createDefaultAgentCenterLocalConfig,
  validateAgentCenterLocalConfig,
} from '../src/shell/renderer/features/chat/chat-agent-center-local-config';

test('Agent Center local config validates the admitted module platform shape', () => {
  const config = createDefaultAgentCenterLocalConfig({
    accountId: 'account_123',
    agentId: 'agent_456',
  });

  config.modules.appearance.background_asset_id = 'bg_ab12cd34ef56';
  config.modules.avatar_package.selected_package = {
    kind: 'live2d',
    package_id: 'live2d_ab12cd34ef56',
  };
  config.modules.avatar_package.last_validated_at = '2026-04-27T00:00:00Z';

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.config_kind, AGENT_CENTER_LOCAL_CONFIG_KIND);
    assert.equal(result.config.modules.avatar_package.selected_package?.package_id, 'live2d_ab12cd34ef56');
  }
});

test('Agent Center local config accepts runtime-scoped agent identifiers', () => {
  const config = createDefaultAgentCenterLocalConfig({
    accountId: 'account_123',
    agentId: '~agent_1_tffk',
  });

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.agent_id, '~agent_1_tffk');
  }
});

test('Agent Center local config accepts opaque runtime agent identifiers', () => {
  const config = createDefaultAgentCenterLocalConfig({
    accountId: 'account_123',
    agentId: 'agent:abc.def+1',
  });

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.agent_id, 'agent:abc.def+1');
  }
});

test('Agent Center local config rejects unknown modules and arbitrary key growth', () => {
  const config = createDefaultAgentCenterLocalConfig({
    accountId: 'account_123',
    agentId: 'agent_456',
  }) as unknown as Record<string, unknown>;
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
  const config = createDefaultAgentCenterLocalConfig({
    accountId: 'account_123',
    agentId: 'agent_456',
  }) as unknown as Record<string, unknown>;
  config.personality = 'friendly';

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('config.personality: unknown field')));
  }
});

test('Agent Center avatar package module fails closed on kind/package mismatch', () => {
  const config = createDefaultAgentCenterLocalConfig({
    accountId: 'account_123',
    agentId: 'agent_456',
  });
  config.modules.avatar_package.selected_package = {
    kind: 'vrm',
    package_id: 'live2d_ab12cd34ef56',
  };

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('package id must match kind')));
  }
});

test('Agent Center local config rejects non-NFC identifiers', () => {
  const config = createDefaultAgentCenterLocalConfig({
    accountId: 'cafe\u0301',
    agentId: 'agent_456',
  });

  const result = validateAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('config.account_id: must be NFC normalized')));
  }
});
