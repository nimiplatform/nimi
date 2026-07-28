import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupBehaviorModules,
  importBehaviorModule,
} from './helpers.mjs';

test.after(cleanupBehaviorModules);

test('tester run target summary hydrates local runtime model labels without exposing opaque ids', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const capability = {
    id: 'image.generate',
    label: 'Image Generate',
    group: 'media',
    summary: '',
    surface: '',
    execution: 'runtime-sdk',
  };
  const runtime = { status: 'ready', mode: 'test', detail: 'ready' };
  const config = {
    scopeRef: { kind: 'app', appId: 'tester', surfaceId: 'app-lab' },
    capabilities: {
      targetRefs: {
        'image.generate': {
          kind: 'local-runtime',
          version: 'v2',
          readinessRef: 'runtime-route:local:media:01KTEX0CSNAR9Q0B8KXNCF4WPW',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };

  const unresolved = createTesterRunTargetSummary({ capability, runtime, config });
  assert.equal(unresolved.modelLabel, 'Local runtime model');
  assert.notEqual(unresolved.modelLabel, '01KTEX0CSNAR9Q0B8KXNCF4WPW');

  const hydrated = createTesterRunTargetSummary({
    capability,
    runtime,
    config,
    localModels: [{
      localModelId: '01KTEX0CSNAR9Q0B8KXNCF4WPW',
      modelId: 'local-import/z-image-turbo-Q4_K_M',
      model: 'local-import/z-image-turbo-Q4_K_M',
      label: 'local-import/z-image-turbo-Q4_K_M',
      engine: 'media',
    }],
  });
  assert.equal(hydrated.modelLabel, 'z-image-turbo-Q4_K_M');
});

test('tester separates a connected protected session from an unadmitted capability', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const { statusForCapability } = await importBehaviorModule('tester/workbench/section-ai-testing-admission.js');
  const capability = {
    id: 'text.generate',
    label: 'Text Studio',
    group: 'text',
    summary: '',
    surface: '',
    execution: 'runtime-sdk',
  };
  const runtime = {
    status: 'connected',
    mode: 'electron-local-app',
    detail: 'Runtime connected; AI is not admitted by this zero-permission manifest.',
  };

  const target = createTesterRunTargetSummary({ capability, runtime, config: null });
  assert.equal(target.status, 'not-admitted');
  assert.equal(target.modelLabel, 'Not admitted');
  assert.equal(target.canDispatch, false);

  const admission = statusForCapability(capability, runtime, null);
  assert.equal(admission.label, 'not admitted');
  assert.equal(admission.tone, 'info');
  assert.doesNotMatch(admission.detail, /Runtime unavailable/i);
});

test('tester treats modeled simulation as dispatchable without claiming Runtime readiness', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const { statusForCapability } = await importBehaviorModule('tester/workbench/section-ai-testing-admission.js');
  const capability = {
    id: 'text.generate',
    label: 'Text Studio',
    group: 'text',
    summary: '',
    surface: '',
    execution: 'runtime-sdk',
  };
  const runtime = {
    status: 'simulated',
    mode: 'simulated',
    detail: 'SDK testing facade backed by deterministic State Engine data; no Runtime connection exists.',
  };
  const config = {
    scopeRef: { kind: 'app', appId: 'tester', surfaceId: 'app-lab' },
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'simulated-connector',
          remoteModelCatalogId: 'simulated-catalog',
          providerModelId: 'simulated-text-model',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };

  const target = createTesterRunTargetSummary({ capability, runtime, config });
  assert.equal(target.canDispatch, true);
  assert.equal(target.modelLabel, 'simulated-text-model');

  const admission = statusForCapability(capability, runtime, null);
  assert.equal(admission.label, 'simulated');
  assert.equal(admission.tone, 'info');
  assert.match(admission.detail, /no Runtime connection exists/u);
});

test('tester run history never exposes opaque runtime model ids as model titles', async () => {
  const { getTesterRunModelLabel, getTesterRunModelSource } = await importBehaviorModule('tester/tester-history.js');
  const opaqueRuntimeModelId = '01KV2PAC69SRGAB30PCZ9ZH8MN';
  const baseRecord = {
    id: 'run-opaque-model',
    capabilityId: 'text.generate',
    prompt: 'Write a note',
    status: 'failed',
    message: 'Runtime call failed.',
    createdAt: '2026-06-15T09:00:00.000Z',
  };

  const localRecord = {
    ...baseRecord,
    runConfig: {
      target: {
        capabilityId: 'text.generate',
        bindingCapabilityId: 'text.generate',
        section: 'text',
        status: 'blocked',
        source: 'local',
        modelLabel: opaqueRuntimeModelId,
        detail: 'runtime local profile',
        params: {},
        paramsSummary: [],
        profileOrigin: null,
      },
      promptControls: {
        contextAttached: false,
        attachmentCount: 0,
      },
    },
  };

  assert.equal(getTesterRunModelSource(localRecord), 'local');
  assert.equal(getTesterRunModelLabel(localRecord), 'Local runtime model');
  assert.notEqual(getTesterRunModelLabel(localRecord), opaqueRuntimeModelId);

  const resolvedRecord = {
    ...baseRecord,
    status: 'ready',
    result: {
      ok: true,
      kind: 'text',
      summary: 'done',
      body: 'done',
      charCount: 4,
      finishReason: 'stop',
      streamed: false,
      modelResolved: opaqueRuntimeModelId,
      routeDecision: 'route_policy_local',
    },
  };

  assert.equal(getTesterRunModelSource(resolvedRecord), 'local');
  assert.equal(getTesterRunModelLabel(resolvedRecord), 'Local runtime model');
});

test('tester text run target omits unconfigured model drawer placeholders from history', async () => {
  const { createTesterRunTargetSummary } = await importBehaviorModule('tester/tester-run-target.js');
  const capability = {
    id: 'text.generate',
    label: 'Text Studio',
    group: 'text',
    summary: '',
    surface: '',
    execution: 'runtime-sdk',
  };
  const runtime = { status: 'ready', mode: 'test', detail: 'ready' };
  const config = {
    scopeRef: { kind: 'app', appId: 'tester', surfaceId: 'app-lab' },
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          remoteModelCatalogId: 'remote-catalog:runtime-connector:gemini-2.5-pro',
          providerModelId: 'gemini-2.5-pro',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };

  const summary = createTesterRunTargetSummary({ capability, runtime, config });
  assert.deepEqual(summary.params, {});
  assert.deepEqual(summary.paramsSummary, []);
});

test('tester capability model config drawer section follows the active left rail capability while open', async () => {
  const { resolveSectionAITestingConfigSection } = await importBehaviorModule('tester/workbench/section-ai-testing-config-section.js');

  assert.equal(resolveSectionAITestingConfigSection({ open: false, capabilityId: 'image.generate' }), null);
  assert.equal(resolveSectionAITestingConfigSection({ open: true, capabilityId: 'image.generate' }), 'image');
  assert.equal(resolveSectionAITestingConfigSection({ open: true, capabilityId: 'video.generate' }), 'video');
  assert.equal(resolveSectionAITestingConfigSection({ open: true, capabilityId: 'audio.transcribe' }), 'stt');
});

test('tester model picker consumes SDK route projection for runtime local assets and remote connectors', async () => {
  const providerModule = await importBehaviorModule('tester/tester-runtime-model-provider.js');
  const calls = [];
  const remoteConnectorId = 'runtime-cloud-managed';
  const runtimeLocalModelId = 'local.chat.gemma-4-e2b-it.q8-0';
  const provider = providerModule.createTesterRuntimeModelPickerProviderFromClient({
    async listRuntimeRouteOptions(input) {
      calls.push({ surface: 'listRuntimeRouteOptions', input });
      return {
        capability: input.capability,
        selectedTargetRef: null,
        inventory: {
          capability: input.capability,
          targets: [
            {
              targetRef: {
                kind: 'local-runtime',
                version: 'v2',
                profileBindingId: `profile:${runtimeLocalModelId}`,
              },
              display: {
                label: runtimeLocalModelId,
                model: runtimeLocalModelId,
                engine: 'llama',
              },
              readiness: {
                status: 'active',
              },
              compatibility: {
                capabilities: ['text.generate'],
              },
              evidence: {
                source: 'local-runtime',
                localAssetId: runtimeLocalModelId,
                resolvedModelId: runtimeLocalModelId,
                engine: 'llama',
              },
            },
            {
              targetRef: {
                kind: 'cloud-connector',
                version: 'v2',
                connectorId: remoteConnectorId,
                remoteModelCatalogId: `remote-catalog:${remoteConnectorId}:remote.chat.model`,
                providerModelId: 'remote.chat.model',
                provider: 'cloud-provider',
              },
              display: {
                label: 'remote.chat.model',
                modelLabel: 'remote.chat.model',
                provider: 'cloud-provider',
              },
              readiness: {
                status: 'active',
              },
              compatibility: {
                capabilities: ['text.generate'],
              },
              evidence: {
                source: 'cloud-connector',
                connectorId: remoteConnectorId,
                remoteModelCatalogId: `remote-catalog:${remoteConnectorId}:remote.chat.model`,
                providerModelId: 'remote.chat.model',
                provider: 'cloud-provider',
              },
            },
          ],
        },
      };
    },
  }, 'text.generate');

  const connectors = await provider.listConnectors();
  assert.deepEqual(connectors.map((connector) => connector.connectorId), [remoteConnectorId]);

  const localModels = await provider.listLocalModels();
  assert.deepEqual(localModels, [
    {
      localModelId: runtimeLocalModelId,
      goRuntimeLocalModelId: runtimeLocalModelId,
      profileBindingId: `profile:${runtimeLocalModelId}`,
      readinessRef: undefined,
      modelId: runtimeLocalModelId,
      label: runtimeLocalModelId,
      engine: 'llama',
      status: 'active',
      capabilities: ['text.generate'],
    },
  ]);
  const connectorModels = await provider.listConnectorModels(remoteConnectorId);
  assert.deepEqual(connectorModels, [
    {
      modelId: 'remote.chat.model',
      remoteModelCatalogId: `remote-catalog:${remoteConnectorId}:remote.chat.model`,
      providerModelId: 'remote.chat.model',
      provider: 'cloud-provider',
      modelLabel: 'remote.chat.model',
      available: true,
      capabilities: ['text.generate'],
    },
  ]);
  assert.deepEqual(calls, [
    {
      surface: 'listRuntimeRouteOptions',
      input: {
        capability: 'text.generate',
        targetId: undefined,
        selectedTargetRef: undefined,
      },
    },
  ]);
});

test('tester model picker adapts the runtime host client to SDK route options', async () => {
  const providerModule = await importBehaviorModule('tester/tester-runtime-model-provider.js');
  const calls = [];
  const provider = providerModule.createTesterRuntimeModelPickerProviderFromHostClient({
    runtime: {
      connectors: {
        async listConnectors(request) {
          calls.push(`connectors:${request.kindFilter}:${request.statusFilter}`);
          return {
            connectors: [{
              connectorId: 'cloud-managed',
              kind: 2,
              ownerType: 0,
              ownerId: '',
              provider: 'cloud-provider',
              endpoint: '',
              label: 'Cloud Provider',
              status: 1,
              authKind: 0,
              metadata: {},
              supportedCapabilities: [],
              createdAt: '',
              updatedAt: '',
            }],
            nextPageToken: '',
          };
        },
        async listConnectorModels(request) {
          calls.push(`models:${request.connectorId}`);
          return {
            models: [{
              modelId: 'remote.chat.model',
              remoteModelCatalogId: 'remote-catalog:cloud-managed:remote.chat.model',
              providerModelId: 'remote.chat.model',
              provider: 'cloud-provider',
              displayName: 'Remote Chat Model',
              capabilities: ['text.generate'],
              available: true,
              metadata: {},
              pricing: {},
              sourceRef: {},
            }],
            nextPageToken: '',
          };
        },
      },
      local: {
        async listLocalAssets(request) {
          calls.push(`local:${request.kindFilter}:${request.statusFilter}`);
          return {
            assets: [{
              localAssetId: 'local-chat-1',
              assetId: 'local/chat-model',
              kind: 'chat',
              engine: 'llama',
              entry: '',
              files: [],
              license: '',
              hashes: {},
              status: 'active',
              installedAt: '',
              updatedAt: '',
              healthDetail: '',
              capabilities: ['text.generate'],
              logicalModelId: '',
              family: '',
              artifactRoles: [],
              preferredEngine: '',
              fallbackEngines: [],
              bundleState: 0,
              warmState: 0,
              localInvokeProfileId: '',
              endpoint: 'http://127.0.0.1:11434',
              reasonCode: 0,
            }],
            nextPageToken: '',
          };
        },
      },
    },
  }, 'text.generate');

  assert.deepEqual((await provider.listLocalModels()).map((model) => model.localModelId), ['local-chat-1']);
  assert.deepEqual((await provider.listConnectors()).map((connector) => connector.connectorId), ['cloud-managed']);
  assert.deepEqual((await provider.listConnectorModels('cloud-managed')).map((model) => model.modelId), ['remote.chat.model']);
  assert.deepEqual(calls, ['connectors:2:1', 'local:0:0', 'models:cloud-managed']);
});
