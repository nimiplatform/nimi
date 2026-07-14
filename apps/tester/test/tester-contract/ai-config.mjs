import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  cleanupBehaviorModules,
  importBehaviorModule,
  listSourceFiles,
  read,
  readTesterAiTestingSurface,
  readTesterKitComponentGallerySurface,
  root,
} from './helpers.mjs';

test.after(cleanupBehaviorModules);

test('tester renderer resolves kit model-config from source instead of stale prebundle', () => {
  const viteConfig = read('vite.config.ts');

  assert.match(viteConfig, /@nimiplatform\/kit\/features\/model-config/);
  assert.match(viteConfig, /kit\/features\/model-config\/src/);
  assert.match(viteConfig, /optimizeDeps:\s*\{/);
  assert.match(viteConfig, /exclude:\s*\[/);
  assert.match(viteConfig, /'@nimiplatform\/kit\/features\/model-config'/);
  assert.match(viteConfig, /'@nimiplatform\/kit\/features\/model-config\/headless'/);
});

test('tester renderer resolves every consumed kit subpath from source instead of stale dist', () => {
  const viteConfig = read('vite.config.ts');
  const requiredAliases = [
    ['@nimiplatform/kit/auth', 'kit/auth/src'],
    ['@nimiplatform/kit/shell/capabilities', 'kit/shell/capabilities/src'],
    ['@nimiplatform/kit/shell/renderer/bridge', 'kit/shell/renderer/src/bridge'],
    ['@nimiplatform/kit/shell/renderer/bootstrap', 'kit/shell/renderer/src/bootstrap'],
    ['@nimiplatform/kit/telemetry', 'kit/telemetry/src/telemetry'],
    ['@nimiplatform/kit/features/avatar', 'kit/features/avatar/src'],
    ['@nimiplatform/kit/features/chat', 'kit/features/chat/src'],
    ['@nimiplatform/kit/features/commerce', 'kit/features/commerce/src'],
    ['@nimiplatform/kit/features/generation', 'kit/features/generation/src'],
    ['@nimiplatform/kit/features/model-picker', 'kit/features/model-picker/src'],
    ['@nimiplatform/kit/features/model-config', 'kit/features/model-config/src'],
  ];

  for (const [subpath, sourcePath] of requiredAliases) {
    assert.match(viteConfig, new RegExp(subpath.replaceAll('/', '\\/')));
    assert.match(viteConfig, new RegExp(sourcePath.replaceAll('/', '\\/')));
  }

  assert.match(viteConfig, /'@nimiplatform\/kit\/auth'/);
  assert.match(viteConfig, /'@nimiplatform\/kit\/shell\/capabilities'/);
  assert.match(viteConfig, /'@nimiplatform\/kit\/shell\/renderer\/bridge'/);
  assert.match(viteConfig, /'@nimiplatform\/kit\/shell\/renderer\/bootstrap'/);
  assert.match(viteConfig, /'@nimiplatform\/kit\/telemetry'/);
  assert.match(viteConfig, /'@nimiplatform\/kit\/features\/avatar'/);
  assert.match(viteConfig, /'@nimiplatform\/kit\/features\/commerce'/);
  assert.match(viteConfig, /'@nimiplatform\/kit\/features\/generation'/);
});

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

test('tester AI config remains visibly fail-closed until the local-app carrier admits it', () => {
  const store = read('src/tester/tester-ai-config-store.ts');
  const surface = read('src/shell/ai/tester-ai-config-settings.tsx');
  const panel = read('src/tester/workbench/tester-ai-config-settings-panel.tsx');
  const capabilities = readTesterAiTestingSurface(root);
  const runTarget = read('src/tester/tester-run-target.ts');
  const modelConfigHub = read('../../kit/features/model-config/src/components/model-config-ai-model-hub.tsx');
  const runtimeTargetSummary = read('../../kit/features/model-config/src/headless/runtime-target-summary.ts');
  const styles = read('src/tester/tester-workbench.css');

  for (const required of [
    'NimiAIConfig',
    'createNimiAppAIScopeRef',
    'createNimiError',
    'TESTER_LOCAL_APP_AI_CONFIG_UNAVAILABLE',
    'await_local_app_ai_config_operation_admission',
    'importTesterAIProfileJson',
    'saveTesterAIConfig',
    'recordTesterAISnapshot',
    'getLatestTesterAISnapshot',
    '@nimiplatform/kit/features/model-config/headless',
  ]) {
    assert.match(store, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(store, /createInstalledNimiAppStandardShellSurface/);
  assert.doesNotMatch(store, /standardShellSurface\.aiConfig/);
  assert.doesNotMatch(store, /localStorage|sessionStorage/);
  assert.doesNotMatch(store, /createAppAIScopeRef/);
  assert.doesNotMatch(store, /createScopedAIConfigStore/);
  assert.doesNotMatch(store, /createScopedAISnapshotStore/);
  assert.doesNotMatch(store, /createHostAIProfileSurface/);
  assert.doesNotMatch(store, /validateAIProfileRuntimeBindings/);
  assert.doesNotMatch(store, /TESTER_AI_CONFIG_LEGACY_STORAGE_KEY/);
  assert.doesNotMatch(store, /migrateLegacyTesterAIConfigIfNeeded/);
  assert.doesNotMatch(store, /scope-mismatch/);
  assert.doesNotMatch(store, /resolveBrowserStorage/);
  assert.doesNotMatch(store, /createNimiAIConfigStore/);
  assert.doesNotMatch(store, /TESTER_AI_CONFIG_STORAGE_KEY/);
  assert.doesNotMatch(store, /repairTesterAIConfigStorageForScope/);

  // The kit model-config mechanics live in the scaffold-managed sectioned config
  // surface skeleton (inherited by every generated app). It composes admitted kit
  // primitives and accepts an initialSection so a capability gear can deep-link.
  for (const required of [
    'ModelConfigAiModelHub',
    'useModelConfigProfileController',
    'defaultModelConfigProfileCopy',
    'Import AIProfile JSON',
    'Open Apply AI Profile to preview and confirm',
    'fail closed',
    'initialSection',
    'detailOnly',
    'detailActiveModelHint={null}',
    'footer={importFooter}',
    'profile={profileController}',
    'resolveModelConfigLocalRuntimeStatus',
  ]) {
    assert.match(surface, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(surface, /ProfileConfigSection/);
  assert.doesNotMatch(surface, /ModelConfigCapabilityDetail/);
  assert.match(modelConfigHub, /import \{ ProfileConfigSection \} from '\.\/profile-config-section\.js';/);
  assert.match(modelConfigHub, /import \{ ModelConfigCapabilityDetail \} from '\.\/model-config-capability-detail\.js';/);
  assert.match(modelConfigHub, /initialSection\?: CanonicalCapabilitySectionId \| null/);
  assert.match(modelConfigHub, /detailOnly\?: boolean/);
  assert.match(modelConfigHub, /detailActiveModelHint\?: string \| null/);
  assert.match(modelConfigHub, /footer\?: ReactNode/);
  assert.match(modelConfigHub, /<ProfileConfigSection controller=\{profile\} variant="import-button" \/>/);
  assert.match(modelConfigHub, /<ModelConfigCapabilityDetail/);
  assert.doesNotMatch(surface, /targetRefDetail/);
  assert.doesNotMatch(surface, /title:\s*'Target configured'/);
  assert.doesNotMatch(surface, /NimiAIConfigTargetRef/);
  assert.doesNotMatch(surface, /function localRuntimeRefCandidates/);
  assert.doesNotMatch(surface, /function imageLocalSetupStatus/);
  assert.doesNotMatch(surface, /applyAIProfileToConfig/);
  assert.match(surface, /profileController\.onCancelPreview\(\)/);
  assert.match(surface, /profileController\.onSelectedProfileChange\(result\.profileId\)/);
  assert.doesNotMatch(surface, /profileController\.onApply\(result\.profileId\)/);

  // The tester wrapper injects app-scoped wiring into that surface.
  for (const required of [
    'TesterAiConfigSettings',
    'createTesterRuntimeModelPickerProvider',
    'importTesterAIProfileJson',
    "'ModelConfig.profile.importLabel': 'Apply AI Profile'",
    "runtime?.status === 'ready'",
  ]) {
    assert.match(panel, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(surface, /<ScrollArea\s+className="min-h-0 min-w-0 max-w-full flex-1"/);
  assert.match(surface, /viewportClassName=\{drawer \? 'section-ai-testing__drawer-viewport' : undefined\}/);
  assert.match(surface, /'w-full min-w-0 max-w-full overflow-x-hidden px-6 py-4'/);

  // The AI config lives in Settings; the AI Capabilities settings gear deep-links
  // into the configured capability's section. App Lab no longer owns a bespoke
  // AIConfig lives in a right slide-over opened by the per-capability settings
  // gear (full adoption of the canonical kit model-config surface). App Lab's
  // bespoke AIConfig panel was removed entirely.
  assert.match(capabilities, /TesterAiConfigSettingsPanel/);
  assert.match(capabilities, /resolveSectionAITestingConfigSection/);
  assert.match(capabilities, /createRendererEntryModuleLoader/);
  assert.match(capabilities, /DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS/);
  assert.match(capabilities, /testerModelConfigPanelLoader/);
  assert.match(capabilities, /load\('tester model config panel'/);
  assert.match(capabilities, /onOpenConfig/);
  assert.doesNotMatch(capabilities, /function RunTargetBar/);
  assert.doesNotMatch(capabilities, /data-testid="studio-run-target"/);
  assert.match(capabilities, /createTesterRunTargetSummary/);
  assert.match(capabilities, /function canConfigureRunTarget\(runTarget: TesterRunTargetSummary\)/);
  assert.match(capabilities, /runTarget\.modelLabel === 'Target required'/);
  assert.match(capabilities, /runTarget\.source === 'profile-slice'/);
  assert.match(capabilities, /canDispatch=\{runTarget\.canDispatch\}/);
  assert.match(capabilities, /canConfigureTarget=\{canConfigureRunTarget\(runTarget\)\}/);
  assert.match(capabilities, /disabled=\{generateDisabled\}/);
  assert.match(capabilities, /onClick=\{targetConfigAction \? onOpenModelConfig : onSubmit\}/);
  assert.match(capabilities, /if \(!runTarget\.canDispatch\) return/);
  assert.match(runTarget, /export type TesterRunTargetSummary/);
  for (const required of [
    'capabilityId',
    'bindingCapabilityId',
    'section',
    'status',
    'source',
    'modelLabel',
    'detail',
    'canDispatch',
    'paramsSummary',
    'profileOrigin',
  ]) {
    assert.match(runTarget, new RegExp(required));
  }
  assert.match(runTarget, /summarizeModelConfigRuntimeTarget/);
  assert.match(runTarget, /getTesterRuntimeBindingCapabilityId\(capability\.id\)/);
  assert.match(runtimeTargetSummary, /targetRef\.kind === 'profile-slice'/);
  assert.match(runtimeTargetSummary, /input\.runtimeStatus === 'blocked'/);
  assert.match(runtimeTargetSummary, /Choose a Runtime model target/);
  assert.doesNotMatch(runTarget, /gpt-4|claude|gemini|openai|anthropic|model:\s*['"]auto['"]/i);
  assert.doesNotMatch(styles, /\.studio-run-target/);
  assert.doesNotMatch(styles, /\.studio-run-target__params/);
  assert.match(styles, /\.studio-generate-action--configure\s*\{[^}]*background:\s*#35c99d/s);
  assert.match(styles, /\.workbench\s*\{[^}]*--studio-side-panel-width:\s*min\(360px,\s*calc\(100vw - 48px\)\)/s);
  assert.match(styles, /\.section-ai-testing__drawer\s*\{[^}]*position:\s*absolute/s);
  assert.match(styles, /\.section-ai-testing__drawer\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(styles, /\.section-ai-testing__drawer\s*\{[^}]*width:\s*var\(--studio-side-panel-width\)/s);
  assert.match(styles, /\.section-ai-testing__drawer\s*\{[^}]*max-width:\s*100%/s);
  assert.match(styles, /\.section-ai-testing__drawer-viewport\s*>\s*div\s*\{[^}]*display:\s*block\s*!important/s);
  assert.match(styles, /\.section-ai-testing__drawer-viewport\s*>\s*div\s*\{[^}]*width:\s*100%\s*!important/s);
  assert.match(styles, /\.section-ai-testing__drawer\s*\{[^}]*animation:\s*section-ai-testing-drawer-slide-in/s);
  assert.match(styles, /@keyframes section-ai-testing-drawer-slide-in[\s\S]*translate3d\(100%,\s*0,\s*0\)/);
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*\.section-ai-testing__drawer[\s\S]*width:\s*100%/);
});

test('tester capability model config drawer section follows the active left rail capability while open', async () => {
  const { resolveSectionAITestingConfigSection } = await importBehaviorModule('tester/workbench/section-ai-testing-config-section.js');
  const capabilities = readTesterAiTestingSurface(root);

  assert.equal(resolveSectionAITestingConfigSection({ open: false, capabilityId: 'image.generate' }), null);
  assert.equal(resolveSectionAITestingConfigSection({ open: true, capabilityId: 'image.generate' }), 'image');
  assert.equal(resolveSectionAITestingConfigSection({ open: true, capabilityId: 'video.generate' }), 'video');
  assert.equal(resolveSectionAITestingConfigSection({ open: true, capabilityId: 'audio.transcribe' }), 'stt');
  assert.match(capabilities, /resolveSectionAITestingConfigSection/);
  assert.match(capabilities, /configOpen/);
  assert.doesNotMatch(capabilities, /useState<CanonicalCapabilitySectionId \| null>/);
});

test('tester keeps AIConfig and AI execution fail-closed until separately admitted', () => {
  const runtime = read('src/tester/tester-runtime.ts');

  assert.match(runtime, /Only the eight typed local-app carrier operations are admitted/);
  assert.match(runtime, /'sdk-method-unavailable'/);
  assert.doesNotMatch(runtime, /invokeTesterCapability|projection\.client|new Runtime/);
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

test('tester model picker catalog uses SDK route options projection only', () => {
  const provider = read('src/tester/tester-runtime-model-provider.ts');
  const summary = read('src/tester/tester-ai-config.ts');

  assert.match(provider, /createRuntimeRouteModelPickerProvider/);
  assert.match(provider, /@nimiplatform\/kit\/features\/model-picker\/runtime/);
  assert.match(provider, /getRuntimePlatformProjection/);
  assert.match(provider, /createNimiRuntimeRouteOptionsHostDeps/);
  assert.match(provider, /listNimiRuntimeRouteOptionsWithHost/);
  assert.match(provider, /listRuntimeRouteOptions/);
  assert.match(provider, /model catalog failed closed/);
  assert.doesNotMatch(provider, /normalizeRuntimeRouteCapabilityToken/);
  assert.doesNotMatch(provider, /createSnapshotRouteDataProvider/);
  assert.doesNotMatch(provider, /as unknown as RuntimeRouteModelPickerClient/);
  assert.doesNotMatch(provider, /as NimiRuntimeCanonicalCapability/);
  assert.doesNotMatch(provider, /openai|anthropic|gemini|gpt-4|claude|mock.*success/i);
  assert.match(summary, /sdk\.runtime\.listNimiRuntimeRouteOptions/);
  assert.doesNotMatch(summary, /runtimeAdmin\.listConnectors\/listConnectorModels/);
});

test('tester local asset source remains empty while model catalog access is not admitted', () => {
  const panel = read('src/tester/workbench/tester-ai-config-settings-panel.tsx');

  assert.match(panel, /return \[\] as LocalAssetEntry\[\]/);
  assert.doesNotMatch(panel, /listNimiRuntimeLocalAssetEntries|artifactRoles:\s*asset\.artifactRoles/);
});
