import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiError } from '../../types';
import {
  createNimiAppAIConfigOwner,
  type NimiAppAIConfigClient,
} from './capability-configuration';
import {
  createNimiAppAIProfileClient,
  createNimiCloudAIConfigCapabilityIntent,
  parseNimiPortableAIProfile,
  projectNimiPortableLoadoutIntent,
  runtimeAIConfigStructToJson,
  serializeNimiPortableAIProfile,
} from './config-profile';

const CLOUD_PROFILE = {
  profileId: 'profile.cloud.text',
  title: 'Cloud text intent',
  capabilities: {
    'text.generate': {
      route: 'cloud',
      requiredFeatures: [],
      implementation: {
        implementationId: 'cloud.text.example',
        driverId: 'driver.example',
        driverDialect: 'example/text/v1',
        supportedFeatures: [],
      },
      providerModelTarget: {
        provider: 'example',
        providerModelId: 'model-1',
        remoteModelCatalogId: 'remote-model-catalog-model-1',
      },
    },
  },
} as const;

test('Cloud AIConfig constructor contains only implementation and provider-model target', () => {
  const intent = createNimiCloudAIConfigCapabilityIntent({
    capabilityContract: 'text.generate',
    requiredFeatures: ['input.image'],
    defaults: { temperature: 0.2 },
    implementation: {
      implementationId: 'openai',
      driverId: 'nimillm',
      driverDialect: 'openai',
    },
    providerModelTarget: {
      provider: 'openai',
      providerModelId: 'gpt-test',
      remoteModelCatalogId: 'remote-model-catalog-gpt-test',
    },
  });

  assert.equal(intent.route.oneofKind, 'cloud');
  if (intent.route.oneofKind !== 'cloud') assert.fail('expected Cloud intent');
  assert.deepEqual(intent.route.cloud.implementation, {
    implementationId: 'openai',
    driverId: 'nimillm',
    driverDialect: 'openai',
  });
  assert.deepEqual(runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget), {
    provider: 'openai',
    providerModelId: 'gpt-test',
    remoteModelCatalogId: 'remote-model-catalog-gpt-test',
  });
});

test('Cloud AIConfig constructor rejects alias or incomplete durable target identity', () => {
  const implementation = {
    implementationId: 'openai',
    driverId: 'nimillm',
    driverDialect: 'openai',
  };
  assert.throws(() => createNimiCloudAIConfigCapabilityIntent({
    capabilityContract: 'text.generate',
    implementation,
    providerModelTarget: { provider: 'openai', model: 'gpt-test', remoteModelCatalogId: 'catalog-1' },
  }), /model is not supported/u);
  assert.throws(() => createNimiCloudAIConfigCapabilityIntent({
    capabilityContract: 'text.generate',
    implementation,
    providerModelTarget: { provider: 'openai', providerModelId: 'gpt-test' },
  }), /remoteModelCatalogId is required/u);
});

test('portable Cloud AIProfile uses the same exact provider-model target contract', () => {
  const capability = CLOUD_PROFILE.capabilities['text.generate'];
  assert.throws(() => parseNimiPortableAIProfile({
    ...CLOUD_PROFILE,
    capabilities: {
      'text.generate': {
        ...capability,
        providerModelTarget: {
          provider: 'example',
          model: 'model-1',
          remoteModelCatalogId: 'remote-model-catalog-model-1',
        },
      },
    },
  }), /model is not supported/u);
  assert.throws(() => parseNimiPortableAIProfile({
    ...CLOUD_PROFILE,
    capabilities: {
      'text.generate': {
        ...capability,
        providerModelTarget: {
          provider: 'example',
          providerModelId: 'model-1',
        },
      },
    },
  }), /remoteModelCatalogId is required/u);
  assert.throws(() => parseNimiPortableAIProfile({
    ...CLOUD_PROFILE,
    capabilities: {
      'text.generate': {
        ...capability,
        providerModelTarget: {
          ...capability.providerModelTarget,
          provider: '\u0085example',
        },
      },
    },
  }), /provider is required/u);
});

test('portable AIProfile rejects machine-private authority', () => {
  assert.throws(
    () => parseNimiPortableAIProfile({
      profileId: 'profile.path-alias',
      title: 'Path alias',
      capabilities: {
        'text.generate': {
          route: 'local',
          implementation: {
            implementationId: 'local.text',
            driverId: 'driver.local',
            driverDialect: 'local/v1',
            supportedFeatures: [],
          },
          driverPortableConfig: { modelPath: 'models/private.gguf' },
        },
      },
    }),
    /modelPath/u,
  );
});

test('portable AIProfile rejects unsafe integers in arbitrary portable metadata', () => {
  assert.throws(() => parseNimiPortableAIProfile({
    profileId: 'profile.unsafe-integer',
    title: 'Unsafe integer',
    capabilities: { 'text.generate': { route: 'local' } },
    displayMetadata: { sequence: 9_007_199_254_740_992 },
  }), /safe integer/u);
});

test('App AIProfile Preview is non-committing and direct Apply writes connector-free owner intent', async () => {
  const owner = createNimiAppAIConfigOwner('app.profile.test');
  let current: Awaited<ReturnType<NimiAppAIConfigClient['get']>> | null = null;
  let writes = 0;
  const client: NimiAppAIConfigClient = {
    appId: 'app.profile.test',
    owner,
    async get() {
      if (!current) {
        throw createNimiError({
          message: 'missing',
          reasonCode: 'AI_CONFIG_NOT_FOUND',
          source: 'runtime',
        });
      }
      return current;
    },
    async overwrite(capabilities) {
      writes += 1;
      current = { owner, capabilities: [...capabilities] };
      return current;
    },
  };

  const profiles = createNimiAppAIProfileClient(client);
  const preview = await profiles.preview(CLOUD_PROFILE);
  assert.equal(writes, 0);
  assert.equal(preview.source.profileId, CLOUD_PROFILE.profileId);
  assert.equal(preview.after.capabilities[0]?.route.oneofKind, 'cloud');
  if (preview.after.capabilities[0]?.route.oneofKind !== 'cloud') {
    assert.fail('expected Cloud capability intent');
  }
  assert.deepEqual(
    runtimeAIConfigStructToJson(preview.after.capabilities[0].route.cloud.providerModelTarget),
    { provider: 'example', providerModelId: 'model-1', remoteModelCatalogId: 'remote-model-catalog-model-1' },
  );

  const applied = await profiles.apply(CLOUD_PROFILE);
  assert.equal(writes, 1);
  assert.equal(applied.owner?.owner.oneofKind, 'app');
  assert.equal(applied.capabilities[0]?.route.oneofKind, 'cloud');
  if (applied.capabilities[0]?.route.oneofKind !== 'cloud') {
    assert.fail('expected Cloud capability intent');
  }
});

test('Profile Apply keeps Local machine implementation intent outside AIConfig', async () => {
  const profile = {
    profileId: 'profile.local.separate',
    title: 'Local separate',
    capabilities: {
      'text.generate': {
        route: 'local',
        requiredFeatures: ['input.image'],
        implementation: {
          implementationId: 'local.text.llama-cpp',
          driverId: 'driver.llama-cpp',
          driverDialect: 'llama.cpp/v1',
          supportedFeatures: ['input.image', 'output.tool_calls'],
        },
        driverPortableConfig: { contextSize: 8192 },
        resourceOccurrences: [{ occurrenceId: 'weights-main', role: 'main' }],
        loadout: {
          recipeId: 'llama.cpp-text-generate',
          axes: [{
            slotId: 'model.gguf',
            contentId: `sha256:${'a'.repeat(64)}`,
            expectedHash: `sha256:${'a'.repeat(64)}`,
            source: {
              repo: 'example/Gemma-GGUF',
              revision: '0123456789abcdef',
              file: 'gemma-q8_0.gguf',
              sizeBytes: 1024,
            },
          }],
          options: { contextSize: 8192 },
        },
      },
    },
  } as const;
  const owner = createNimiAppAIConfigOwner('app.profile.local-separate');
  let committed: readonly unknown[] = [];
  const client: NimiAppAIConfigClient = {
    appId: 'app.profile.local-separate',
    owner,
    async get() { throw new Error('direct Apply must not read Preview state'); },
    async overwrite(capabilities) {
      committed = capabilities;
      return { owner, capabilities: [...capabilities] };
    },
  };

  await createNimiAppAIProfileClient(client).apply(profile);
  const encoded = JSON.stringify(committed);
  assert.doesNotMatch(encoded, /implementation|driverPortableConfig|resourceOccurrences/u);
  const localIntent = projectNimiPortableLoadoutIntent(profile, 'text.generate');
  assert.equal(localIntent?.resourceOccurrences.length, 1);
  assert.deepEqual(localIntent?.supportedFeatures, ['input.image', 'output.tool_calls']);
  assert.equal(localIntent?.loadout?.recipeId, 'llama.cpp-text-generate');
  assert.equal(localIntent?.loadout?.axes[0]?.slotId, 'model.gguf');
});

test('portable Loadout intent rejects unknown fields, invalid hashes, duplicate slots, and unsafe source files', () => {
  const base = {
    profileId: 'profile.loadout.invalid',
    title: 'Invalid loadout',
    capabilities: {
      'text.generate': {
        route: 'local',
        requiredFeatures: [],
        implementation: {
          implementationId: 'local.text.llama-cpp',
          driverId: 'driver.llama-cpp',
          driverDialect: 'llama.cpp/v1',
          supportedFeatures: [],
        },
        loadout: {
          recipeId: 'llama.cpp-text-generate',
          axes: [{
            slotId: 'model.gguf',
            contentId: `sha256:${'b'.repeat(64)}`,
            expectedHash: `sha256:${'b'.repeat(64)}`,
          }],
          options: {},
        },
      },
    },
  } as const;
  assert.throws(() => parseNimiPortableAIProfile({
    ...base,
    capabilities: { 'text.generate': { ...base.capabilities['text.generate'], loadout: { ...base.capabilities['text.generate'].loadout, extra: true } } },
  } as never), /unsupported field extra/u);
  assert.throws(() => parseNimiPortableAIProfile({
    ...base,
    capabilities: { 'text.generate': { ...base.capabilities['text.generate'], loadout: { ...base.capabilities['text.generate'].loadout, axes: [{ ...base.capabilities['text.generate'].loadout.axes[0], expectedHash: 'sha256:bad' }] } } },
  } as never), /expectedHash must be an exact sha256 identity/u);
  assert.throws(() => parseNimiPortableAIProfile({
    ...base,
    capabilities: { 'text.generate': { ...base.capabilities['text.generate'], loadout: { ...base.capabilities['text.generate'].loadout, axes: [base.capabilities['text.generate'].loadout.axes[0], base.capabilities['text.generate'].loadout.axes[0]] } } },
  } as never), /is duplicated/u);
  assert.throws(() => parseNimiPortableAIProfile({
    ...base,
    capabilities: { 'text.generate': { ...base.capabilities['text.generate'], loadout: { ...base.capabilities['text.generate'].loadout, axes: [{ ...base.capabilities['text.generate'].loadout.axes[0], source: { repo: 'example/repo', revision: 'main', file: '../private.gguf' } }] } } },
  } as never), /file is required/u);
  assert.throws(() => parseNimiPortableAIProfile({
    ...base,
    capabilities: { 'text.generate': { ...base.capabilities['text.generate'], loadout: { ...base.capabilities['text.generate'].loadout, axes: [{ ...base.capabilities['text.generate'].loadout.axes[0], source: { repo: 'example/repo', revision: 'main', file: 'C:/private.gguf' } }] } } },
  } as never), /non-portable path|file is required/u);
});

test('portable AIProfile round trip preserves authored Local and Cloud intent', () => {
  const full = {
    profileId: 'profile.full',
    title: 'Full profile',
    provenance: { source: 'user-import', sourceUrl: 'https://profiles.example.invalid/source' },
    capabilities: {
      'text.generate': {
        route: 'local',
        requiredFeatures: ['input.image'],
        implementation: {
          implementationId: 'local.text.llama-cpp',
          driverId: 'driver.llama-cpp',
          driverDialect: 'llama.cpp/v1',
          supportedFeatures: ['input.image'],
        },
        driverPortableConfig: { contextSize: 16384 },
        resourceOccurrences: [
          { occurrenceId: 'weights-main', role: 'main' },
          { occurrenceId: 'vision-projector', role: 'companion' },
        ],
      },
      'audio.synthesize': {
        route: 'cloud',
        requiredFeatures: ['voice.reference'],
        implementation: {
          implementationId: 'cloud.audio.example',
          driverId: 'driver.example',
          driverDialect: 'example/audio/v1',
          supportedFeatures: ['voice.reference'],
        },
        providerModelTarget: {
          provider: 'example',
          providerModelId: 'voice-v1',
          remoteModelCatalogId: 'remote-model-catalog-voice-v1',
        },
      },
    },
  } as const;
  const parsed = parseNimiPortableAIProfile(serializeNimiPortableAIProfile(full));
  assert.deepEqual(parsed, full);
  assert.equal(
    projectNimiPortableLoadoutIntent(parsed, 'text.generate')?.resourceOccurrences.length,
    2,
  );
});

test('AIProfile required features must be supported by its implementation', () => {
  assert.throws(
    () => parseNimiPortableAIProfile({
      ...CLOUD_PROFILE,
      capabilities: {
        'text.generate': {
          ...CLOUD_PROFILE.capabilities['text.generate'],
          requiredFeatures: ['input.image'],
        },
      },
    }),
    /does not support required feature input\.image/u,
  );
});
