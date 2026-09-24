import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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

test('lab loads the canonical unconfigured snapshot and propagates transport failures', async () => {
  const { loadLabAIConfig } = await importBehaviorModule('lab/lab-ai-config-store.js');
  const unconfigured = { config: null, revision: '0', effectiveSelections: [] };
  assert.deepEqual(await loadLabAIConfig({
    async get() {
      return unconfigured;
    },
  }), unconfigured);
  await assert.rejects(() => loadLabAIConfig({
    async get() {
      throw { reasonCode: 'AI_CONFIG_PERSISTENCE_UNAVAILABLE' };
    },
  }));
});

test('lab refreshes the canonical AIConfig projection when another manager returns focus or the in-app drawer writes', async () => {
  const { subscribeLabAIConfigOwnerRefresh } = await importBehaviorModule('lab/lab-ai-config-store.js');
  const { STUDIO_AI_CONFIG_CHANGED_EVENT } = await importBehaviorModule('ai-studio-core/ai-config.js');
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
  focusTarget.dispatch(STUDIO_AI_CONFIG_CHANGED_EVENT);
  assert.equal(refreshes, 3);

  unsubscribe();
  focusTarget.dispatch('focus');
  visibilityTarget.dispatch('visibilitychange');
  focusTarget.dispatch(STUDIO_AI_CONFIG_CHANGED_EVENT);
  assert.equal(refreshes, 3);
});

test('lab clones the immutable AIConfig projection for the Kit editor', async () => {
  const { projectLabAIConfigCapabilities } = await importBehaviorModule('lab/lab-ai-config-store.js');
  const intent = localIntent('text.generate');
  const projected = projectLabAIConfigCapabilities([intent]);
  assert.deepEqual(projected, [intent]);
  assert.notEqual(projected[0], intent);
  assert.notEqual(projected[0].requiredFeatures, intent.requiredFeatures);
});

test('lab shared Model Config inventory covers every Lab entry and deduplicates studio aliases', async () => {
  const {
    labCapabilities,
    labModelConfigCapabilityContracts,
  } = await importBehaviorModule('lab/lab-capabilities.js');
  assert.deepEqual(labModelConfigCapabilityContracts, [
    'text.generate',
    'text.embed',
    'music.transcribe',
    'audio.voice.convert',
    'audio.separate',
    'vision.locate',
    'image.generate',
    'video.generate',
    'music.generate',
    'audio.synthesize',
    'audio.transcribe',
    'voice.create',
    'world.generate',
    'text.annotate',
    'text.decide',
    'image.face_swap',
    'video.face_swap',
    'realtime.interact',
  ]);
  for (const capability of labCapabilities.filter((entry) => entry.execution === 'runtime-sdk')) {
    assert.doesNotMatch(capability.summary, /currently unavailable/iu);
    assert.doesNotMatch(capability.surface, /typed unavailable/iu);
  }
});

// A new canonical contract lands in Lab together with a formal entry, its
// focused regression and its real acceptance path (see apps/lab/README.md).
test('every canonical capability has a formal Lab entry through the existing inventory', async () => {
  const { CANONICAL_CAPABILITY_IDS } = await import('@nimiplatform/kit/core/runtime-capabilities');
  const { labModelConfigCapabilityContracts } = await importBehaviorModule('lab/lab-capabilities.js');
  assert.deepEqual(
    CANONICAL_CAPABILITY_IDS.filter((id) => !labModelConfigCapabilityContracts.includes(id)),
    [],
  );
});

test('lab-only capability tests join the existing section-based navigation without public scaffold admission', async () => {
  const { workbenchNavGroups } = await importBehaviorModule('lab/workbench/workbench-context.js');
  const groupOf = (id) => workbenchNavGroups.find((group) => group.capabilityIds.includes(id))?.id;
  assert.equal(groupOf('text.annotate'), 'text');
  assert.equal(groupOf('text.tools'), 'text');
  assert.equal(groupOf('text.decide'), 'text');
  assert.equal(groupOf('image.face_swap'), 'image-video');
  assert.equal(groupOf('video.face_swap'), 'image-video');
  assert.equal(groupOf('realtime.interact'), 'voice-music');
  const scaffold = readFileSync(path.join(root, '../../app-tools/lib/app-scaffold-capabilities.mjs'), 'utf8');
  for (const id of ['text.annotate', 'text.tools', 'text.decide', 'image.face_swap', 'video.face_swap', 'realtime.interact']) {
    assert.equal(scaffold.includes(`'${id}'`), false, `${id} stays out of public scaffold admission`);
  }
  for (const relative of ['src/ai-studio-core', 'src/studio-modules']) {
    for (const file of readdirSync(path.join(root, relative), { recursive: true })) {
      if (!/\.(ts|tsx|json)$/u.test(String(file))) continue;
      assert.doesNotMatch(readFileSync(path.join(root, relative, String(file)), 'utf8'), /lab-only|Nimi Lab|nimi\.lab/u, `${relative}/${file}`);
    }
  }
});

test('lab mounts the shared App AIConfig editor with self-owner CAS and optional Desktop handoff', () => {
  const source = readFileSync(path.join(
    root,
    'src/lab/workbench/lab-ai-config-settings-panel.tsx',
  ), 'utf8');
  assert.match(source, /ModelConfigAIConfigSurface/u);
  assert.doesNotMatch(source, /consumer: 'third-party-app'/u);
  assert.match(source, /initialCapabilityContract=\{capabilityId\}/u);
  assert.match(source, /sdk\.aiConfig\.listOptions\(query\)/u);
  assert.match(source, /sdk\.aiConfig\.overwrite\(input\)/u);
  // Every outcome re-reads this panel; a commit also reaches every other
  // mounted consumer, even when the drawer closed before the write finished.
  assert.match(
    source,
    /setSnapshot\(\{ config: result\.config, revision: result\.revision, effectiveSelections: \[\] \}\);[\s\S]{0,240}?if \(result\.outcome === 'committed'\) onCommitted\(\);\s*else void refresh\(\);/u,
  );
  const workbench = readFileSync(path.join(root, 'src/lab/lab-workbench.tsx'), 'utf8');
  assert.match(workbench, /renderAIConfigPanel=\{\(\{ runtime, capabilityId, onCommitted \}\) =>[\s\S]{0,200}?onCommitted=\{onCommitted\}/u);
  assert.match(source, /onOpenOwnerConfiguration/u);
  assert.match(source, /kind: 'open-apps'[\s\S]*appId[\s\S]*section: 'ai-models'/u);
  assert.match(
    source,
    /return subscribeLabAIConfigOwnerRefresh\([\s\S]{0,240}?window,[\s\S]{0,80}?document/u,
  );
  assert.doesNotMatch(source, /sdk\.modelConfig|open-runtime-config/u);
});

test('lab renderer exposes the canonical self-owner App AIConfig manager', () => {
  const sources = [
    'src/renderer/contract.ts',
    'src/renderer/production-bindings.ts',
    'src/lab/lab-ai-config-store.ts',
  ].map((relative) => readFileSync(path.join(root, relative), 'utf8')).join('\n');
  assert.match(sources, /NimiLocalAppAIConfigClient/u);
  assert.doesNotMatch(sources, /lab\.ai-config\.update|overwriteLabAIConfig|toLabPortableAIConfigCapabilities/u);
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
  assert.match(target.detail, /committed the Local route/u);
  assert.match(target.detail, /current machine-selected Loadout/u);

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

test('lab never presents a saved Cloud intent as runnable for Local-only Lab entries', async () => {
  const { createLabRunTargetSummary } = await importBehaviorModule('lab/lab-run-target.js');
  const { t } = await importBehaviorModule('shell/i18n/index.js');
  const runtime = { status: 'connected', mode: 'electron-local-app', detail: 'connected' };
  const text = (value) => ({ kind: { oneofKind: 'stringValue', stringValue: value } });
  const cloudIntent = (capabilityContract) => ({
    capabilityContract,
    requiredFeatures: [],
    route: {
      oneofKind: 'cloud',
      cloud: {
        connectorRef: 'connector-cloud-test',
        implementation: { implementationId: 'cloud.test', driverId: 'cloud.driver.test', driverDialect: 'test/v1' },
        providerModelTarget: { fields: { provider: text('provider-test'), providerModelId: text('model-test'), remoteModelCatalogId: text('catalog-test') } },
      },
    },
  });
  const capability = (id, capabilityContract) => ({
    id, label: id, group: 'media', section: 'image', summary: '', surface: '', execution: 'runtime-sdk', capabilityContract,
  });
  for (const id of ['text.annotate', 'image.face_swap', 'video.face_swap']) {
    const cloud = createLabRunTargetSummary({ capability: capability(id, id), runtime, config: config(cloudIntent(id)) });
    assert.equal(cloud.status, 'blocked', id);
    assert.equal(cloud.source, 'cloud');
    assert.equal(cloud.canDispatch, false);
    assert.equal(cloud.detail, t('CapabilityTests.common.localRouteBlocked'));
    assert.match(cloud.detail, /AI_ROUTE_UNSUPPORTED/u);
    const local = createLabRunTargetSummary({ capability: capability(id, id), runtime, config: config(localIntent(id)) });
    assert.equal(local.status, 'configured', id);
    assert.equal(local.canDispatch, true);
  }
  // A contract Runtime runs on both routes keeps a configured Cloud intent runnable.
  const tools = createLabRunTargetSummary({ capability: capability('text.tools', 'text.generate'), runtime, config: config(cloudIntent('text.generate')) });
  assert.equal(tools.status, 'configured');
  assert.equal(tools.canDispatch, true);
  for (const intent of [cloudIntent('text.decide'), localIntent('text.decide')]) {
    const decide = createLabRunTargetSummary({ capability: capability('text.decide', 'text.decide'), runtime, config: config(intent) });
    assert.equal(decide.status, 'configured', intent.route.oneofKind);
    assert.equal(decide.canDispatch, true, intent.route.oneofKind);
  }
});

test('lab requires an exact Connector and provider-model target for Cloud execution', async () => {
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
        connectorRef: 'connector-cloud-image-test',
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
  assert.match(configured.detail, /exact Cloud Connector and provider-model target/u);
  assert.doesNotMatch(JSON.stringify(cloudIntent), /custody|binding/iu);

  const missingConnector = structuredClone(cloudIntent);
  delete missingConnector.route.cloud.connectorRef;
  const missingConnectorResult = createLabRunTargetSummary({
    capability,
    runtime,
    config: config(missingConnector),
  });
  assert.equal(missingConnectorResult.status, 'blocked');
  assert.equal(missingConnectorResult.canDispatch, false);

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

test('lab dispatches World Tour generation through the App AIConfig like every Runtime capability', async () => {
  const { getLabCapability } = await importBehaviorModule('lab/lab-capabilities.js');
  const { createLabRunTargetSummary } = await importBehaviorModule('lab/lab-run-target.js');
  const capability = getLabCapability('world.generate');
  assert.equal(capability.execution, 'runtime-sdk');
  assert.equal(capability.capabilityContract, 'world.generate');
  const runtime = { status: 'connected', mode: 'electron-local-app', detail: 'connected' };
  const unconfigured = createLabRunTargetSummary({ capability, runtime, config: null, standaloneViewerAvailable: true });
  assert.equal(unconfigured.status, 'blocked');
  assert.equal(unconfigured.canDispatch, false);
  assert.notEqual(unconfigured.intentLabel, 'Local fixture');
  const configured = createLabRunTargetSummary({ capability, runtime, config: config(localIntent('world.generate')) });
  assert.equal(configured.status, 'configured');
  assert.equal(configured.canDispatch, true);
  assert.equal(configured.source, 'local');
  const workspace = readFileSync(path.join(root, 'src/lab/lab-ai-studio-workspace.tsx'), 'utf8');
  assert.doesNotMatch(workspace, /'local-fixture'/u, 'a real World Tour generation is not recorded as a fixture');
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
