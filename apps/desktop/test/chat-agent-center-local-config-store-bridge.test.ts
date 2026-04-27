import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateAgentCenterAvatarPackageValidationResult,
  validateAgentCenterAvatarPackageImportResult,
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
    agent_id: 'agent_1',
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_package: {
        schema_version: 1,
        selected_package: null,
        last_validated_at: null,
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

  assert.equal(result.ok, true);
});

test('Agent Center local config bridge exposes stable query key shape', () => {
  assert.deepEqual(agentCenterLocalConfigQueryKey('account_1', 'agent_1'), [
    'agent-center-local-config',
    'account_1',
    'agent_1',
  ]);
});

test('Agent Center avatar package validation parser accepts sidecar payload shape', () => {
  const result = validateAgentCenterAvatarPackageValidationResult({
    schema_version: 1,
    package_id: 'live2d_ab12cd34ef56',
    checked_at: '2026-04-27T00:00:00Z',
    status: 'valid',
    errors: [],
    warnings: [],
  });

  assert.equal(result.ok, true);
});

test('Agent Center avatar package validation parser rejects unknown payload fields', () => {
  const result = validateAgentCenterAvatarPackageValidationResult({
    schema_version: 1,
    package_id: 'live2d_ab12cd34ef56',
    checked_at: '2026-04-27T00:00:00Z',
    status: 'valid',
    errors: [],
    warnings: [],
    runtime_profile: 'forbidden',
  });

  assert.equal(result.ok, false);
});

test('Agent Center avatar package import parser accepts Rust payload shape', () => {
  const result = validateAgentCenterAvatarPackageImportResult({
    package_id: 'live2d_ab12cd34ef56',
    kind: 'live2d',
    selected: true,
    validation: {
      schema_version: 1,
      package_id: 'live2d_ab12cd34ef56',
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
