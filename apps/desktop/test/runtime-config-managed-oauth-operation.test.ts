import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createManagedOAuthConnectorOperationSnapshot,
  isManagedOAuthConnectorOperationCurrent,
} from '../src/shell/renderer/features/runtime-config/runtime-config-managed-oauth.js';
import { normalizeConnectorV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';

const connector = normalizeConnectorV11({
  id: 'connector-chatgpt-plan',
  label: 'user@example.com',
  vendor: 'openai',
  provider: 'openai_chatgpt_plan',
  authMode: 'oauth_managed',
  providerAuthProfile: 'openai_chatgpt_plan',
  endpoint: 'https://api.openai.com/v1',
  scope: 'user',
  hasCredential: false,
  isDraft: true,
});

test('Managed OAuth completion requires the current generation and complete connector snapshot', () => {
  const operation = createManagedOAuthConnectorOperationSnapshot(7, connector);

  assert.equal(isManagedOAuthConnectorOperationCurrent(operation, 7, connector), true);
  assert.equal(isManagedOAuthConnectorOperationCurrent(operation, 8, connector), false);

  for (const changed of [
    { ...connector, endpoint: 'https://example.test/v1' },
    { ...connector, vendor: 'custom' as const },
    { ...connector, provider: 'custom' },
    { ...connector, authMode: 'api_key' as const, providerAuthProfile: undefined },
    { ...connector, label: 'New account label' },
  ]) {
    assert.equal(
      isManagedOAuthConnectorOperationCurrent(operation, 7, changed),
      false,
      `stale OAuth completion accepted changed connector ${JSON.stringify(changed)}`,
    );
  }
});
