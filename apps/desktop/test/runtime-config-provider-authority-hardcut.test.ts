import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const connectorActionsSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-connector-actions.ts'),
  'utf8',
);

const cloudPageSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-cloud.tsx'),
  'utf8',
);

test('runtime config connector endpoint edits do not infer provider authority from host patterns', () => {
  assert.doesNotMatch(connectorActionsSource, /inferVendorFromEndpoint|hostPatterns/);
  assert.doesNotMatch(cloudPageSource, /inferVendorFromEndpoint/);
  assert.doesNotMatch(cloudPageSource, /normalized\.includes\(host\)|api\.deepseek\.com|api\.anthropic\.com|openrouter\.ai/);
});

test('runtime config connector provider selection remains catalog and draft scoped', () => {
  assert.match(cloudPageSource, /sdkListProviderCatalog\(\)/);
  assert.match(cloudPageSource, /runtimeCatalog\.find\(\(entry\) => entry\.managedSupported && entry\.provider !== 'local'\)/);
  assert.match(cloudPageSource, /providerToVendor\(provider\)/);
  assert.match(cloudPageSource, /const canEditVendor = !isRuntimeSystem && isDraft;/);
  assert.match(cloudPageSource, /const onChangeConnectorEndpoint = useCallback\(\(endpoint: string\) => \{/);
  assert.match(cloudPageSource, /updateConnectorField\(prev, selectedConnectorId, \{ endpoint \}\)/);
  assert.doesNotMatch(cloudPageSource, /onChangeConnectorEndpoint[\s\S]*provider:\s*inferredProvider/);
  assert.doesNotMatch(cloudPageSource, /VENDOR_ORDER_V11|DEFAULT_OPENROUTER_ENDPOINT_V11/);
});
