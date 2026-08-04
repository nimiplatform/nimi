import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiAppAIConfigClient,
  createNimiAppAIConfigOwner,
} from './capability-configuration';

test('App AIConfig client uses exact whole-object owner intent', async () => {
  const requests: unknown[] = [];
  const client = createNimiAppAIConfigClient({
    appId: 'app.example',
    runtime: {
      async getAppAIConfig(request) {
        requests.push(request);
        return { config: { owner: request.owner, capabilities: [] } };
      },
      async overwriteAppAIConfig(request, options) {
        requests.push({ request, options });
        return { config: request.config };
      },
    },
  });

  await client.get();
  const stored = await client.overwrite([{
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  }]);

  assert.deepEqual(client.owner, createNimiAppAIConfigOwner('app.example'));
  assert.equal(stored.owner?.owner.oneofKind, 'app');
  assert.equal(stored.capabilities.length, 1);
  assert.equal(requests.length, 2);
  const overwrite = requests[1] as {
    request: { config?: { capabilities: unknown[] } };
    options: { metadata?: Record<string, string> };
  };
  assert.equal(overwrite.request.config?.capabilities.length, 1);
  assert.ok(overwrite.options.metadata?.['x-nimi-idempotency-key']);
});

test('App AIConfig client rejects mismatched Runtime owner projection', async () => {
  const client = createNimiAppAIConfigClient({
    appId: 'app.example',
    runtime: {
      async getAppAIConfig() {
        return {
          config: {
            owner: createNimiAppAIConfigOwner('app.other'),
            capabilities: [],
          },
        };
      },
      async overwriteAppAIConfig(request) {
        return { config: request.config };
      },
    },
  });

  await assert.rejects(() => client.get(), /mismatched App AIConfig owner/u);
});
