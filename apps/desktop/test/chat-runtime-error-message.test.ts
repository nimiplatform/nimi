import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('chat runtime error message delegates behavior to SDK runtime projection', () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/chat/chat-runtime-error-message.ts'),
    'utf8',
  );

  assert.match(source, /getRuntimeReasonCodeMessage/);
  assert.match(source, /toRuntimeUserFacingError/);
  assert.doesNotMatch(source, /CHAT_RUNTIME_REASON_MESSAGE_MAP/);
  assert.doesNotMatch(source, /shouldUseRawMessage/);
  assert.doesNotMatch(source, /AI_PROVIDER_TIMEOUT:\s*\{/);
});

test('runtime config error formatting does not retain a Desktop helper owner', () => {
  const helperPath = path.join(
    import.meta.dirname,
    '../src/shell/renderer/features/runtime-config/runtime-config-connector-error.ts',
  );
  const providerCommands = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-provider-commands.ts'),
    'utf8',
  );
  const connectorTestCommand = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-connector-test-command.ts'),
    'utf8',
  );
  const cloudPage = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-cloud.tsx'),
    'utf8',
  );

  assert.equal(fs.existsSync(helperPath), false);
  for (const source of [providerCommands, connectorTestCommand, cloudPage]) {
    assert.match(source, /from '@nimiplatform\/sdk\/runtime'/);
    assert.match(source, /formatRuntimeNimiErrorBanner|formatRuntimeNimiErrorDetail/);
    assert.doesNotMatch(source, /runtime-config-connector-error/);
  }
});
