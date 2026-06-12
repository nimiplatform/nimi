import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const INVOKE_PATH = resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/invoke.ts');

test('runtime bridge scrubs provider API key patterns before UI or log exposure', () => {
  const source = readFileSync(INVOKE_PATH, 'utf-8');

  assert.match(source, /REDACTED_PROVIDER_API_KEY/);
  assert.match(source, /x-nimi-provider-api-key/);
  assert.match(source, /provider_api_key/);
  assert.match(source, /providerApiKey/);
  assert.match(source, /error\.message = scrubProviderApiKey\(error\.message\)/);
  assert.match(source, /details\.rawMessage = scrubProviderApiKey\(details\.rawMessage\)/);
  assert.match(source, /const rawMessage = scrubProviderApiKey\(/);
});
