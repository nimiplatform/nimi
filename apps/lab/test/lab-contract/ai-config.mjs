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

const owner = { owner: { oneofKind: 'app', app: { appId: 'nimi.lab' } } };
const localIntent = (capabilityContract) => ({
  capabilityContract,
  requiredFeatures: [],
  route: { oneofKind: 'local', local: {} },
});
const config = (...capabilities) => ({ owner, capabilities });

test('lab treats AI_CONFIG_NOT_FOUND as one unconfigured App AIConfig projection', async () => {
  const { loadLabAIConfig } = await importBehaviorModule('lab/lab-ai-config-store.js');
  assert.equal(await loadLabAIConfig({
    async get() {
      throw { reasonCode: 'AI_CONFIG_NOT_FOUND' };
    },
  }), null);
  await assert.rejects(() => loadLabAIConfig({
    async get() {
      throw { reasonCode: 'AI_CONFIG_PERSISTENCE_UNAVAILABLE' };
    },
  }));
});

test('lab refreshes the read-only AIConfig projection when owner handoff returns focus', async () => {
  const { subscribeLabAIConfigOwnerRefresh } = await importBehaviorModule('lab/lab-ai-config-store.js');
  const createTarget = () => {
    const listeners = new Map();
    return {
      addEventListener(type, listener) {
        const current = listeners.get(type) ?? new Set();
        current.add(listener);
        listeners.set(type, current);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      dispatch(type) {
        for (const listener of listeners.get(type) ?? []) listener({ type });
      },
    };
  };
  const focusTarget = createTarget();
  const visibilityTarget = createTarget();
  visibilityTarget.visibilityState = 'hidden';
  let refreshes = 0;
  const unsubscribe = subscribeLabAIConfigOwnerRefresh(
    () => { refreshes += 1; },
    focusTarget,
    visibilityTarget,
  );

  focusTarget.dispatch('focus');
  visibilityTarget.dispatch('visibilitychange');
  visibilityTarget.visibilityState = 'visible';
  visibilityTarget.dispatch('visibilitychange');
  assert.equal(refreshes, 2);

  unsubscribe();
  focusTarget.dispatch('focus');
  visibilityTarget.dispatch('visibilitychange');
  assert.equal(refreshes, 2);
});

test('lab clones the immutable AIConfig projection only for read-only Kit display', async () => {
  const { projectLabAIConfigCapabilities } = await importBehaviorModule('lab/lab-ai-config-store.js');
  const intent = localIntent('text.generate');
  const projected = projectLabAIConfigCapabilities([intent]);
  assert.deepEqual(projected, [intent]);
  assert.notEqual(projected[0], intent);
  assert.notEqual(projected[0].requiredFeatures, intent.requiredFeatures);
});

test('lab shared Model Config inventory includes video.generate and deduplicates studio aliases', async () => {
  const {
    labCapabilities,
    labModelConfigCapabilityContracts,
  } = await importBehaviorModule('lab/lab-capabilities.js');
  assert.deepEqual(labModelConfigCapabilityContracts, [
    'text.generate',
    'text.embed',
    'image.generate',
    'video.generate',
    'music.generate',
    'audio.synthesize',
    'audio.transcribe',
    'voice.create',
  ]);
  for (const capability of labCapabilities.filter((entry) => entry.execution === 'runtime-sdk')) {
    assert.doesNotMatch(capability.summary, /currently unavailable/iu);
    assert.doesNotMatch(capability.surface, /typed unavailable/iu);
  }
});

test('lab mounts the shared third-party App AIConfig surface as read-only with an exact owner handoff', () => {
  const source = readFileSync(path.join(
    root,
    'src/lab/workbench/lab-ai-config-settings-panel.tsx',
  ), 'utf8');
  assert.match(source, /ModelConfigAIConfigSurface/u);
  assert.match(source, /consumer: 'third-party-app'/u);
  assert.match(source, /initialCapabilityContract=\{capabilityId\}/u);
  assert.match(source, /rendererHost\.sdk\.modelConfig\.localSelections\(\)/u);
  assert.match(source, /onOpenOwnerConfiguration/u);
  assert.match(source, /kind: 'open-apps'[\s\S]*appId[\s\S]*section: 'ai-models'/u);
  assert.match(
    source,
    /return subscribeLabAIConfigOwnerRefresh\([\s\S]{0,240}?window,[\s\S]{0,80}?document/u,
  );
  assert.doesNotMatch(source, /onOverwrite|onOpenCloudConnectorConfiguration|open-runtime-config/u);
  assert.doesNotMatch(source, /cloudAIConfig|ModelPicker|provider picker/iu);
});

test('lab renderer exposes App AIConfig projection without a write port', () => {
  const sources = [
    'src/renderer/contract.ts',
    'src/renderer/production-bindings.ts',
    'src/lab/lab-ai-config-store.ts',
  ].map((relative) => readFileSync(path.join(root, relative), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /lab\.ai-config\.update|overwriteLabAIConfig|toLabPortableAIConfigCapabilities/u);
  assert.doesNotMatch(sources, /aiConfig\s*:\s*\{[\s\S]{0,240}?overwrite\s*\(/u);
});

test('lab rejects any AIConfig projection not owned by the exact nimi.lab App', async () => {
  const { requireLabAIConfigOwner } = await importBehaviorModule('lab/lab-ai-config-store.js');
  assert.throws(() => requireLabAIConfigOwner({
    owner: { owner: { oneofKind: 'app', app: { appId: 'other.app' } } },
    capabilities: [],
  }), /exact nimi\.lab App/u);
});

test('lab keeps an unconfigured capability blocked even when Runtime is connected', async () => {
  const { createLabRunTargetSummary } = await importBehaviorModule('lab/lab-run-target.js');
  const target = createLabRunTargetSummary({
    capability: {
      id: 'text.generate', label: 'Text Studio', group: 'text', section: 'chat', summary: '', surface: '', execution: 'runtime-sdk', capabilityContract: 'text.generate',
    },
    runtime: { status: 'connected', mode: 'electron-local-app', detail: 'connected' },
    config: null,
  });
  assert.equal(target.status, 'blocked');
  assert.equal(target.intentLabel, 'Not configured');
  assert.equal(target.canDispatch, false);
});

test('lab never presents an App AIConfig transport failure as unconfigured', async () => {
  const { createLabRunTargetSummary } = await importBehaviorModule('lab/lab-run-target.js');
  const target = createLabRunTargetSummary({
    capability: {
      id: 'text.generate', label: 'Text Studio', group: 'text', section: 'chat', summary: '', surface: '', execution: 'runtime-sdk', capabilityContract: 'text.generate',
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

test('lab presents Local intent while leaving implementation selection to Runtime', async () => {
  const { createLabRunTargetSummary } = await importBehaviorModule('lab/lab-run-target.js');
  const target = createLabRunTargetSummary({
    capability: {
      id: 'text.generate', label: 'Text Studio', group: 'text', section: 'chat', summary: '', surface: '', execution: 'runtime-sdk', capabilityContract: 'text.generate',
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

  const imageTarget = createLabRunTargetSummary({
    capability: {
      id: 'image.generate', label: 'Image Generate', group: 'media', section: 'image', summary: '', surface: '', execution: 'runtime-sdk', capabilityContract: 'image.generate',
    },
    runtime: { status: 'connected', mode: 'electron-local-app', detail: 'connected' },
    config: config(localIntent('image.generate')),
  });
  assert.equal(imageTarget.status, 'configured');
  assert.equal(imageTarget.source, 'local');
  assert.equal(imageTarget.canDispatch, true);
});

test('lab keeps current-account Connector resolution Runtime-owned while allowing Cloud execution', async () => {
  const { createLabRunTargetSummary } = await importBehaviorModule('lab/lab-run-target.js');
  const capability = {
    id: 'image.generate', label: 'Image Generate', group: 'media', section: 'image', summary: '', surface: '', execution: 'runtime-sdk', capabilityContract: 'image.generate',
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

  const configured = createLabRunTargetSummary({ capability, runtime, config: config(cloudIntent) });
  assert.equal(configured.status, 'configured');
  assert.equal(configured.source, 'cloud');
  assert.equal(configured.canDispatch, true);
  assert.match(configured.detail, /Nimi-owned App configuration/u);
  assert.doesNotMatch(JSON.stringify(cloudIntent), /custody|binding/iu);

  const missingExactTarget = structuredClone(cloudIntent);
  delete missingExactTarget.route.cloud.providerModelTarget.fields.remoteModelCatalogId;
  const blocked = createLabRunTargetSummary({
    capability,
    runtime,
    config: config(missingExactTarget),
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.canDispatch, false);
  assert.equal(blocked.intentLabel, 'Invalid configuration');
});

test('lab dispatches the standalone World Tour only from a Tauri shell', async () => {
  const { createLabRunTargetSummary } = await importBehaviorModule('lab/lab-run-target.js');
  const capability = {
    id: 'world.generate', label: 'World Tour', group: 'world', section: 'world', summary: '', surface: '', execution: 'standalone-tauri',
  };
  const electron = createLabRunTargetSummary({
    capability,
    runtime: { status: 'connected', mode: 'electron-local-app', detail: 'connected' },
    config: null,
    standaloneTauriAvailable: false,
  });
  assert.equal(electron.canDispatch, false);

  const tauri = createLabRunTargetSummary({
    capability,
    runtime: { status: 'connected', mode: 'tauri-local-app', detail: 'connected' },
    config: null,
    standaloneTauriAvailable: true,
  });
  assert.equal(tauri.canDispatch, true);
});

test('lab run history presents only the configured capability intent', async () => {
  const { getStudioRunIntentLabel, getStudioRunIntentSource } = await importBehaviorModule('ai-studio-core/history.js');
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
  assert.equal(getStudioRunIntentSource(record), 'local');
  assert.equal(getStudioRunIntentLabel(record), 'Local');
});
