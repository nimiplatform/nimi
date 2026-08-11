import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCodexOAuthConnectorOperationSnapshot,
  isCodexOAuthConnectorOperationCurrent,
} from '../src/shell/renderer/features/runtime-config/runtime-config-codex-oauth.js';
import { normalizeConnectorV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';

const connector = normalizeConnectorV11({
  id: 'connector-codex',
  label: 'Codex account',
  vendor: 'openai',
  provider: 'openai_codex',
  authMode: 'oauth_managed',
  providerAuthProfile: 'openai_codex',
  endpoint: 'https://chatgpt.com/backend-api/codex',
  scope: 'user',
  hasCredential: false,
  isDraft: true,
});

test('Codex OAuth completion requires the current generation and complete connector snapshot', () => {
  const operation = createCodexOAuthConnectorOperationSnapshot(7, connector);

  assert.equal(isCodexOAuthConnectorOperationCurrent(operation, 7, connector), true);
  assert.equal(isCodexOAuthConnectorOperationCurrent(operation, 8, connector), false);

  for (const changed of [
    { ...connector, endpoint: 'https://example.test/codex' },
    { ...connector, vendor: 'custom' as const },
    { ...connector, provider: 'custom' },
    { ...connector, authMode: 'api_key' as const, providerAuthProfile: undefined },
    { ...connector, label: 'New account label' },
  ]) {
    assert.equal(
      isCodexOAuthConnectorOperationCurrent(operation, 7, changed),
      false,
      `stale OAuth completion accepted changed connector ${JSON.stringify(changed)}`,
    );
  }
});
