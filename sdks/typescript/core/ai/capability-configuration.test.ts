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
        return { config: { owner: request.owner, capabilities: [] }, revision: '0', effectiveSelections: [] };
      },
      async overwriteAppAIConfig(request, options) {
        requests.push({ request, options });
        return { config: request.config, revision: '1', committed: true, reasonCode: 0 };
      },
      async listAppAIConfigOptions() { return { result: { oneofKind: undefined }, truncated: false }; },
    },
  });

  await client.get();
  const stored = await client.overwrite({ expectedRevision: '0', capabilities: [{
    capabilityContract: 'text.generate', requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  }] });

  assert.deepEqual(client.owner, createNimiAppAIConfigOwner('app.example'));
  assert.equal(stored.outcome, 'committed');
  if (stored.outcome !== 'committed') assert.fail('expected commit');
  assert.equal(stored.config.owner?.owner.oneofKind, 'app');
  assert.equal(stored.config.capabilities.length, 1);
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
          }, revision: '1', effectiveSelections: [],
        };
      },
      async overwriteAppAIConfig(request) {
        return { config: request.config, revision: '1', committed: true, reasonCode: 0 };
      },
      async listAppAIConfigOptions() { return { result: { oneofKind: undefined }, truncated: false }; },
    },
  });

  await assert.rejects(() => client.get(), /mismatched App AIConfig owner/u);
});

test('App AIConfig client rejects retired Local loadout references before transport', async () => {
  let overwriteCalls = 0;
  const client = createNimiAppAIConfigClient({
    appId: 'app.example',
    runtime: {
      async getAppAIConfig(request) {
        return { config: { owner: request.owner, capabilities: [] }, revision: '0', effectiveSelections: [] };
      },
      async overwriteAppAIConfig(request) {
        overwriteCalls += 1;
        return { config: request.config, revision: '1', committed: true, reasonCode: 0 };
      },
      async listAppAIConfigOptions() { return { result: { oneofKind: undefined }, truncated: false }; },
    },
  });

  await assert.rejects(
    () => client.overwrite({
      expectedRevision: '0',
      capabilities: [{
        capabilityContract: 'text.generate',
        requiredFeatures: [],
        route: { oneofKind: 'local', local: { loadoutRef: 'loadout.legacy' } },
      } as never],
    }),
    /must not contain a Loadout reference/u,
  );
  assert.equal(overwriteCalls, 0);
});
