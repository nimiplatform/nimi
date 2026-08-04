import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupBehaviorModules,
  importBehaviorModule,
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

test('tester Local selection preserves unrelated intents and carries no model or binding truth', async () => {
  const {
    createTesterLocalCapabilityIntent,
    overwriteTesterCapabilityIntent,
  } = await importBehaviorModule('tester/tester-ai-config-store.js');
  const cloud = {
    capabilityContract: 'image.generate',
    requiredFeatures: [],
    route: {
      oneofKind: 'cloud',
      cloud: {
        implementation: {
          implementationId: 'image.cloud',
          driverId: 'cloud.driver',
          driverDialect: 'v1',
        },
        connectorGrantId: 'grant-image',
      },
    },
  };
  const current = config(cloud);
  const calls = [];
  const next = await overwriteTesterCapabilityIntent({
    async get() {
      return current;
    },
    async overwrite(capabilities) {
      calls.push(capabilities);
      return config(...capabilities);
    },
  }, current, createTesterLocalCapabilityIntent('text.generate'));

  assert.equal(next.capabilities.length, 2);
  assert.equal(next.capabilities[0].capabilityContract, 'image.generate');
  assert.deepEqual(next.capabilities[1], localIntent('text.generate'));
  assert.doesNotMatch(JSON.stringify(next.capabilities[1]), /model|asset|binding|target|path/iu);
  assert.equal(calls.length, 1);
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
  assert.equal(target.modelLabel, 'Not configured');
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
  assert.equal(target.modelLabel, 'AIConfig unavailable');
  assert.match(target.detail, /store unavailable/u);
  assert.notEqual(target.modelLabel, 'Not configured');
});

test('tester presents Local intent as configured and execution-unverified without a model selection', async () => {
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
  assert.equal(target.modelLabel, 'Local');
  assert.equal(target.capabilityContract, 'text.generate');
  assert.equal(target.canDispatch, true);
  assert.match(target.detail, /does not prove execution readiness/u);
});

test('tester keeps grantless Cloud intent unresolved and exact Grant intent execution-unverified', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const capability = {
    id: 'image.generate', label: 'Image Generate', group: 'media', summary: '', surface: '', execution: 'runtime-sdk', capabilityContract: 'image.generate',
  };
  const runtime = { status: 'connected', mode: 'electron-local-app', detail: 'connected' };
  const cloudIntent = (connectorGrantId) => ({
    capabilityContract: 'image.generate',
    requiredFeatures: [],
    route: {
      oneofKind: 'cloud',
      cloud: {
        implementation: {
          implementationId: 'image.cloud',
          driverId: 'cloud.driver',
          driverDialect: 'v1',
        },
        connectorGrantId,
      },
    },
  });

  const unresolved = createTesterRunTargetSummary({ capability, runtime, config: config(cloudIntent('')) });
  assert.equal(unresolved.status, 'blocked');
  assert.equal(unresolved.canDispatch, false);
  assert.match(unresolved.detail, /no ConnectorGrant/u);

  const configured = createTesterRunTargetSummary({ capability, runtime, config: config(cloudIntent('grant-image')) });
  assert.equal(configured.status, 'configured');
  assert.equal(configured.source, 'cloud');
  assert.equal(configured.canDispatch, true);
  assert.match(configured.detail, /does not prove provider availability/u);
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

test('tester run history never exposes opaque Runtime model ids as model titles', async () => {
  const { getTesterRunModelLabel, getTesterRunModelSource } = await importBehaviorModule('tester/tester-history.js');
  const opaqueRuntimeModelId = '01KV2PAC69SRGAB30PCZ9ZH8MN';
  const record = {
    id: 'run-opaque-model',
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
        modelLabel: opaqueRuntimeModelId,
        detail: 'Runtime local configuration',
        params: {},
        paramsSummary: [],
        profileOrigin: null,
      },
      promptControls: { contextAttached: false, attachmentCount: 0 },
    },
  };
  assert.equal(getTesterRunModelSource(record), 'local');
  assert.equal(getTesterRunModelLabel(record), 'Local runtime model');
});
