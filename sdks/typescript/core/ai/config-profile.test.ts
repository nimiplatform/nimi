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
  projectNimiPortableLocalCapabilityConfigurationIntent,
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
      providerModelTarget: { provider: 'example', providerModelId: 'model-1' },
    },
  },
} as const;

test('Cloud AIConfig constructor normalizes implementation, target, and nullable explicit grant selection', () => {
  const intent = createNimiCloudAIConfigCapabilityIntent({
    capabilityContract: 'text.generate',
    requiredFeatures: ['input.image'],
    defaults: { temperature: 0.2 },
    implementation: {
      implementationId: 'openai',
      driverId: 'nimillm',
      driverDialect: 'openai',
    },
    providerModelTarget: { provider: 'openai', providerModelId: 'gpt-test' },
    connectorGrantId: null,
  });

  assert.equal(intent.route.oneofKind, 'cloud');
  if (intent.route.oneofKind !== 'cloud') assert.fail('expected Cloud intent');
  assert.equal(intent.route.cloud.connectorGrantId, '');
  assert.deepEqual(intent.route.cloud.implementation, {
    implementationId: 'openai',
    driverId: 'nimillm',
    driverDialect: 'openai',
  });
  assert.deepEqual(runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget), {
    provider: 'openai',
    providerModelId: 'gpt-test',
  });
  assert.throws(() => createNimiCloudAIConfigCapabilityIntent({
    capabilityContract: 'text.generate',
    implementation: {
      implementationId: 'openai',
      driverId: 'nimillm',
      driverDialect: 'openai',
    },
    providerModelTarget: { provider: 'openai', providerModelId: 'gpt-test' },
    connectorGrantId: ' grant-1 ',
  }), /connectorGrantId must be exact/u);
});

test('portable AIProfile rejects account and machine-private authority', () => {
  assert.throws(
    () => parseNimiPortableAIProfile({
      ...CLOUD_PROFILE,
      capabilities: {
        'text.generate': {
          ...CLOUD_PROFILE.capabilities['text.generate'],
          connectorGrantId: 'grant-must-not-travel-in-profile',
        },
      },
    }),
    /connectorGrantId/u,
  );
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

test('App AIProfile Preview is non-committing and direct Apply writes grantless owner intent', async () => {
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
  assert.equal(preview.after.capabilities[0].route.cloud.connectorGrantId, '');
  assert.deepEqual(
    runtimeAIConfigStructToJson(preview.after.capabilities[0].route.cloud.providerModelTarget),
    { provider: 'example', providerModelId: 'model-1' },
  );

  preview.after.capabilities[0].route.cloud.connectorGrantId = 'grant-injected-after-preview';
  const applied = await profiles.apply(CLOUD_PROFILE);
  assert.equal(writes, 1);
  assert.equal(applied.owner?.owner.oneofKind, 'app');
  assert.equal(applied.capabilities[0]?.route.oneofKind, 'cloud');
  if (applied.capabilities[0]?.route.oneofKind !== 'cloud') {
    assert.fail('expected Cloud capability intent');
  }
  assert.equal(applied.capabilities[0].route.cloud.connectorGrantId, '');
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
  const localIntent = projectNimiPortableLocalCapabilityConfigurationIntent(profile, 'text.generate');
  assert.equal(localIntent?.resourceOccurrences.length, 1);
  assert.deepEqual(localIntent?.supportedFeatures, ['input.image', 'output.tool_calls']);
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
        providerModelTarget: { provider: 'example', providerModelId: 'voice-v1' },
      },
    },
  } as const;
  const parsed = parseNimiPortableAIProfile(serializeNimiPortableAIProfile(full));
  assert.deepEqual(parsed, full);
  assert.equal(
    projectNimiPortableLocalCapabilityConfigurationIntent(parsed, 'text.generate')?.resourceOccurrences.length,
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
