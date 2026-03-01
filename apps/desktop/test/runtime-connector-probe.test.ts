import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sdkConnectorToApiConnector,
  providerToVendor,
  vendorToProvider,
} from '../src/shell/renderer/features/runtime-config/domain/provider-connectors/connector-sdk-service';

test('sdkConnectorToApiConnector maps SDK connector shape to ApiConnector', () => {
  const sdkConnector = {
    connectorId: 'conn-123',
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    label: 'My OpenRouter',
    hasCredential: true,
    ownerType: 0,
    kind: 2,
    status: 1,
  };

  const result = sdkConnectorToApiConnector(sdkConnector);

  assert.equal(result.id, 'conn-123');
  assert.equal(result.label, 'My OpenRouter');
  assert.equal(result.vendor, 'openrouter');
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.endpoint, 'https://openrouter.ai/api/v1');
  assert.equal(result.hasCredential, true);
  assert.equal(result.isSystemOwned, false);
  assert.equal(result.status, 'idle');
  assert.ok(result.models.length > 0, 'should have catalog models');
});

test('sdkConnectorToApiConnector marks system-owned connectors', () => {
  const sdkConnector = {
    connectorId: 'conn-sys-1',
    provider: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    label: 'Gemini System',
    hasCredential: true,
    ownerType: 1,
    kind: 2,
    status: 1,
  };

  const result = sdkConnectorToApiConnector(sdkConnector);
  assert.equal(result.isSystemOwned, true);
  assert.equal(result.vendor, 'gemini');
});

test('sdkConnectorToApiConnector uses provided models over catalog defaults', () => {
  const sdkConnector = {
    connectorId: 'conn-456',
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1',
    label: 'DeepSeek',
    hasCredential: false,
    ownerType: 0,
    kind: 2,
    status: 0,
  };

  const customModels = ['deepseek-chat', 'deepseek-coder'];
  const result = sdkConnectorToApiConnector(sdkConnector, customModels);

  assert.deepEqual(result.models, ['deepseek-chat', 'deepseek-coder']);
});

test('sdkConnectorToApiConnector falls back to catalog models for empty model list', () => {
  const sdkConnector = {
    connectorId: 'conn-789',
    provider: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    label: 'Gemini',
    hasCredential: false,
    ownerType: 0,
    kind: 2,
    status: 0,
  };

  const result = sdkConnectorToApiConnector(sdkConnector, []);
  assert.ok(result.models.length > 0, 'should fall back to catalog models');
});

test('sdkConnectorToApiConnector uses default endpoint from catalog when connector endpoint is empty', () => {
  const sdkConnector = {
    connectorId: 'conn-no-ep',
    provider: 'openrouter',
    endpoint: '',
    label: 'No Endpoint',
    hasCredential: false,
    ownerType: 0,
    kind: 2,
    status: 0,
  };

  const result = sdkConnectorToApiConnector(sdkConnector);
  assert.ok(result.endpoint.length > 0, 'should have a fallback endpoint');
});

test('providerToVendor maps known providers correctly', () => {
  assert.equal(providerToVendor('deepseek'), 'deepseek');
  assert.equal(providerToVendor('dashscope'), 'dashscope');
  assert.equal(providerToVendor('volcengine'), 'volcengine');
  assert.equal(providerToVendor('volcengine_openspeech'), 'volcengine');
  assert.equal(providerToVendor('gemini'), 'gemini');
  assert.equal(providerToVendor('kimi'), 'kimi');
  assert.equal(providerToVendor('openai'), 'gpt');
  assert.equal(providerToVendor('anthropic'), 'claude');
  assert.equal(providerToVendor('openrouter'), 'openrouter');
  assert.equal(providerToVendor('unknown-provider'), 'custom');
  assert.equal(providerToVendor(''), 'custom');
});

test('vendorToProvider maps known vendors correctly', () => {
  assert.equal(vendorToProvider('dashscope'), 'dashscope');
  assert.equal(vendorToProvider('volcengine'), 'volcengine');
  assert.equal(vendorToProvider('gemini'), 'gemini');
  assert.equal(vendorToProvider('kimi'), 'kimi');
  assert.equal(vendorToProvider('deepseek'), 'deepseek');
  assert.equal(vendorToProvider('gpt'), 'openai');
  assert.equal(vendorToProvider('claude'), 'anthropic');
  assert.equal(vendorToProvider('openrouter'), 'openrouter');
  assert.equal(vendorToProvider('custom'), 'custom');
});

test('providerToVendor and vendorToProvider are bidirectional for all standard mappings', () => {
  const pairs: Array<[string, string]> = [
    ['deepseek', 'deepseek'],
    ['dashscope', 'dashscope'],
    ['volcengine', 'volcengine'],
    ['gemini', 'gemini'],
    ['kimi', 'kimi'],
    ['openai', 'gpt'],
    ['anthropic', 'claude'],
    ['openrouter', 'openrouter'],
  ];

  for (const [provider, vendor] of pairs) {
    assert.equal(providerToVendor(provider), vendor, `providerToVendor(${provider}) should be ${vendor}`);
    assert.equal(vendorToProvider(vendor as Parameters<typeof vendorToProvider>[0]), provider, `vendorToProvider(${vendor}) should be ${provider}`);
  }
});

test('providerToVendor is case-insensitive', () => {
  assert.equal(providerToVendor('DEEPSEEK'), 'deepseek');
  assert.equal(providerToVendor('Gemini'), 'gemini');
  assert.equal(providerToVendor('OpenAI'), 'gpt');
});
