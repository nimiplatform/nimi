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
  const appStorage = read('src/tester/tester-app-storage.ts');
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
  assert.match(appStorage, /resolveRuntimeAppStorageRoots/);
  assert.doesNotMatch(appStorage, /\.nimi|nimi\.json|runtime\/config|join\(/);

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
  assert.match(history, /parseOptionalJsonObject/);
  assert.match(history, /from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
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
    'parseAIProfile',
    'applyAIProfileToConfig',
    'computeAIConfigDiff',
    'computeAIConfigVersion',
    'importTesterAIProfileJson',
    'TESTER_AI_PROFILE_LIBRARY_STORAGE_KEY',
    'previewApply',
    'apply(scopeRef',
    'saveTesterAIConfig',
    '@nimiplatform/kit/features/model-config/headless',
  ]) {
    assert.match(store, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(store, /validateAIProfile,\n/);

  // The kit model-config mechanics live in the scaffold-managed sectioned config
  // surface skeleton (inherited by every generated app). It composes admitted kit
  // primitives and accepts an initialSection so a capability gear can deep-link.
  for (const required of [
    'ModelConfigCapabilityDetail',
    'ProfileConfigSection',
    'useModelConfigProfileController',
    'defaultModelConfigProfileCopy',
    'applyAIProfileToConfig',
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
  assert.match(invokers, /resolveAIConfigSchedulingTargetForCapability/);
  assert.match(invokers, /peekSchedulingBatch/);
  assert.match(invokers, /client\.runtime\.ai\.peekScheduling/);
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
      localProfileRefs: {
        'text.embed': {
          targetId: 'core:runtime',
          profileId: 'embedding-local-profile',
        },
      },
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
        async peekScheduling(input) {
          captured.push({ surface: 'peekScheduling', input });
          return {
            occupancy: { globalUsed: 0, globalCap: 2, appUsed: 0, appCap: 1 },
            aggregateJudgement: {
              state: 1,
              detail: '',
              occupancy: { globalUsed: 0, globalCap: 2, appUsed: 0, appCap: 1 },
              resourceWarnings: [],
            },
            targetJudgements: [],
          };
        },
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

  assert.deepEqual(captured.map((entry) => entry.surface), ['generate', 'stream', 'peekScheduling', 'embed']);
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
  assert.deepEqual(captured[2].input.targets, [{
    capability: 'text.embed',
    targetId: 'core:runtime',
    profileId: 'embedding-local-profile',
  }]);
  assert.equal(captured[3].input.model, 'embedding-model');
  assert.equal(captured[3].input.connectorId, undefined);
  assert.equal(Object.hasOwn(captured[3].input, 'connectorId'), false);
  assert.equal(captured[3].input.route, 'local');
  assert.equal(captured[3].input.metadata.aiConfigBindingCapabilityId, 'text.embed');
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
      localProfileRefs: {
        'text.generate': {
          targetId: 'core:runtime',
          profileId: 'text-local-profile',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });

  let capturedInput = null;
  let capturedSchedulingInput = null;
  const client = {
    runtime: {
      ai: {
        async peekScheduling(input) {
          capturedSchedulingInput = input;
          return {
            occupancy: { globalUsed: 0, globalCap: 2, appUsed: 0, appCap: 1 },
            aggregateJudgement: {
              state: 1,
              detail: '',
              occupancy: { globalUsed: 0, globalCap: 2, appUsed: 0, appCap: 1 },
              resourceWarnings: [],
            },
            targetJudgements: [],
          };
        },
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
  assert.deepEqual(capturedSchedulingInput.targets, [{
    capability: 'text.generate',
    targetId: 'core:runtime',
    profileId: 'text-local-profile',
  }]);
});

test('tester local LLM scheduling denial fails closed before Runtime execution', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      selectedBindings: {
        'text.generate': {
          source: 'local',
          connectorId: '',
          model: 'local.chat.blocked',
        },
      },
      localProfileRefs: {
        'text.generate': {
          targetId: 'core:runtime',
          profileId: 'blocked-profile',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });

  let generateCalled = false;
  const client = {
    runtime: {
      ai: {
        async peekScheduling() {
          return {
            occupancy: { globalUsed: 1, globalCap: 1, appUsed: 1, appCap: 1 },
            aggregateJudgement: {
              state: 5,
              detail: 'dependency missing',
              occupancy: { globalUsed: 1, globalCap: 1, appUsed: 1, appCap: 1 },
              resourceWarnings: ['dependency missing'],
            },
            targetJudgements: [],
          };
        },
        text: {
          async generate() {
            generateCalled = true;
            throw new Error('generate must not run after denied scheduling');
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
    prompt: 'blocked',
    scenarioId: 'blocked-scheduling',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.match(result.message, /Runtime scheduling denied text\.generate: dependency missing/);
  assert.equal(generateCalled, false);
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
  assert.match(provider, /normalizeRuntimeRouteCapabilityToken/);
  assert.match(provider, /getRuntimePlatformProjection/);
  assert.match(provider, /model catalog failed closed/);
  assert.match(provider, /Unsupported Runtime capability/);
  assert.match(provider, /createSnapshotRouteDataProvider/);
  assert.doesNotMatch(provider, /as RuntimeCanonicalCapability/);
  assert.doesNotMatch(provider, /openai|anthropic|gemini|gpt-4|claude|mock.*success/i);
  assert.match(summary, /runtimeAdmin\.listConnectors\/listConnectorModels/);
});

test('tester settings consumes the Kit commerce realm wallet projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /loadRealmCurrencyBalances/);
  assert.match(settings, /loadRealmGiftTransaction/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/commerce\/realm'/);
  assert.match(settings, /Realm wallet projection/);
  assert.match(settings, /Realm gift transaction projection/);
  assert.match(settings, /Spark \{walletProjection\.balances\.sparkBalance\}/);
  assert.match(settings, /Gem \{walletProjection\.balances\.gemBalance\}/);
  assert.match(settings, /refreshGiftTransactionProjection/);
  assert.match(settings, /testerGiftTransactionProjectionService/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.loadCurrencyBalances|dataSync\.loadGiftTransaction/);
});

test('tester settings consumes the SDK Realm notification unread projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /loadRealmNotificationUnreadCount/);
  assert.match(settings, /loadRealmNotifications/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /Realm notification projection/);
  assert.match(settings, /Realm notification list projection/);
  assert.match(settings, /Unread \$\{notificationProjection\.unread\.total\}/);
  assert.match(settings, /refreshNotificationListProjection/);
  assert.match(settings, /loadRealmNotifications\(getPlatformClient\(\)\.realm/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.loadNotificationUnreadCount|dataSync\.loadNotifications/);
});

test('tester settings consumes the SDK Realm account-data export helper', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /requestDataExport/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /Realm account-data export projection/);
  assert.match(settings, /requestAccountDataExportProjection/);
  assert.match(settings, /getPlatformClient\(\)\.realm/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.requestDataExport/);
  assert.doesNotMatch(settings, /requestAccountDeletion/);
});

test('tester settings consumes the SDK Realm account settings helper', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /loadRealmCreatorEligibility/);
  assert.match(settings, /type RealmCreatorEligibilityDto/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /SDK Realm account settings projection/);
  assert.match(settings, /refreshAccountSettingsProjection/);
  assert.match(settings, /loadRealmCreatorEligibility\(getPlatformClient\(\)\.realm\)/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.loadMyCreatorEligibility/);
});

test('tester settings consumes the Kit Realm human chat helper', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /listRealmChats/);
  assert.match(settings, /type RealmListChatsResultDto/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/realm'/);
  assert.match(settings, /Kit Realm human chat projection/);
  assert.match(settings, /refreshHumanChatProjection/);
  assert.match(settings, /const chats = await listRealmChats\(20\)/);
  assert.doesNotMatch(settings, /@runtime\/data-sync|dataSync\.loadChats/);
});

test('tester settings consumes the SDK Realm media URL projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /resolveRealmMediaUrl/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /Realm media URL projection/);
  assert.match(settings, /realmMediaUrlProjection/);
  assert.doesNotMatch(settings, /\$\{[^}]*realmBaseUrl[^}]*\}\$\{[^}]*mediaUrl[^}]*\}/);
  assert.doesNotMatch(settings, /new URL\([^)]*api\/resources/);
});

test('tester settings consumes the SDK Realm resource upload orchestration helper', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /uploadRealmResourceFileWithRealm/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /Realm resource upload projection/);
  assert.match(settings, /resourceUploadProjection\.summary\.resourceId/);
  assert.match(settings, /ResourcesService/);
  assert.match(settings, /fetchImpl: async \(\) => new Response/);
  assert.doesNotMatch(settings, /fetch\(uploadUrl/);
  assert.doesNotMatch(settings, /finalizeResource\(.*tester-resource-upload/);
});

test('tester settings consumes the SDK Realm endpoint projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /projectRealmBaseUrl/);
  assert.match(settings, /projectRealmRealtimeUrl/);
  assert.match(settings, /REALM_FEED_SCOPES/);
  assert.match(settings, /isRealmFeedScope/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /Realm endpoint projection/);
  assert.match(settings, /Realm realtime projection/);
  assert.match(settings, /Realm feed scope projection/);
  assert.match(settings, /realmEndpointProjection/);
  assert.match(settings, /realmRealtimeProjection/);
  assert.match(settings, /realmFeedScopeProjection/);
  assert.doesNotMatch(settings, /function normalizeRealmBaseUrl/);
  assert.doesNotMatch(settings, /new URL\([^)]*realmBaseUrl/);
});

test('tester settings consumes Kit Realm chat attachment primitives', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /createRealmChatResourceAttachmentPayload/);
  assert.match(settings, /resolveRealmChatMediaUrl/);
  assert.match(settings, /resolveRealmChatAttachmentPreviewText/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/realm'/);
  assert.match(settings, /Realm chat attachment projection/);
  assert.match(settings, /realmChatAttachmentProjection/);
  assert.doesNotMatch(settings, /function resolveCanonicalChatAttachmentRecords/);
  assert.doesNotMatch(settings, /\$\{[^}]*realmBaseUrl[^}]*\}\$\{[^}]*url[^}]*\}/);
});

test('tester settings consumes the Kit avatar voice cue projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /resolveAgentVoicePlaybackCue/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/avatar\/headless'/);
  assert.match(settings, /Kit avatar voice cue projection/);
  assert.match(settings, /avatarVoiceCueProjection\.visemeId/);
  assert.doesNotMatch(settings, /function resolveAgentVoicePlaybackSignalFeatures/);
  assert.doesNotMatch(settings, /zeroCrossingRate/);
});

test('tester settings consumes SDK Runtime recommendation enum projections', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /normalizeLocalRecommendationFeedCacheStateId/);
  assert.match(settings, /parseLocalRecommendationFeedSourceId/);
  assert.match(settings, /summarizeLocalRecommendationFeedCacheState/);
  assert.match(settings, /localRecommendationTierToRunGrade/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime recommendation projection/);
  assert.match(settings, /LOCAL_RECOMMENDATION_TIER_RUNNABLE/);
  assert.doesNotMatch(settings, /switch\s*\([^)]*LOCAL_RECOMMENDATION_FEED_SOURCE_MODEL_INDEX/);
});

test('tester settings consumes SDK Runtime recommendation feed parser projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /parseRuntimeLocalRecommendationFeedDescriptor/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime recommendation feed parser/);
  assert.doesNotMatch(settings, /function parseRecommendationFeedDescriptor/);
  assert.doesNotMatch(settings, /new Set\([^)]*LOCAL_RECOMMENDATION/);
});

test('tester settings consumes SDK Runtime connector inventory projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /createRuntimeConnectorInventoryClient/);
  assert.match(settings, /runtimeConnectorInventory\.listConnectors/);
  assert.match(settings, /Runtime connector projection/);
  assert.match(settings, /runtimeAdmin: \(\) => getPlatformClient\(\)\.domains\.runtimeAdmin/);
  assert.doesNotMatch(settings, /listProviderCatalog\(|listConnectorModels\(|ConnectorKind\.REMOTE_MANAGED/);
});

test('tester settings consumes SDK Runtime model catalog projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /createRuntimeModelCatalogClient/);
  assert.match(settings, /runtimeModelCatalogProjection\.listProviders/);
  assert.match(settings, /Runtime model catalog projection/);
  assert.match(settings, /ModelCatalogProviderSource\.CUSTOM/);
  assert.doesNotMatch(settings, /function normalizeRuntimeModelCatalogProvider/);
  assert.doesNotMatch(settings, /runtimeJsonToProtoStruct|runtimeProtoStructToJson/);
});

test('tester settings consumes SDK Runtime reason-code message projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /getRuntimeReasonCodeDefaultMessage/);
  assert.match(settings, /normalizeRuntimeReasonCode/);
  assert.match(settings, /extractRuntimeReasonCodeFromError/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /ReasonCode\.AI_PROVIDER_TIMEOUT/);
  assert.match(settings, /ReasonCode\.AI_CONNECTOR_CREDENTIAL_MISSING/);
  assert.match(settings, /Runtime reason projection/);
  assert.match(settings, /runtimeReasonProjection\.credentialMissing/);
  assert.match(settings, /runtimeReasonProjection\.numeric/);
  assert.match(settings, /runtimeReasonProjection\.extracted/);
  assert.doesNotMatch(settings, /AI provider request timed out\./);
  assert.doesNotMatch(settings, /AI connector credentials are missing\./);
});

test('tester settings consumes SDK Runtime LocalAgent identity projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /projectRuntimeLocalAgentIdentity/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime LocalAgent identity projection/);
  assert.match(settings, /runtimeLocalAgentIdentityProjection\.localAgentRef/);
  assert.doesNotMatch(settings, /`local-agent:\$\{/);
});

test('tester settings consumes SDK offline reason-code projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /classifyOfflineError/);
  assert.match(settings, /classifyOfflineReasonCode/);
  assert.match(settings, /from '@nimiplatform\/sdk\/types'/);
  assert.match(settings, /ReasonCode\.REALM_UNAVAILABLE/);
  assert.match(settings, /ReasonCode\.RUNTIME_UNAVAILABLE/);
  assert.match(settings, /Offline reason projection/);
  assert.match(settings, /offlineReasonProjection\.errorOwner/);
  assert.doesNotMatch(settings, /new Set\(\[/);
  assert.doesNotMatch(settings, /REALM_OFFLINE_REASON_CODES|RUNTIME_OFFLINE_REASON_CODES/);
});

test('tester settings consumes SDK Runtime dependency state projections', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /isLocalRuntimeEnvironmentDependencyStartableState/);
  assert.match(settings, /isLocalRuntimeEnvironmentDependencyJobActiveState/);
  assert.match(settings, /isLocalRuntimeEnvironmentDependencyJobRetryableState/);
  assert.match(settings, /isLocalRuntimeEnvironmentDependencyJobTransferringState/);
  assert.match(settings, /isLocalRuntimeEnvironmentDependencyRepairRequiredState/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime dependency state projection/);
  assert.doesNotMatch(settings, /ACTIVE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.doesNotMatch(settings, /STARTABLE_RUNTIME_DEPENDENCY_STATES/);
  assert.doesNotMatch(settings, /JOB_TRANSFERRING_STATES/);
});

test('tester settings consumes SDK Runtime dependency parser projections', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /parseLocalRuntimeEnvironmentPlanProjection/);
  assert.match(settings, /parseLocalRuntimeEnvironmentDependencyJobProjection/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime dependency parser projection/);
});

test('tester settings consumes SDK local runtime asset id projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /toCanonicalLocalRuntimeAssetId/);
  assert.match(settings, /toCanonicalLocalRuntimeAssetLookupKey/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Local runtime asset id projection/);
  assert.match(settings, /localRuntimeAssetIdProjection\.lookupKey/);
  assert.doesNotMatch(settings, /@runtime\/local-runtime\/local-id/);
});

test('tester settings consumes SDK memory embedding route availability projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /projectMemoryEmbeddingRouteAvailability/);
  assert.match(settings, /createEmptyMemoryEmbeddingConfig/);
  assert.match(settings, /from '@nimiplatform\/sdk\/ai'/);
  assert.match(settings, /Memory embedding route projection/);
  assert.doesNotMatch(settings, /connector\?\.available/);
  assert.doesNotMatch(settings, /String\(model\.status \|\| ''\)\.toLowerCase\(\) === 'active'/);
});

test('tester settings consumes SDK Runtime capability coverage projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /projectRuntimeRouteCapabilityCoverage/);
  assert.match(settings, /from '@nimiplatform\/sdk\/ai'/);
  assert.match(settings, /Runtime capability coverage projection/);
  assert.match(settings, /runtimeCapabilityCoverageProjection/);
  assert.doesNotMatch(settings, /connectors\.some\(\(c\) => c\.status === 'healthy'\)/);
});

test('tester settings consumes SDK Runtime route capability projection builder', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /buildRuntimeRouteCapabilityProjection/);
  assert.match(settings, /createDefaultRuntimeRouteCapabilitySelectionStore/);
  assert.match(settings, /findRuntimeRouteModelProfile/);
  assert.match(settings, /getRuntimeRouteCapabilityProjectionIssueKind/);
  assert.match(settings, /isRuntimeRouteCapabilityProjectionReady/);
  assert.match(settings, /updateRuntimeRouteCapabilityBinding/);
  assert.match(settings, /from '@nimiplatform\/sdk\/ai'/);
  assert.match(settings, /resolveConversationRuntimeRouteSetupStateFromProjection/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/headless'/);
  assert.match(settings, /Runtime route capability projection/);
  assert.match(settings, /Runtime route model profile projection/);
  assert.match(settings, /runtimeCapabilityProjection\.summary\.reasonCode/);
  assert.match(settings, /runtimeCapabilityProjection\.summary\.issueKind/);
  assert.match(settings, /runtimeCapabilityProjection\.summary\.setupStatus/);
  assert.doesNotMatch(settings, /function buildRuntimeRouteCapabilityProjection/);
});

test('tester settings consumes SDK Runtime health coordinator diagnostics', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /RuntimeHealthCoordinator/);
  assert.match(settings, /CallerKind/);
  assert.match(settings, /RuntimeHealthStatus/);
  assert.match(settings, /UsageWindow/);
  assert.match(settings, /bridgeLocalRuntimeProfile/);
  assert.match(settings, /normalizeLocalRuntimeProfilesDeclaration/);
  assert.match(settings, /parseLocalRuntimeExecutionPlan/);
  assert.match(settings, /parseLocalRuntimeServiceDescriptor/);
  assert.match(settings, /parseLocalRuntimeNodeDescriptor/);
  assert.match(settings, /projectRuntimeAuditCallerKindName/);
  assert.match(settings, /projectRuntimeHealthStatusName/);
  assert.match(settings, /projectRuntimeHealthSummary/);
  assert.match(settings, /projectRuntimeUsageWindowName/);
  assert.match(settings, /toIsoFromTimestamp/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /SDK runtime health summary projection/);
  assert.match(settings, /SDK runtime health wire projection/);
  assert.match(settings, /SDK local runtime profile projection/);
  assert.match(settings, /SDK local runtime execution plan projection/);
  assert.match(settings, /SDK local runtime service\/node projection/);
  assert.match(settings, /SDK runtime audit wire projection/);
  assert.match(settings, /runtimeHealthSummaryProjection\.health\.checkedAt/);
  assert.match(settings, /runtimeHealthWireProjection\.statusName/);
  assert.match(settings, /localRuntimeProfileProjection\.runtimeEntryCount/);
  assert.match(settings, /localRuntimeExecutionPlanProjection\.deviceProfile\.arch/);
  assert.match(settings, /localRuntimeServiceNodeProjection\.node\.adapter/);
  assert.match(settings, /runtimeAuditWireProjection\.callerKindName/);
  assert.match(settings, /SDK runtime health coordinator projection/);
  assert.match(settings, /runtimeHealthCoordinatorDiagnostics\.getSnapshot/);
  assert.doesNotMatch(settings, /class RuntimeHealthCoordinator/);
  assert.doesNotMatch(settings, /RuntimeHealthStatus enum: 0=UNSPECIFIED/);
  assert.doesNotMatch(settings, /HEALTH_WATCHDOG_INTERVAL_MS/);
});

test('tester settings consumes SDK Nimi App bridge projection parser', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /parseNimiAppBridgeProjection/);
  assert.match(settings, /parseAccountAppLibraryRecord/);
  assert.match(settings, /from '@nimiplatform\/sdk\/app'/);
  assert.match(settings, /SDK Nimi App bridge projection/);
  assert.match(settings, /SDK account app-library projection/);
  assert.match(settings, /appBridgeProjection\.installEvidence/);
  assert.match(settings, /accountAppLibraryProjection\.apps/);
  assert.doesNotMatch(settings, /apps-projection/);
  assert.doesNotMatch(settings, /ADMISSION_STATUSES|RELEASE_DESCRIPTOR_CLASSES|VERIFICATION_STATES/);
  assert.doesNotMatch(settings, /LIBRARY_STATES|DATA_POLICIES/);
});

test('tester settings consumes SDK Runtime agent consumer projections', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /buildRuntimeAgentSnapshotRecoveryEvents/);
  assert.match(settings, /summarizeRuntimeAgentProjectionEvent/);
  assert.match(settings, /summarizeRuntimeAgentTimeline/);
  assert.match(settings, /matchesRuntimeAgentProjectionScope/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime agent consumer projection/);
  assert.match(settings, /runtimeAgentConsumerProjection\.terminalEventName/);
  assert.doesNotMatch(settings, /function buildRuntimeAgentSnapshotRecoveryEvents/);
  assert.doesNotMatch(settings, /function summarizeRuntimeAgentTimeline/);
});

test('tester settings consumes SDK Runtime struct codec projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /toProtoStruct/);
  assert.match(settings, /fromProtoStruct/);
  assert.match(settings, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(settings, /Runtime struct codec projection/);
  assert.match(settings, /runtimeStructProjection\.auditKind/);
  assert.doesNotMatch(settings, /function jsonToProtoStruct/);
  assert.doesNotMatch(settings, /function decodeProtoDynamic/);
});

test('tester settings consumes SDK local route option binding projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /isRuntimeRouteLocalOptionSelectable/);
  assert.match(settings, /runtimeRouteLocalOptionToBinding/);
  assert.match(settings, /runtimeRouteBindingsMatch/);
  assert.match(settings, /from '@nimiplatform\/sdk\/ai'/);
  assert.match(settings, /Local route option projection/);
  assert.match(settings, /Runtime route binding match projection/);
  assert.doesNotMatch(settings, /source:\s*'local',\s*connectorId:\s*''/);
});

test('tester settings consumes SDK runtime route reasoning projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /resolveRuntimeTextRouteReasoningSupport/);
  assert.match(settings, /resolveRuntimeRouteReasoningConfig/);
  assert.match(settings, /from '@nimiplatform\/sdk\/ai'/);
  assert.match(settings, /Runtime route reasoning projection/);
  assert.match(settings, /runtimeRouteReasoningProjection\.traceMode/);
  assert.doesNotMatch(settings, /function resolveRuntimeTextRouteReasoningSupport/);
});

test('tester settings consumes Kit model picker binding projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /pickerSelectionToBinding/);
  assert.match(settings, /summarizeBinding/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/model-config\/headless'/);
  assert.match(settings, /Model picker binding projection/);
  assert.match(settings, /Kit model binding summary projection/);
  assert.doesNotMatch(settings, /toRuntimeRouteBindingFromPickerSelection/);
});

test('tester settings consumes Kit runtime avatar voice projection', () => {
  const settings = read('src/shell/routes/settings.tsx');

  assert.match(settings, /resolveRuntimeAgentVoicePlaybackDecision/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/avatar\/runtime'/);
  assert.match(settings, /Kit runtime avatar voice projection/);
  assert.match(settings, /runtimeAvatarVoiceProjection\.cueCount/);
  assert.doesNotMatch(settings, /function resolveRuntimeAgentVoicePlaybackDecision/);
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
