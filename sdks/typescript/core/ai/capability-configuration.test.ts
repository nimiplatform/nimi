import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiAppAIConfigClient,
  createNimiAppAIConfigOwner,
  createNimiLocalAppAIConfigRuntimeClient,
} from './capability-configuration';

test('formal Local App AIConfig derives owner without a caller selector', async () => {
	const requests: unknown[] = [];
	const owner = createNimiAppAIConfigOwner('app.formal');
	const client = createNimiLocalAppAIConfigRuntimeClient({
		appId: 'app.formal',
		runtime: {
			async getAppAIConfig(request) {
				requests.push(request);
				return { config: { owner, capabilities: [] }, revision: '0', effectiveSelections: [] };
			},
			async overwriteAppAIConfig(request) {
				requests.push(request);
				return { config: { ...request.config, owner }, revision: '1', committed: true, reasonCode: 0 };
			},
			async listAppAIConfigOptions(request) {
				requests.push(request);
				return { result: { oneofKind: 'presetVoices', presetVoices: { options: [] } }, truncated: false };
			},
		},
	});

	await client.get();
	await client.overwrite({ expectedRevision: '0', capabilities: [] });
	await client.listOptions({ kind: 'preset-voices' });

	assert.deepEqual(requests[0], {});
	assert.deepEqual(requests[1], {
		config: { capabilities: [] },
		expectedRevision: '0',
	});
	assert.deepEqual(requests[2], {
		query: { oneofKind: 'presetVoices', presetVoices: {} },
	});
});

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

test('App AIConfig client projects bounded preset voices through the existing options operation', async () => {
  const requests: unknown[] = [];
  const runtime = {
    async getAppAIConfig() {
      return { config: undefined, revision: '0', effectiveSelections: [] };
    },
    async overwriteAppAIConfig() {
      return { config: undefined, revision: '0', committed: false, reasonCode: 0 } as never;
    },
    async listAppAIConfigOptions(request: unknown) {
      requests.push(request);
      return {
        result: {
          oneofKind: 'presetVoices' as const,
          presetVoices: {
            options: [{
              voiceId: 'serena', name: 'Serena', supportedLangs: ['en', 'zh'],
              provider: 'must-not-project', modelId: 'must-not-project',
            } as never],
          },
        },
        truncated: false,
      };
    },
  };
  const client = createNimiAppAIConfigClient({ appId: 'app.voice', runtime });

  const result = await client.listOptions({ kind: 'preset-voices' });

  assert.deepEqual(result, {
    kind: 'preset-voices',
    options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['en', 'zh'] }],
    truncated: false,
  });
  assert.equal(Object.isFrozen(result.options[0]), true);
  assert.deepEqual(requests, [{
    query: { oneofKind: 'presetVoices', presetVoices: {} },
    owner: createNimiAppAIConfigOwner('app.voice'),
  }]);

  const oversized = createNimiAppAIConfigClient({
    appId: 'app.voice',
    runtime: {
      ...runtime,
      async listAppAIConfigOptions() {
        return {
          result: {
            oneofKind: 'presetVoices' as const,
            presetVoices: {
              options: Array.from({ length: 101 }, (_, index) => ({
                voiceId: `voice-${index}`, name: `Voice ${index}`, supportedLangs: [],
              })),
            },
          },
          truncated: true,
        };
      },
    },
  });
  await assert.rejects(() => oversized.listOptions({ kind: 'preset-voices' }), /exceed the row bound/u);
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
