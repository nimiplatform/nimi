import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(next);
    return /\.(ts|tsx)$/.test(entry.name) ? [next] : [];
  });
}

let behaviorBuildDir = null;

function buildBehaviorModules() {
  if (behaviorBuildDir) return behaviorBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  behaviorBuildDir = mkdtempSync(path.join(root, '.tmp', 'behavior-'));
  execFileSync('pnpm', [
    'exec',
    'tsc',
    '--outDir',
    behaviorBuildDir,
    '--rootDir',
    'src',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--jsx',
    'react-jsx',
    '--skipLibCheck',
    'true',
    '--types',
    'node',
    '--noEmit',
    'false',
    'src/tester/tester-runtime-invokers.ts',
    'src/tester/tester-ai-config-store.ts',
    'src/tester/tester-runtime-model-provider.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return behaviorBuildDir;
}

async function importBehaviorModule(relativePath) {
  const buildDir = buildBehaviorModules();
  return import(pathToFileURL(path.join(buildDir, relativePath)).href);
}

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    key(index) {
      return [...map.keys()][index] || null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

test.after(() => {
  if (behaviorBuildDir) {
    rmSync(behaviorBuildDir, { recursive: true, force: true });
  }
});

test('tester workbench is app-owned and rejects Desktop private imports', () => {
  const sources = listSourceFiles(path.join(root, 'src')).map((filePath) => readFileSync(filePath, 'utf8')).join('\n');
  assert.match(sources, /TesterWorkbench/);
  assert.match(sources, /KitComponentGallery/);
  assert.match(sources, /typed unavailable/i);
  assert.doesNotMatch(sources, /from ['"]@renderer\//);
  assert.doesNotMatch(sources, /from ['"]@runtime\//);
  assert.doesNotMatch(sources, /getDesktopAIConfigService/);
  assert.doesNotMatch(sources, /runtime-config-profile-library/);
  assert.doesNotMatch(sources, /mock.*success/i);
  assert.doesNotMatch(sources, /pseudo/i);
});

test('tester kit gallery showcases real kit components for third-party apps', () => {
  const gallery = read('src/tester/kit-component-gallery.tsx');
  for (const required of [
    'Button',
    'IconButton',
    'TextField',
    'TextareaField',
    'SelectField',
    'Toggle',
    'Checkbox',
    'Slider',
    'SegmentedControl',
    'ProgressIndicator',
    'InlineAlert',
    'StatusBadge',
    'Surface',
    'EmptyState',
    'LoadingSkeleton',
    'NimiText',
  ]) {
    assert.match(gallery, new RegExp(`\\b${required}\\b`));
  }
  // Components are consumed from the kit design authority, not re-implemented.
  assert.match(gallery, /from '@nimiplatform\/kit\/ui'/);
});

test('tester UI Recipes is an industrial three-pane kit component doc', () => {
  const gallery = read('src/tester/kit-component-gallery.tsx');
  // Ontology taxonomy: seven canonical categories.
  for (const category of ['Foundations', 'Actions', 'Inputs', 'Selection', 'Overlays', 'Layouts', 'Data & Status']) {
    assert.match(gallery, new RegExp(category));
  }
  // Foundations show real color tokens + NimiText roles.
  assert.match(gallery, /Semantic color tokens/);
  assert.match(gallery, /--nimi-action-primary-bg/);
  assert.match(gallery, /NimiText roles/);
  // Glass material tiers are demonstrated.
  for (const tier of ['glass-thin', 'glass-regular', 'glass-thick', 'glass-chrome']) {
    assert.match(gallery, new RegExp(tier));
  }
  // Three-pane structure: taxonomy library + live canvas + recipe inspector.
  assert.match(gallery, /kit-doc__library/);
  assert.match(gallery, /kit-doc__inspector/);
  assert.match(gallery, /Selected recipe/);
  assert.match(gallery, /Props snapshot/);
  assert.match(gallery, /Coverage map/);
  // It is pure component documentation — no runtime work.
  assert.match(gallery, /component documentation/);
  // The scenario-first composer was replaced by a component-first doc.
  assert.doesNotMatch(gallery, /Surface Scenario Rail|surfaceScenarios|Recipe Composer/);
});

test('tester run history is the per-capability evidence surface (no standalone Evidence module)', () => {
  const capabilities = read('src/tester/workbench/section-ai-testing.tsx');
  const historyStore = read('src/tester/tester-history.ts');
  const workbench = read('src/tester/tester-workbench.tsx');

  // Evidence is folded into each capability's test panel as recent local runs,
  // rendered from the app-owned history store — not a separate Evidence route.
  assert.match(capabilities, /function CapabilityRunHistory/);
  assert.match(capabilities, /Recent runs/);
  assert.match(capabilities, /getTesterRunStatusLabel/);
  assert.match(capabilities, /No local run records for/);
  for (const helper of ['getTesterRunStatusLabel', 'getTesterRunStatusTone', 'formatTesterRunTimestamp', 'flattenTesterRunHistory']) {
    assert.match(historyStore, new RegExp(helper));
  }

  // Single-level capability workspace: no app-lab / evidence / settings routes.
  assert.match(workbench, /WorkbenchView/);
  assert.doesNotMatch(workbench, /SectionEvidence|SectionSettings|SectionAppLab/);
});

test('tester artifact history persistence is real and fail-closed', () => {
  const imageHistory = read('src/tester/tester-image-history.ts');
  const workbench = read('src/tester/tester-workbench.tsx');
  const capabilities = read('src/tester/workbench/section-ai-testing.tsx');

  assert.match(imageHistory, /runId\?: string/);
  assert.match(imageHistory, /kind\?: 'runtime-media'/);
  assert.match(imageHistory, /artifactCount\?: number/);
  assert.match(imageHistory, /traceState\?: 'captured' \| 'not-captured'/);
  assert.match(imageHistory, /records\.slice\(0, 80\)/);
  assert.match(workbench, /shouldPersistTesterArtifactRecord\(result\)/);
  assert.match(workbench, /appendTesterImageHistoryRecord/);
  assert.doesNotMatch(imageHistory, /kind: record\.kind \|\| 'runtime-media'/);

  // Real runtime artifacts are previewed from their typed url/mimeType only —
  // no fabricated placeholder media.
  assert.match(capabilities, /function ArtifactPreview/);
  assert.match(capabilities, /mimeType\.startsWith\('image\/'\)/);
  assert.doesNotMatch(capabilities, /fake thumbnail/i);
});

test('tester chat.stream surfaces live deltas through the SDK stream (no fabricated text)', () => {
  const invokers = read('src/tester/tester-runtime-invokers.ts');
  const runtime = read('src/tester/tester-runtime.ts');
  const capabilities = read('src/tester/workbench/section-ai-testing.tsx');

  // The live-delta callback is threaded from the chat.stream SDK loop, through
  // runTesterCapability, into the capability panel — only accumulated SDK deltas
  // are surfaced (no app-fabricated streaming text).
  assert.match(invokers, /onPartial\?: \(accumulatedText: string\) => void/);
  assert.match(invokers, /aggregated \+= part\.text;\s*\n\s*input\.onPartial\?\.\(aggregated\)/);
  assert.match(runtime, /onPartial: input\.onPartial/);
  assert.match(capabilities, /onPartial: isStreaming \? setStreamingText : undefined/);
  assert.match(capabilities, /capability\.id === 'chat\.stream'/);
  assert.match(capabilities, /streamingText=\{streamingText\}/);
});

test('tester multimodal image input shapes the admitted SDK input (no app transport)', () => {
  const multimodal = read('src/tester/tester-multimodal-input.tsx');
  const invokers = read('src/tester/tester-runtime-invokers.ts');
  const capabilities = read('src/tester/workbench/section-ai-testing.tsx');

  // Attachments are read locally and shaped into the admitted SDK input
  // (string | TextMessage[] with image_url/video_url parts) — no app-local
  // upload/transport or fabricated content.
  assert.match(multimodal, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(multimodal, /type: 'image_url' as const, imageUrl/);
  assert.match(multimodal, /export function buildMultimodalInput/);
  // text.generate prepends the optional app-composed tone/length directive to the
  // prompt before shaping it into the admitted SDK input — still no app transport.
  assert.match(invokers, /const directedPrompt = input\.directive \? `\$\{input\.directive\}/);
  assert.match(invokers, /input: buildMultimodalInput\(directedPrompt, input\.attachments \?\? \[\]\)/);
  assert.match(invokers, /buildMultimodalInput\(prompt, input\.attachments\)/);
  assert.match(capabilities, /attachments: supportsMedia \? media\.attachments : undefined/);
  assert.match(capabilities, /<ImageAttachmentStrip/);
});

test('tester run history labels local fixtures distinctly from runtime results', () => {
  const history = read('src/tester/tester-history.ts');
  assert.match(history, /if \(status === 'ready'\) return 'runtime ready'/);
  assert.match(history, /if \(status === 'unavailable'\) return 'sdk unavailable'/);
  assert.match(history, /return 'local fixture'/);
  assert.match(history, /status === 'local-fixture'\) return 'info'/);
});

test('tester AI config is the Kit model-config surface in Settings with real SDK AIProfiles', () => {
  const store = read('src/tester/tester-ai-config-store.ts');
  const surface = read('src/shell/ai/tester-ai-config-settings.tsx');
  const panel = read('src/tester/workbench/tester-ai-config-settings-panel.tsx');
  const capabilities = read('src/tester/workbench/section-ai-testing.tsx');

  for (const required of [
    'AIProfile',
    'AIConfig',
    'createAppAIScopeRef',
    'createEmptyAIConfig',
    'validateAIProfile',
    'applyAIProfileToConfig',
    'computeAIConfigDiff',
    'computeAIConfigVersion',
    'importTesterAIProfileJson',
    'TESTER_AI_PROFILE_LIBRARY_STORAGE_KEY',
    'previewApply',
    'apply(scopeRef',
    'saveTesterAIConfig',
  ]) {
    assert.match(store, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  // The kit model-config mechanics live in the scaffold-managed sectioned config
  // surface skeleton (inherited by every generated app). It composes admitted kit
  // primitives and accepts an initialSection so a capability gear can deep-link.
  for (const required of [
    'ModelConfigCapabilityDetail',
    'ProfileConfigSection',
    'useModelConfigProfileController',
    'defaultModelConfigProfileCopy',
    'Import AIProfile JSON',
    'fail closed',
    'initialSection',
  ]) {
    assert.match(surface, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  // The tester wrapper injects app-scoped wiring into that surface.
  for (const required of [
    'TesterAiConfigSettings',
    'createTesterRuntimeModelPickerProvider',
    'importTesterAIProfileJson',
    "runtime?.status === 'ready'",
  ]) {
    assert.match(panel, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  // The AI config lives in Settings; the AI Capabilities settings gear deep-links
  // into the configured capability's section. App Lab no longer owns a bespoke
  // AIConfig lives in a right slide-over opened by the per-capability settings
  // gear (full adoption of the canonical kit model-config surface). App Lab's
  // bespoke AIConfig panel was removed entirely.
  assert.match(capabilities, /TesterAiConfigSettingsPanel/);
  assert.match(capabilities, /CAPABILITY_TO_SECTION/);
  assert.match(capabilities, /onOpenConfig/);
});

test('tester LLM invokers consume AIConfig bindings and fail closed without binding', () => {
  const invokers = read('src/tester/tester-runtime-invokers.ts');
  const unavailable = read('src/tester/tester-unavailable.ts');
  const llmInvokers = invokers.slice(
    invokers.indexOf('async function invokeTextGenerate'),
    invokers.indexOf('function summariseArtifact'),
  );

  assert.doesNotMatch(llmInvokers, /model:\s*['"]auto['"]/);
  assert.match(unavailable, /ai-config-binding-missing/);
  assert.match(invokers, /resolveTesterLLMBinding/);
  assert.match(invokers, /text\.generate' \|\| capabilityId === 'chat\.stream'/);
  assert.match(invokers, /capabilityId === 'text\.embed'/);
  assert.match(invokers, /Runtime invocation failed closed before request dispatch/);
  assert.match(invokers, /routeInput/);
  assert.match(invokers, /binding\.source === 'local' && connectorId/);
  assert.match(invokers, /binding\.source === 'cloud' && !connectorId/);
  assert.match(invokers, /connectorId,\s*\n\s*route: 'cloud'/);
  assert.match(invokers, /route: 'local'/);
  assert.match(invokers, /aiConfigScopeKind/);
  assert.match(invokers, /aiConfigProfileId/);
  assert.match(invokers, /aiConfigBindingCapabilityId/);
  assert.match(invokers, /aiConfigBindingModel/);
  assert.match(invokers, /aiConfigHash/);
});

test('tester LLM binding resolver fails closed for missing and malformed bindings', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();

  const missing = invokers.resolveTesterLLMBinding('text.generate', {
    scopeRef,
    capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
    profileOrigin: null,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'ai-config-binding-missing');

  const malformedProfile = store.importTesterAIProfileJson(JSON.stringify({
    profileId: 'malformed',
    title: 'Malformed',
    description: '',
    tags: [],
    capabilities: {
      'text.generate': {
        binding: {
          source: 'remote',
          connectorId: 42,
          model: '',
        },
      },
    },
  }));
  assert.equal(malformedProfile.ok, false);
  assert.match(malformedProfile.message, /binding validation failed/i);

  const localConnectorProfile = store.importTesterAIProfileJson(JSON.stringify({
    profileId: 'local-connector-facade',
    title: 'Local Connector Facade',
    description: '',
    tags: [],
    capabilities: {
      'text.generate': {
        binding: {
          source: 'local',
          connectorId: 'runtime-local-facade',
          model: 'local.chat.gemma-4-e2b-it.q8-0',
        },
      },
    },
  }));
  assert.equal(localConnectorProfile.ok, false);
  assert.match(localConnectorProfile.errors.join('\n'), /connectorId.*local/i);

  assert.throws(() => store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      selectedBindings: {
        'text.generate': {
          source: 'remote',
          connectorId: '',
          model: 'bad',
        },
      },
      localProfileRefs: {},
      selectedParams: {},
    },
    profileOrigin: null,
  }), /AIConfig binding validation failed/);

  assert.throws(() => store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      selectedBindings: {
        'text.generate': {
          source: 'local',
          connectorId: 'runtime-local-facade',
          model: 'local.chat.gemma-4-e2b-it.q8-0',
        },
      },
      localProfileRefs: {},
      selectedParams: {},
    },
    profileOrigin: null,
  }), /connectorId.*local/i);

  const previousWindow = globalThis.window;
  const invalidStoredConfig = {
    scopeRef,
    capabilities: {
      selectedBindings: {
        'text.generate': {
          source: 'local',
          connectorId: 'runtime-local-facade',
          model: 'local.chat.gemma-4-e2b-it.q8-0',
        },
      },
      localProfileRefs: {},
      selectedParams: {},
    },
    profileOrigin: null,
  };
  try {
    globalThis.window = {
      localStorage: createMemoryStorage({
        [store.TESTER_AI_CONFIG_STORAGE_KEY]: JSON.stringify(invalidStoredConfig),
      }),
    };
    assert.throws(() => store.loadTesterAIConfig(scopeRef), /Stored AIConfig binding is invalid: .*connectorId.*local/i);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('tester LLM invoker dispatches configured AIConfig route payload', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      selectedBindings: {
        'text.generate': {
          source: 'cloud',
          connectorId: 'runtime-connector',
          model: 'runtime-model',
          modelLabel: 'Runtime Model',
        },
        'text.embed': {
          source: 'local',
          connectorId: '',
          model: 'embedding-model',
        },
      },
      localProfileRefs: {},
      selectedParams: {},
    },
    profileOrigin: {
      profileId: 'behavior-profile',
      title: 'Behavior Profile',
      appliedAt: '2026-05-26T00:00:00.000Z',
    },
  });

  const captured = [];
  const client = {
    runtime: {
      ai: {
        text: {
          async generate(input) {
            captured.push({ surface: 'generate', input });
            return {
              text: 'ok',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              trace: { traceId: 'trace-1', modelResolved: input.model, routeDecision: input.route },
            };
          },
          async stream(input) {
            captured.push({ surface: 'stream', input });
            return {
              stream: (async function* stream() {
                yield { type: 'delta', text: 'o' };
                yield {
                  type: 'finish',
                  finishReason: 'stop',
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                  trace: { traceId: 'trace-2', modelResolved: input.model, routeDecision: input.route },
                };
              })(),
            };
          },
        },
        embedding: {
          async generate(input) {
            captured.push({ surface: 'embed', input });
            return {
              vectors: [[0.1, 0.2]],
              usage: { totalTokens: 1 },
              trace: { traceId: 'trace-3', modelResolved: input.model, routeDecision: input.route },
            };
          },
        },
      },
    },
  };

  const textResult = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'Hello runtime',
    scenarioId: 'behavior',
  });
  assert.equal(textResult.ok, true);

  const streamResult = await invokers.invokeTesterCapability(client, 'chat.stream', {
    prompt: 'Hello stream',
    scenarioId: 'behavior',
  });
  assert.equal(streamResult.ok, true);

  const embedResult = await invokers.invokeTesterCapability(client, 'text.embed', {
    prompt: 'Hello embed',
    scenarioId: 'behavior',
  });
  assert.equal(embedResult.ok, true);

  assert.deepEqual(captured.map((entry) => entry.surface), ['generate', 'stream', 'embed']);
  assert.equal(captured[0].input.model, 'runtime-model');
  assert.equal(captured[0].input.connectorId, 'runtime-connector');
  assert.equal(Object.hasOwn(captured[0].input, 'connectorId'), true);
  assert.equal(captured[0].input.route, 'cloud');
  assert.equal(captured[0].input.metadata.aiConfigProfileId, 'behavior-profile');
  assert.equal(captured[0].input.metadata.aiConfigBindingCapabilityId, 'text.generate');
  assert.equal(captured[1].input.model, 'runtime-model');
  assert.equal(captured[1].input.connectorId, 'runtime-connector');
  assert.equal(Object.hasOwn(captured[1].input, 'connectorId'), true);
  assert.equal(captured[1].input.route, 'cloud');
  assert.equal(captured[2].input.model, 'embedding-model');
  assert.equal(captured[2].input.connectorId, undefined);
  assert.equal(Object.hasOwn(captured[2].input, 'connectorId'), false);
  assert.equal(captured[2].input.route, 'local');
  assert.equal(captured[2].input.metadata.aiConfigBindingCapabilityId, 'text.embed');
});

test('tester local text.generate binding omits runtime connectorId payload', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  const runtimeLocalModelId = 'local.chat.gemma-4-e2b-it.q8-0';
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      selectedBindings: {
        'text.generate': {
          source: 'local',
          connectorId: '',
          model: runtimeLocalModelId,
          modelId: runtimeLocalModelId,
          localModelId: runtimeLocalModelId,
          engine: 'runtime-local-llm',
        },
      },
      localProfileRefs: {},
      selectedParams: {},
    },
    profileOrigin: null,
  });

  let capturedInput = null;
  const client = {
    runtime: {
      ai: {
        text: {
          async generate(input) {
            capturedInput = input;
            return {
              text: 'nimi runtime llm ok',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 4, totalTokens: 5 },
              trace: { traceId: 'trace-local', modelResolved: input.model, routeDecision: input.route },
            };
          },
          async stream() {
            throw new Error('stream should not be called');
          },
        },
        embedding: {
          async generate() {
            throw new Error('embedding should not be called');
          },
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'Reply with exactly: nimi runtime llm ok',
    scenarioId: 'local-behavior',
  });
  assert.equal(result.ok, true);
  assert.equal(capturedInput.model, runtimeLocalModelId);
  assert.equal(capturedInput.route, 'local');
  assert.equal(capturedInput.connectorId, undefined);
  assert.equal(Object.hasOwn(capturedInput, 'connectorId'), false);
});

test('tester model picker consumes SDK route projection for runtime local assets and remote connectors', async () => {
  const providerModule = await importBehaviorModule('tester/tester-runtime-model-provider.js');
  const calls = [];
  const remoteConnectorId = 'runtime-cloud-managed';
  const runtimeLocalModelId = 'local.chat.gemma-4-e2b-it.q8-0';
  const provider = providerModule.createTesterRuntimeModelPickerProviderFromClient({
    runtime: {
      local: {
        async listLocalAssets(input) {
          calls.push({ surface: 'listLocalAssets', input });
          return {
            assets: [
              {
                localAssetId: runtimeLocalModelId,
                assetId: runtimeLocalModelId,
                kind: 1,
                engine: 'llama',
                endpoint: 'http://127.0.0.1:11434/v1',
                status: 2,
                capabilities: ['text.generate'],
              },
            ],
            nextPageToken: '',
          };
        },
      },
    },
    domains: {
      runtimeAdmin: {
        async listConnectors(input) {
          calls.push({ surface: 'listConnectors', input });
          return {
            connectors: [
              {
                connectorId: remoteConnectorId,
                provider: 'cloud-provider',
                label: 'Cloud Provider',
                kind: 2,
                localCategory: 0,
                status: 1,
              },
            ],
            nextPageToken: '',
          };
        },
        async listConnectorModels(input) {
          calls.push({ surface: 'listConnectorModels', input });
          return {
            models: [
              {
                modelId: 'remote.chat.model',
                modelLabel: 'Remote Chat Model',
                available: true,
                capabilities: ['text.generate'],
              },
            ],
            nextPageToken: '',
          };
        },
      },
    },
  }, 'text.generate');

  const connectors = await provider.listConnectors();
  assert.deepEqual(connectors.map((connector) => connector.connectorId), [remoteConnectorId]);

  const localModels = await provider.listLocalModels();
  assert.deepEqual(localModels, [
    {
      localModelId: runtimeLocalModelId,
      modelId: runtimeLocalModelId,
      label: runtimeLocalModelId,
      engine: 'llama',
      status: 'active',
      capabilities: ['text.generate'],
    },
  ]);
  assert.equal(localModels[0].localModelId, runtimeLocalModelId);
  assert.equal(localModels[0].modelId, runtimeLocalModelId);
  assert.equal(calls.some((call) => call.surface === 'listLocalAssets'), true);
  assert.equal(calls.some((call) => call.surface === 'listConnectorModels' && call.input.connectorId === remoteConnectorId), true);
});

test('tester model picker catalog uses runtimeAdmin connector surfaces only', () => {
  const provider = read('src/tester/tester-runtime-model-provider.ts');
  const summary = read('src/tester/tester-ai-config.ts');

  assert.match(provider, /listRuntimeRouteOptions/);
  assert.match(provider, /getRuntimePlatformProjection/);
  assert.match(provider, /model catalog failed closed/);
  assert.match(provider, /createSnapshotRouteDataProvider/);
  assert.doesNotMatch(provider, /openai|anthropic|gemini|gpt-4|claude|mock.*success/i);
  assert.match(summary, /runtimeAdmin\.listConnectors\/listConnectorModels/);
});

test('tester app-owned Tauri commands are registered in standalone shell', () => {
  const main = read('src-tauri/src/main.rs');
  assert.match(main, /tester_run_history_load/);
  assert.match(main, /tester_image_history_save/);
  assert.match(main, /open_world_tour_window/);
  assert.match(main, /claim_world_tour_viewer_launch/);
});

test('tester scaffold boundary expands beyond the product route', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /src\/shell\/routes\/product-area\.tsx/);
  assert.match(agents, /src\/tester\/\*\*/);
  assert.match(agents, /src-tauri\/src\/\{tester_storage\.rs,world_tour\.rs\}/);
  assert.match(agents, /tester contract tests/);
});
