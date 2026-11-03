import assert from 'node:assert/strict';
import test from 'node:test';
import { authOptions, cloudProviders, modelsFor, newCloudExample, ownerOptions } from '../src/landing/content/demo-cloud-data.js';

test('the provider picker includes services outside the sample connections and respects their credential modes', () => {
  const sample = newCloudExample();
  assert.ok(cloudProviders.length > sample.connections.length);
  assert.ok(cloudProviders.some(p => p.provider === 'azure' && p.requiresExplicitEndpoint));
  assert.ok(!cloudProviders.some(p => p.provider === 'local'));
  assert.deepEqual(authOptions('openai_chatgpt_plan').map(option => option.authMode), ['oauth_managed']);
  assert.ok(authOptions('anthropic').some(option => option.authMode === 'api_key'));
});

test('a sample configuration refers to a bundled model and an eligible consumer without requiring a connection check', () => {
  const sample = newCloudExample();
  const use = sample.uses[0]!;
  const connection = sample.connections.find(c => c.id === use.connectionId)!;
  assert.ok(modelsFor(connection.provider).some(model => model.id === use.model && model.capabilities.includes(use.capability)));
  assert.ok(ownerOptions(use.capability, (_zh, en) => en).some(owner => owner.id === use.owner));
  const unchecked = sample.connections.find(c => c.status === 'unchecked')!;
  assert.ok(modelsFor(unchecked.provider).length > 0);
  assert.ok(!ownerOptions('audio.transcribe', (_zh, en) => en).some(owner => owner.id === 'nimi.desktop'));
});
