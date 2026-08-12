import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  cleanupBehaviorModules,
  importBehaviorModule,
  root,
} from './helpers.mjs';

test.after(cleanupBehaviorModules);

const owner = { owner: { oneofKind: 'app', app: { appId: 'nimi.tester' } } };
const localIntent = (capabilityContract) => ({
  capabilityContract,
  requiredFeatures: [],
  route: { oneofKind: 'local', local: {} },
});
const config = (...capabilities) => ({ owner, capabilities });

test('tester treats AI_CONFIG_NOT_FOUND as one unconfigured App AIConfig projection', async () => {
  const { loadTesterAIConfig } = await importBehaviorModule('tester/tester-ai-config-store.js');
  assert.equal(await loadTesterAIConfig({
    async get() {
      throw { reasonCode: 'AI_CONFIG_NOT_FOUND' };
    },
  }), null);
  await assert.rejects(() => loadTesterAIConfig({
    async get() {
      throw { reasonCode: 'AI_CONFIG_PERSISTENCE_UNAVAILABLE' };
    },
  }));
});

test('tester delegates one complete portable AIConfig overwrite without app-local route construction', async () => {
  const { overwriteTesterAIConfig } = await importBehaviorModule('tester/tester-ai-config-store.js');
  const capabilities = [
    localIntent('text.generate'),
    {
      capabilityContract: 'video.generate',
      requiredFeatures: [],
      route: {
        oneofKind: 'cloud',
        cloud: {
          implementation: {
            implementationId: 'cloud.video.from-host',
            driverId: 'cloud.driver.from-host',
            driverDialect: 'video/v1',
          },
          providerModelTarget: { provider: 'host-provider', providerModelId: 'host-video-model' },
        },
      },
    },
  ];
  const calls = [];
  const next = await overwriteTesterAIConfig({
    async overwrite(input) {
      calls.push(input);
      return config(...input);
    },
  }, capabilities);

  assert.equal(calls.length, 1);
  assert.equal(calls[0], capabilities);
  assert.deepEqual(next.capabilities, capabilities);
  assert.equal('connectorGrantId' in next.capabilities[1].route.cloud, false);
});

test('tester Model Config adapter preserves portable video intent and rejects grant binding output', async () => {
  const {
    toTesterModelConfigCapabilities,
    toTesterPortableAIConfigCapabilities,
  } = await importBehaviorModule('tester/tester-ai-config-store.js');
  const portable = [{
    capabilityContract: 'video.generate',
    requiredFeatures: [],
    route: {
      oneofKind: 'cloud',
      cloud: {
        implementation: {
          implementationId: 'cloud.video.from-host',
          driverId: 'cloud.driver.from-host',
          driverDialect: 'video/v1',
        },
        providerModelTarget: { provider: 'host-provider', providerModelId: 'host-video-model' },
      },
    },
  }];
  const draft = toTesterModelConfigCapabilities(portable);
  assert.equal(draft[0].route.cloud.connectorGrantId, '');
  assert.deepEqual(toTesterPortableAIConfigCapabilities(draft), portable);

  draft[0].route.cloud.connectorGrantId = 'forbidden-grant';
  assert.throws(
    () => toTesterPortableAIConfigCapabilities(draft),
    /must not submit ConnectorGrant/u,
  );
});

test('tester shared Model Config inventory includes video.generate and deduplicates studio aliases', async () => {
  const {
    testerCapabilities,
    testerModelConfigCapabilityContracts,
  } = await importBehaviorModule('tester/tester-capabilities.js');
  assert.deepEqual(testerModelConfigCapabilityContracts, [
    'text.generate',
    'text.embed',
    'image.generate',
    'video.generate',
    'audio.synthesize',
    'audio.transcribe',
    'voice.create',
  ]);
  for (const capability of testerCapabilities.filter((entry) => entry.execution === 'runtime-sdk')) {
    assert.doesNotMatch(capability.summary, /currently unavailable/iu);
    assert.doesNotMatch(capability.surface, /typed unavailable/iu);
  }
});

test('tester mounts the shared third-party App AIConfig surface instead of custom model fields', () => {
  const source = readFileSync(path.join(
    root,
    'src/tester/workbench/tester-ai-config-settings-panel.tsx',
  ), 'utf8');
  assert.match(source, /ModelConfigAIConfigSurface/u);
  assert.match(source, /consumer: 'third-party-app'/u);
  assert.match(source, /initialCapabilityContract=\{capabilityId\}/u);
  assert.match(source, /rendererHost\.sdk\.modelConfig\.localSelections\(\)/u);
  assert.doesNotMatch(source, /machine-local-ai-configuration-not-exposed-to-local-app/u);
  assert.match(source, /onOpenCloudConnectorConfiguration/u);
  assert.match(source, /kind: 'open-runtime-config'[\s\S]*page: 'cloud'[\s\S]*action: 'add-connector'/u);
  assert.doesNotMatch(source, /Implementation ID|Provider model ID|remoteModelCatalogId/u);
});

test('tester rejects any AIConfig projection not owned by the exact nimi.tester App', async () => {
  const { requireTesterAIConfigOwner } = await importBehaviorModule('tester/tester-ai-config-store.js');
  assert.throws(() => requireTesterAIConfigOwner({
    owner: { owner: { oneofKind: 'app', app: { appId: 'other.app' } } },
    capabilities: [],
  }), /exact nimi\.tester App/u);
});

test('tester keeps an unconfigured capability blocked even when Runtime is connected', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const target = createTesterRunTargetSummary({
    capability: {
      id: 'text.generate', label: 'Text Studio', group: 'text', summary: '', surface: '', execution: 'runtime-sdk',
    },
    runtime: { status: 'connected', mode: 'electron-local-app', detail: 'connected' },
    config: null,
  });
  assert.equal(target.status, 'blocked');
  assert.equal(target.intentLabel, 'Not configured');
  assert.equal(target.canDispatch, false);
});

test('tester never presents an App AIConfig transport failure as unconfigured', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const target = createTesterRunTargetSummary({
    capability: {
      id: 'text.generate', label: 'Text Studio', group: 'text', summary: '', surface: '', execution: 'runtime-sdk',
    },
    runtime: { status: 'connected', mode: 'electron-local-app', detail: 'connected' },
    config: null,
    configState: 'failed',
    configError: 'AIConfig store unavailable',
  });
  assert.equal(target.status, 'blocked');
  assert.equal(target.intentLabel, 'AIConfig unavailable');
  assert.match(target.detail, /store unavailable/u);
  assert.notEqual(target.intentLabel, 'Not configured');
});

test('tester presents Local intent while leaving implementation selection to Runtime', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const target = createTesterRunTargetSummary({
    capability: {
      id: 'text.generate', label: 'Text Studio', group: 'text', summary: '', surface: '', execution: 'runtime-sdk',
    },
    runtime: { status: 'connected', mode: 'electron-local-app', detail: 'connected' },
    config: config(localIntent('text.generate')),
  });
  assert.equal(target.status, 'configured');
  assert.equal(target.source, 'local');
  assert.equal(target.intentLabel, 'Local');
  assert.equal(target.capabilityContract, 'text.generate');
  assert.equal(target.canDispatch, true);
  assert.match(target.detail, /Runtime chooses and validates/u);

  const imageTarget = createTesterRunTargetSummary({
    capability: {
      id: 'image.generate', label: 'Image Generate', group: 'media', summary: '', surface: '', execution: 'runtime-sdk', capabilityContract: 'image.generate',
    },
    runtime: { status: 'connected', mode: 'electron-local-app', detail: 'connected' },
    config: config(localIntent('image.generate')),
  });
  assert.equal(imageTarget.status, 'configured');
  assert.equal(imageTarget.source, 'local');
  assert.equal(imageTarget.canDispatch, true);
});

test('tester keeps Cloud authorization owner-only while allowing typed selection-required execution', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const capability = {
    id: 'image.generate', label: 'Image Generate', group: 'media', summary: '', surface: '', execution: 'runtime-sdk', capabilityContract: 'image.generate',
  };
  const runtime = { status: 'connected', mode: 'electron-local-app', detail: 'connected' };
  const cloudIntent = {
    capabilityContract: 'image.generate',
    requiredFeatures: [],
    route: {
      oneofKind: 'cloud',
      cloud: {
        implementation: {
          implementationId: 'cloud.image.test',
          driverId: 'cloud.driver.test',
          driverDialect: 'test/image/v1',
        },
        providerModelTarget: {
          fields: {
            provider: { kind: { oneofKind: 'stringValue', stringValue: 'provider-test' } },
            providerModelId: { kind: { oneofKind: 'stringValue', stringValue: 'model-test' } },
            remoteModelCatalogId: { kind: { oneofKind: 'stringValue', stringValue: 'catalog-test' } },
          },
        },
      },
    },
  };

  const configured = createTesterRunTargetSummary({ capability, runtime, config: config(cloudIntent) });
  assert.equal(configured.status, 'configured');
  assert.equal(configured.source, 'cloud');
  assert.equal(configured.canDispatch, true);
  assert.match(configured.detail, /Nimi owns authorization selection/u);
  assert.doesNotMatch(JSON.stringify(cloudIntent), /connectorGrant|custody|binding/iu);
});

test('tester dispatches the standalone World Tour only from a Tauri shell', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const capability = {
    id: 'world.generate', label: 'World Tour', group: 'world', summary: '', surface: '', execution: 'standalone-tauri',
  };
  const electron = createTesterRunTargetSummary({
    capability,
    runtime: { status: 'connected', mode: 'electron-local-app', detail: 'connected' },
    config: null,
    standaloneTauriAvailable: false,
  });
  assert.equal(electron.canDispatch, false);

  const tauri = createTesterRunTargetSummary({
    capability,
    runtime: { status: 'connected', mode: 'tauri-local-app', detail: 'connected' },
    config: null,
    standaloneTauriAvailable: true,
  });
  assert.equal(tauri.canDispatch, true);
});

test('tester Simulator uses the same exact App owner shape without claiming Runtime readiness', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const target = createTesterRunTargetSummary({
    capability: {
      id: 'text.generate', label: 'Text Studio', group: 'text', summary: '', surface: '', execution: 'runtime-sdk',
    },
    runtime: {
      status: 'simulated', mode: 'simulated', detail: 'No Runtime connection exists.',
    },
    config: config(localIntent('text.generate')),
  });
  assert.equal(target.status, 'configured');
  assert.equal(target.source, 'local');
  assert.equal(target.canDispatch, true);
});

test('tester run history presents only the configured capability intent', async () => {
  const { getTesterRunIntentLabel, getTesterRunIntentSource } = await importBehaviorModule('tester/tester-history.js');
  const record = {
    id: 'run-local-intent',
    capabilityId: 'text.generate',
    prompt: 'Write a note',
    status: 'failed',
    message: 'Runtime call failed.',
    createdAt: '2026-06-15T09:00:00.000Z',
    runConfig: {
      target: {
        capabilityId: 'text.generate',
        capabilityContract: 'text.generate',
        section: 'text',
        status: 'configured',
        source: 'local',
        intentLabel: 'Local',
        detail: 'Runtime-owned implementation selection',
        params: {},
        paramsSummary: [],
        profileOrigin: null,
      },
      promptControls: { contextAttached: false, attachmentCount: 0 },
    },
  };
  assert.equal(getTesterRunIntentSource(record), 'local');
  assert.equal(getTesterRunIntentLabel(record), 'Local');
});
