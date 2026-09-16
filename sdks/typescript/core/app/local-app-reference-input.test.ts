import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiLocalAppAIConfigClient } from './local-app-runtime-platform-ai-config.js';

test('protected AIConfig retains exact reference inputs and rejects malformed metadata', async () => {
  const referenceAudioInput = { supportsBytes: false, supportsUri: true, textMode: 'unsupported', mimeTypes: ['audio/wav'] };
  const target = { connectorRef: 'connector', label: 'Voice', capabilityContract: 'voice.create',
    implementation: { implementationId: 'cloud.voice', driverId: 'voice', driverDialect: 'media-v1' },
    providerModelTarget: { providerModelId: 'voice' }, supportedFeatures: ['input.audio'], state: 'ready', reasons: [], referenceAudioInput };
  let result: unknown = { kind: 'cloud-targets', options: [target], truncated: false };
  const client = createNimiLocalAppAIConfigClient({ get: async () => ({}), overwrite: async () => ({}), listOptions: async () => structuredClone(result) });
  const query = { kind: 'cloud-targets' as const, capabilityContract: 'voice.create', connectorRef: 'connector' };
  const projected = await client.listOptions(query);
  assert.equal(projected.kind, 'cloud-targets');
  if (projected.kind === 'cloud-targets') assert.deepEqual(projected.options[0]?.referenceAudioInput, referenceAudioInput);
  for (const malformed of [{ ...referenceAudioInput, textMode: 'guess' }, { ...referenceAudioInput, endpoint: 'private' }, { ...referenceAudioInput, supportsUri: false }, { ...referenceAudioInput, mimeTypes: Array(17).fill('audio/wav') }]) {
    result = { kind: 'cloud-targets', options: [{ ...target, referenceAudioInput: malformed }], truncated: false };
    await assert.rejects(client.listOptions(query));
  }
  const { referenceAudioInput: _input, ...unknownTarget } = target;
  result = { kind: 'cloud-targets', options: [unknownTarget], truncated: false };
  const unknown = await client.listOptions(query);
  if (unknown.kind === 'cloud-targets') assert.equal(unknown.options[0]?.referenceAudioInput, undefined);
});
