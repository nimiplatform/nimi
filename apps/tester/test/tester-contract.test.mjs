import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { buildWithTsc } from './tsc-build.mjs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  readTesterAiTestingSurface,
  readTesterKitComponentGallerySurface,
  readTesterRuntimeInvokersSurface,
} from './tester-surface-readers.mjs';

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
  buildWithTsc([
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
    'src/tester/tester-run-target.ts',
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
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    key(index) {
      return [...map.keys()][index] || null;
    },
    removeItem(key) {
      map.delete(String(key));
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
  };
}

const RUNTIME_SCENARIO_TYPE_TEXT_GENERATE = 1;
const RUNTIME_SCENARIO_TYPE_TEXT_EMBED = 2;
const RUNTIME_EXECUTION_MODE_SYNC = 1;
const RUNTIME_EXECUTION_MODE_STREAM = 2;
const RUNTIME_ROUTE_POLICY_LOCAL = 1;
const RUNTIME_ROUTE_POLICY_CLOUD = 2;
const RUNTIME_FINISH_REASON_STOP = 1;
const RUNTIME_SCHEDULING_RUNNABLE = 1;
const RUNTIME_SCHEDULING_DENIED = 5;

function runnableSchedulingResponse() {
  return {
    occupancy: { globalUsed: 0, globalCap: 2, appUsed: 0, appCap: 1 },
    aggregateJudgement: {
      state: RUNTIME_SCHEDULING_RUNNABLE,
      detail: '',
      occupancy: { globalUsed: 0, globalCap: 2, appUsed: 0, appCap: 1 },
      resourceWarnings: [],
    },
    targetJudgements: [],
  };
}

function textGenerateScenarioResponse(input, traceId = 'trace-1', text = 'ok') {
  return {
    output: {
      output: {
        oneofKind: 'textGenerate',
        textGenerate: { text },
      },
    },
    finishReason: RUNTIME_FINISH_REASON_STOP,
    usage: { inputTokens: '1', outputTokens: '1', computeMs: '0' },
    routeDecision: input.head.routePolicy,
    modelResolved: input.head.modelId,
    traceId,
    ignoredExtensions: [],
  };
}

function textEmbedScenarioResponse(input, traceId = 'trace-3') {
  return {
    output: {
      output: {
        oneofKind: 'textEmbed',
        textEmbed: {
          vectors: [{ values: [0.1, 0.2] }],
        },
      },
    },
    finishReason: RUNTIME_FINISH_REASON_STOP,
    usage: { inputTokens: '1', outputTokens: '0', computeMs: '0' },
    routeDecision: input.head.routePolicy,
    modelResolved: input.head.modelId,
    traceId,
    ignoredExtensions: [],
  };
}

async function* textScenarioStream(input, traceId = 'trace-2') {
  yield {
    eventType: 1,
    sequence: '1',
    traceId,
    payload: {
      oneofKind: 'started',
      started: {
        modelResolved: input.head.modelId,
        routeDecision: input.head.routePolicy,
      },
    },
  };
  yield {
    eventType: 2,
    sequence: '2',
    traceId,
    payload: {
      oneofKind: 'delta',
      delta: {
        delta: {
          oneofKind: 'text',
          text: { text: 'o' },
        },
      },
    },
  };
  yield {
    eventType: 5,
    sequence: '3',
    traceId,
    payload: {
      oneofKind: 'usage',
      usage: { inputTokens: '1', outputTokens: '1', computeMs: '0' },
    },
  };
  yield {
    eventType: 6,
    sequence: '4',
    traceId,
    payload: {
      oneofKind: 'completed',
      completed: {
        finishReason: RUNTIME_FINISH_REASON_STOP,
        usage: { inputTokens: '1', outputTokens: '1', computeMs: '0' },
        streamSimulated: false,
      },
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

test('tester auth and runtime bootstrap consume Kit shell bridge primitives', () => {
  const main = read('src/main.tsx');
  const runtimeAccountAuth = read('src/shell/auth/runtime-account-auth.ts');
  const runtimePlatform = read('src/shell/auth/runtime-platform.ts');

  assert.match(main, /installNimiShellRuntimeBridge/);
  assert.match(main, /from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
  assert.match(runtimePlatform, /createNimiRuntimeFullAppRegistration/);
  assert.match(runtimePlatform, /const runtimeDeveloperRegistrationRequested = true/);
  assert.match(runtimePlatform, /developerRegistration:\s*runtimeDeveloperRegistrationRequested/);
  assert.doesNotMatch(runtimePlatform, /import\.meta[^;\n]*env|env\.DEV|metadata:\s*[^,\n]*developerRegistration/);
  assert.match(runtimePlatform, /getRuntimeAccountCaller/);
  assert.doesNotMatch(runtimePlatform, /export const runtimeAccountCaller\s*=\s*createNimiLocalFirstPartyRuntimeAccountCaller/);
  assert.match(runtimePlatform, /const accountRuntime = new Runtime\(runtimeOptions\(\)\);\s*await accountRuntime\.ready\(\);\s*await registerDeveloperRegisteredRuntimeAccountCaller\(accountRuntime\);/s);
  assert.match(runtimePlatform, /createNimiRuntimeAppSessionMetadataProvider/);
  assert.match(runtimePlatform, /authMetadata:\s*createRuntimeAppSessionMetadataProvider\(accountRuntime,\s*accountCaller\)/);
  assert.doesNotMatch(runtimePlatform, /accountRuntime\.account\.getAccessToken|createRuntimeAccountAccessTokenCallOptions|runtime-account-access-token/);
  assert.match(runtimePlatform, /createRuntimeAccountRefreshCallOptions/);
  assert.match(runtimePlatform, /createScopedClientId\('runtime-account-refresh'\)/);
  assert.match(runtimePlatform, /const runtimeProtectedScopes = \['ai\.spend\.meter'\] as const/);
  assert.match(runtimePlatform, /capabilities:\s*\[\.\.\.runtimeProtectedScopes\]/);
  assert.match(runtimePlatform, /accountRuntime\.grants\.authorizeExternalPrincipal/);
  assert.match(runtimePlatform, /withNimiRuntimeIdempotencyMetadata/);
  assert.match(runtimePlatform, /createScopedClientId\(`runtime-protected-\$\{normalizedSubject\}`\)/);
  assert.match(runtimePlatform, /ExternalPrincipalType\.APP/);
  assert.match(runtimePlatform, /PolicyMode\.CUSTOM/);
  assert.match(runtimePlatform, /AuthorizationPreset\.UNSPECIFIED/);
  assert.match(runtimePlatform, /'x-nimi-access-token-id'/);
  assert.match(runtimePlatform, /'x-nimi-access-token-secret'/);
  assert.match(runtimePlatform, /\.\.\.appSessionMetadata,\s*\.\.\.protectedAccessMetadata/s);
  assert.doesNotMatch(runtimeAccountAuth, /getAccessToken|createRuntimeAccountAccessTokenCallOptions|refreshAccountSession|createRuntimeAccountRefreshCallOptions/);
  assert.match(runtimeAccountAuth, /createTauriOAuthBridge/);
  assert.match(runtimeAccountAuth, /createRuntimeAccountBrowserBroker/);
  assert.match(runtimePlatform, /createNimiDeveloperRegisteredRuntimeAccountCaller/);
  assert.match(runtimePlatform, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(runtimeAccountAuth, /from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
  assert.doesNotMatch(runtimeAccountAuth, /getPlatformClient\(/);
  assert.doesNotMatch(runtimeAccountAuth, /@renderer\/bridge|runtime-bridge/);
  assert.doesNotMatch(runtimeAccountAuth, /runtime\.account\.beginLogin\(/);
  assert.doesNotMatch(runtimeAccountAuth, /runtime\.account\.completeLogin\(/);
  assert.doesNotMatch(runtimeAccountAuth, /ACCOUNT_CALLER_MODE|deviceId:\s*['"`]local-first-party-device|mode:\s*1|appInstanceId:\s*`\$\{appId\}\.local-first-party`/);
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
          targetId: 'media',
          profileId: '01KTEX0CSNAR9Q0B8KXNCF4WPW',
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

test('Tester consumes SDK Runtime agent smoke verification surface as second app proof', () => {
  const helper = read('src/tester/tester-runtime-smoke-verification.ts');
  assert.match(helper, /createNimiRuntimeAgentSmokeVerificationSurface/);
  assert.match(helper, /NimiRuntimeAgentSmokeVerificationSurface/);
  assert.match(helper, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(helper, /getRuntimePlatformProjection/);
  assert.doesNotMatch(helper, /createRuntimeAgentSmokeVerificationSurface/);
  assert.doesNotMatch(helper, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(helper, /withScopes\(/);
});

test('tester runtime unavailable flow consumes Kit offline coordinator', () => {
  const authGate = read('src/shell/auth/auth-gate.tsx');
  const unavailablePage = read('src/shell/auth/runtime-unavailable-page.tsx');

  assert.match(authGate, /from '@nimiplatform\/kit\/core\/offline-coordinator'/);
  assert.match(authGate, /new OfflineCoordinator\(\)/);
  assert.match(authGate, /markRuntimeReachable\(false\)/);
  assert.match(authGate, /markRuntimeReachable\(true\)/);
  assert.match(unavailablePage, /Offline tier: \{offlineTier\}/);
});

test('tester runtime media invokers use AIConfig bindings instead of executable auto routing', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  assert.doesNotMatch(invokers, /model:\s*['"]auto['"]/);
  for (const capability of [
    'image.generate',
    'video.generate',
    'audio.synthesize',
    'audio.transcribe',
    'speech.bundle',
  ]) {
    assert.match(invokers, new RegExp(`resolveTesterLLMBinding\\('${capability}'\\)`));
  }
});

test('tester kit gallery showcases real kit components for third-party apps', () => {
  const gallery = readTesterKitComponentGallerySurface(root);
  for (const required of [
    'Button',
    'IconButton',
    'AppCardSurface',
    'CompactAction',
    'IconToggleAction',
    'FieldTrigger',
    'ScrollShell',
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

test('tester UI Recipes is an industrial two-pane kit component workbench', () => {
  const gallery = readTesterKitComponentGallerySurface(root);
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
  // Two-pane structure: taxonomy library + recipe cards. Live/code/props/a11y/tokens
  // are per-recipe controls, not one page-level switch that cuts the whole list.
  assert.match(gallery, /kit-doc__library/);
  assert.match(gallery, /kit-doc__main/);
  assert.match(gallery, /kit-doc__canvas/);
  assert.match(gallery, /kit-card__tabs/);
  assert.match(gallery, /RecipeModeContent/);
  assert.match(gallery, /Import and usage/);
  assert.match(gallery, /Props contract/);
  assert.doesNotMatch(gallery, /options=\{lanes\}|onChange=\{\.\.\.\}|value=\{n\}|\{rows\}|<Button \/>|title message confirmLabel/);
  assert.doesNotMatch(gallery, /kit-doc__modebar|kit-doc__modetabs|kit-doc__import|kit-doc__inspector|kit-doc__evidence|Selected recipe|Coverage map/);
  // It is pure component documentation — no runtime work.
  assert.match(gallery, /component documentation/);
  // The scenario-first composer was replaced by a component-first doc.
  assert.doesNotMatch(gallery, /Surface Scenario Rail|surfaceScenarios|Recipe Composer/);
});

test('tester run history is the per-capability evidence surface (no standalone Evidence module)', () => {
  const capabilities = readTesterAiTestingSurface(root);
  const historyStore = read('src/tester/tester-history.ts');
  const appStorage = read('src/tester/tester-app-storage.ts');
  const workbench = read('src/tester/tester-workbench.tsx');

  // Evidence is folded into each capability's test panel as recent local runs,
  // rendered from the app-owned history store — not a separate Evidence route.
  assert.match(capabilities, /function CapabilityRunHistory/);
  assert.match(capabilities, /Recent runs/);
  assert.match(capabilities, /getTesterRunStatusLabel/);
  assert.match(capabilities, /getTesterRunResultSummary/);
  assert.match(capabilities, /TextStudioHistorySnapshotBody/);
  assert.match(capabilities, /if \(records\.length === 0\) return null;/);
  assert.doesNotMatch(capabilities, /No local run records for/);
  assert.doesNotMatch(capabilities, /does not contain the full generated body/);
  for (const helper of ['createTesterRunHistoryResultSnapshot', 'getTesterRunResultSummary', 'getTesterRunResultTags', 'getTesterRunStatusLabel', 'getTesterRunStatusTone', 'formatTesterRunTimestamp', 'flattenTesterRunHistory']) {
    assert.match(historyStore, new RegExp(helper));
  }
  assert.match(appStorage, /resolveNimiRuntimeAppStorageRoots/);
  assert.match(appStorage, /attachNimiRuntimeAppDataStorageRoot/);
  assert.match(appStorage, /attachNimiRuntimeAppStorageRoots/);
  assert.doesNotMatch(appStorage, /resolveRuntimeAppStorageRoots/);
  assert.doesNotMatch(appStorage, /attachRuntimeAppDataStorageRoot/);
  assert.doesNotMatch(appStorage, /attachRuntimeAppStorageRoots/);
  assert.doesNotMatch(appStorage, /\.nimi|nimi\.json|runtime\/config|join\(/);

  // Single-level capability workspace: no app-lab / evidence / settings routes.
  assert.match(workbench, /WorkbenchView/);
  assert.doesNotMatch(workbench, /SectionEvidence|SectionSettings|SectionAppLab/);
});

test('tester run history timestamps use English date labels and omit today date labels', () => {
  const historyStore = read('src/tester/tester-history.ts');

  assert.match(historyStore, /new Intl\.DateTimeFormat\('en-US'/);
  assert.match(historyStore, /hourCycle:\s*'h23'/);
  assert.match(historyStore, /formatTesterRunTimestamp\(value: string, now = new Date\(\)\)/);
  assert.match(historyStore, /if \(isSameLocalCalendarDate\(date, now\)\) return testerRunTimeFormatter\.format\(date\);/);
  assert.match(historyStore, /formatTesterRunHistoryTimestamp\(value: string, now = new Date\(\)\)/);
  assert.match(historyStore, /return testerRunDateFormatter\.format\(date\);/);
  assert.match(historyStore, /return testerRunDateWithYearFormatter\.format\(date\);/);
  assert.doesNotMatch(historyStore, /toLocaleString\(\[\]/);
});

test('right-side capability history uses date-only labels for older runs', () => {
  const capabilities = readTesterAiTestingSurface(root);

  assert.match(capabilities, /formatTesterRunHistoryTimestamp/);
  assert.match(capabilities, /<time dateTime=\{record\.createdAt\}>\{formatTesterRunHistoryTimestamp\(record\.createdAt\)\}<\/time>/);
  assert.match(capabilities, /formatTesterRunHistoryTimestamp\(record\.createdAt\), metrics/);
});

test('tester run history rows prioritize prompt title, recency groups, and run metrics', () => {
  const capabilities = readTesterAiTestingSurface(root);
  const historyStore = read('src/tester/tester-history.ts');
  const styles = read('src/tester/tester-workbench.css');

  assert.match(historyStore, /function formatTesterTokenUsage/);
  assert.match(historyStore, /export function getTesterRunModelLabel/);
  assert.match(historyStore, /export function getTesterRunModelSource/);
  assert.match(historyStore, /cleanTesterRunModelName/);
  assert.match(historyStore, /\^\(local-import\|local\|cloud\)\\\//);
  assert.match(historyStore, /routeDecisionModelSource/);
  assert.match(historyStore, /export function getTesterRunMetricSummary/);
  assert.match(historyStore, /export type TesterRunConfigSnapshot/);
  assert.match(historyStore, /runConfig\?: TesterRunConfigSnapshot/);
  assert.match(historyStore, /record\.runConfig\?\.target\.modelLabel/);
  assert.match(historyStore, /record\.runConfig\?\.target\.source/);
  assert.match(historyStore, /\| 'params'/);
  assert.match(historyStore, /record\.runConfig\?\.target\.paramsSummary/);
  assert.match(historyStore, /toneSelected\?: boolean/);
  assert.match(historyStore, /lengthSelected\?: boolean/);
  assert.match(historyStore, /export function getTesterRunPromptControlFacts/);
  assert.match(historyStore, /export function getTesterRunConfigParamRows/);
  assert.match(historyStore, /Temperature/);
  assert.match(historyStore, /Max Tokens/);
  assert.match(historyStore, /Top P/);
  assert.match(historyStore, /Top K/);
  assert.match(historyStore, /Timeout/);
  assert.match(historyStore, /Stop Sequences/);
  assert.match(historyStore, /Advanced settings/);
  assert.match(historyStore, /JSON\.stringify\(value\)/);
  assert.doesNotMatch(historyStore, /effectiveTesterModelParamsForCapability/);
  assert.doesNotMatch(historyStore, /TEXT_MODEL_EFFECTIVE_DEFAULTS/);
  assert.doesNotMatch(historyStore, /export function getTesterRunConfigTargetFacts/);
  assert.doesNotMatch(historyStore, /export function getTesterRunConfigPromptFacts/);
  assert.doesNotMatch(historyStore, /pushFact\(facts, 'Context', 'Attached'\)/);
  assert.match(historyStore, /modelResolved/);
  assert.match(historyStore, /inputTokens/);
  assert.match(historyStore, /outputTokens/);
  assert.match(historyStore, /totalTokens/);
  assert.doesNotMatch(historyStore, /\bin \/.*\bout/);
  assert.doesNotMatch(historyStore, /\bout \/.*\btotal/);
  assert.match(capabilities, /historyLabelForRun/);
  assert.match(capabilities, /historyDetailForRun/);
  assert.match(capabilities, /historyGroupLabel/);
  assert.match(capabilities, /groupHistoryRecords/);
  assert.match(capabilities, /getTesterRunModelSource\(record\)/);
  assert.match(capabilities, /getTesterRunModelLabel\(record\)/);
  assert.match(capabilities, /label: 'Today' \| 'Yesterday' \| 'Earlier'/);
  assert.match(capabilities, /const hasHistory = historyRecords\.length > 0;/);
  assert.match(capabilities, /studio__workspace studio__workspace--with-history/);
  assert.match(capabilities, /if \(records\.length === 0\) return null;/);
  assert.doesNotMatch(capabilities, /<span>\{records\.length\}<\/span>/);
  assert.match(capabilities, /className="studio-history__groups"/);
  assert.match(capabilities, /className="studio-history__group"/);
  assert.match(capabilities, /<p>\{group\.label\}<\/p>/);
  assert.match(capabilities, /studio-recent__copy/);
  assert.match(capabilities, /studio-recent__title/);
  assert.match(capabilities, /studio-recent__detail/);
  assert.match(capabilities, /createRunConfigSnapshot/);
  assert.match(capabilities, /params:\s*\{\s*\.\.\.target\.params\s*\}/);
  assert.match(capabilities, /toneSelected: input\.toneSelected/);
  assert.match(capabilities, /lengthSelected: input\.lengthSelected/);
  assert.match(capabilities, /function TextStudioPromptSettings/);
  assert.match(capabilities, /function TextStudioModelSettings/);
  assert.match(capabilities, /function summarizeParamRows/);
  assert.match(capabilities, /Model settings/);
  assert.match(capabilities, /getTesterRunConfigParamRows\(runConfig\)/);
  assert.match(capabilities, /getTesterRunPromptControlFacts\(runConfig\)/);
  assert.match(capabilities, /record\.runConfig\?\.promptControls\.context/);
  assert.match(capabilities, /record\.runConfig\?\.promptControls\.toneSelected/);
  assert.match(capabilities, /record\.runConfig\?\.promptControls\.lengthSelected/);
  assert.match(capabilities, /setContext\(historyContext\)/);
  assert.doesNotMatch(capabilities, /function TextStudioRunSettings/);
  assert.doesNotMatch(capabilities, /Run settings/);
  assert.doesNotMatch(capabilities, /Model target|Target detail/);
  assert.match(capabilities, /aria-label=\{historyLabelForRun\(record\)\}/);
  assert.match(styles, /grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
  assert.match(styles, /--studio-center-width:\s*960px/);
  assert.match(styles, /--studio-history-width:\s*360px/);
  assert.match(styles, /\.studio__workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(
    styles,
    /\.studio__workspace--with-history\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*var\(--studio-history-width\)\)/s,
  );
  assert.match(styles, /\.studio__stage\s*\{[^}]*max-width:\s*var\(--studio-center-width\)[^}]*justify-self:\s*center/s);
  assert.match(styles, /border-left:\s*1px solid/);
  assert.match(styles, /\.studio-history__groups/);
  assert.match(styles, /\.studio-history__group/);
  assert.match(styles, /\.studio-history \.studio-recent__copy/);
  assert.match(styles, /\.studio-history \.studio-recent__title/);
  assert.match(styles, /\.studio-history \.studio-recent__detail/);
  assert.doesNotMatch(styles, /\.studio-history \.studio-recent__source--local/);
  assert.doesNotMatch(styles, /\.studio-history \.studio-recent__source--cloud/);
  assert.match(styles, /\.studio-prompt-settings/);
  assert.match(styles, /\.studio-prompt-settings__context/);
  assert.match(styles, /\.studio-history-settings/);
  assert.match(styles, /\.studio-history-settings__params/);
  assert.match(styles, /\.studio-history-settings__empty/);
  assert.doesNotMatch(styles, /\.studio-history-settings__context/);
  assert.match(styles, /\.studio-result\s*\{[^}]*border-radius:\s*14px/s);
});

test('tester capability runs consume Kit renderer telemetry', () => {
  const workbench = read('src/tester/tester-workbench.tsx');
  const testerAiConfig = read('src/tester/tester-ai-config.ts');
  const testerRuntime = read('src/tester/tester-runtime.ts');

  assert.match(workbench, /from '@nimiplatform\/kit\/telemetry'/);
  assert.match(workbench, /from '@nimiplatform\/sdk'/);
  assert.match(workbench, /from '@nimiplatform\/sdk\/types'/);
  assert.match(workbench, /loadTesterAIConfigSummary/);
  assert.match(testerAiConfig, /inspectRuntimeReadiness/);
  assert.match(testerRuntime, /from '\.\.\/shell\/auth\/runtime-platform\.js'/);
  assert.doesNotMatch(workbench, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(workbench, /createNimiClientId\('run'\)/);
  assert.match(workbench, /requestWithRetry/);
  assert.match(workbench, /executor:\s*loadTesterRunHistory/);
  assert.match(workbench, /createRendererFlowId\('tester-capability-run'\)/);
  assert.match(workbench, /logRendererEvent\(/);
  assert.match(workbench, /emitRuntimeLog/);
  assert.match(workbench, /action:tester-capability-run:recorded/);
  assert.match(workbench, /history-load-failed/);
  assert.doesNotMatch(workbench, /runtime-bridge\/logging|@renderer\/.*telemetry/);
  assert.doesNotMatch(workbench, /Math\.random\(\)/);
});

test('tester artifact history persistence is real and fail-closed', () => {
  const imageHistory = read('src/tester/tester-image-history.ts');
  const workbench = read('src/tester/tester-workbench.tsx');
  const capabilities = readTesterAiTestingSurface(root);
  const tauri = read('src/tester/tester-tauri.ts');

  assert.match(imageHistory, /runId\?: string/);
  assert.match(imageHistory, /kind\?: 'runtime-media'/);
  assert.match(tauri, /@nimiplatform\/kit\/shell\/renderer\/bridge/);
  assert.match(tauri, /toShellBridgeNimiError/);
  assert.doesNotMatch(tauri, /@tauri-apps\/api\/core/);
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

test('tester chat.stream consumes Kit chat runtime provider (no fabricated text)', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  const runtime = read('src/tester/tester-runtime.ts');
  const capabilities = readTesterAiTestingSurface(root);

  // The live-delta callback is threaded from the Kit simple-ai provider, through
  // runTesterCapability, into the capability panel. Tester is the second app
  // consumer of the reusable Kit chat runtime primitive; SDK remains the
  // provider's lower-level stream assembly surface.
  assert.match(invokers, /onPartial\?: \(accumulatedText: string\) => void/);
  assert.match(invokers, /from '@nimiplatform\/kit\/features\/chat\/runtime'/);
  assert.match(invokers, /createSimpleAiConversationProvider/);
  assert.match(invokers, /createSdkConversationRuntimeAdapter/);
  assert.match(invokers, /resolveRuntimeUserMessage: \(\) => buildChatRuntimeUserMessage\(prompt\)/);
  assert.match(invokers, /for await \(const event of provider\.runTurn/);
  assert.match(invokers, /event\.type === 'text-delta'/);
  assert.match(invokers, /streamedText \+= event\.textDelta/);
  assert.match(invokers, /input\.onPartial\?\.\(streamedText\)/);
  assert.doesNotMatch(invokers, /streamAppAiTextResponse/);
  assert.doesNotMatch(invokers, /runAppAiTextTurn/);
  assert.match(runtime, /onPartial: input\.onPartial/);
  assert.match(capabilities, /onPartial: isStreaming \? setStreamingText : undefined/);
  assert.match(capabilities, /capability\.id === 'chat\.stream'/);
  assert.match(capabilities, /streamingText=\{streamingText\}/);
});

test('tester text.generate consumes SDK vNext text runner and Runtime Scenario model', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  assert.match(invokers, /runNimiTextGenerate/);
  assert.match(invokers, /createNimiRuntimeAIModel/);
  assert.match(invokers, /createNimiRuntimeEmbeddingClient/);
  assert.match(invokers, /NimiRuntimeAIScenarioClient/);
  assert.match(invokers, /runtime: client\.runtime/);
  assert.doesNotMatch(invokers, /@nimiplatform\/sdk\/ai-app/);
  assert.doesNotMatch(invokers, /runtime\.ai\.text\.generate/);
});

test('tester multimodal attachment input is app-local vNext message evidence and text runtime fails closed', () => {
  const multimodal = read('src/tester/tester-multimodal-input.tsx');
  const invokers = readTesterRuntimeInvokersSurface(root);
  const capabilities = readTesterAiTestingSurface(root);

  // Attachments are read locally and shaped into vNext Nimi message data parts;
  // Runtime text Scenario does not yet accept multimodal parts, so execution
  // fails closed before dispatch instead of fabricating transport support.
  assert.match(multimodal, /from '@nimiplatform\/sdk\/contracts'/);
  assert.match(multimodal, /createTesterAttachmentId/);
  assert.match(multimodal, /dataPart/);
  assert.match(multimodal, /export function buildMultimodalInput/);
  assert.doesNotMatch(multimodal, /Math\.random\(\)/);
  assert.match(invokers, /unsupportedTextAttachments/);
  assert.match(invokers, /Runtime text Scenario currently accepts text-only input/);
  assert.match(invokers, /const directedPrompt = input\.directive \? `\$\{input\.directive\}/);
  assert.match(invokers, /messages: buildNimiUserMessages\(directedPrompt\)/);
  assert.match(invokers, /buildChatRuntimeUserMessage\(prompt\)/);
  assert.match(capabilities, /attachments: supportsMedia \? media\.attachments : undefined/);
  assert.match(capabilities, /<ImageAttachmentStrip/);
});

test('tester run history labels local fixtures distinctly from runtime results', () => {
  const history = read('src/tester/tester-history.ts');
  assert.match(history, /if \(status === 'ready'\) return 'runtime ready'/);
  assert.match(history, /if \(status === 'unavailable'\) return 'sdk unavailable'/);
  assert.match(history, /return 'local fixture'/);
  assert.match(history, /status === 'local-fixture'\) return 'info'/);
  assert.match(history, /isJsonObject/);
  assert.match(history, /from '@nimiplatform\/sdk\/types'/);
  assert.doesNotMatch(history, /@nimiplatform\/kit\/shell\/renderer\/bridge/);
});

test('tester AI config is the Kit model-config surface in Settings with real SDK AIProfiles', () => {
  const store = read('src/tester/tester-ai-config-store.ts');
  const surface = read('src/shell/ai/tester-ai-config-settings.tsx');
  const panel = read('src/tester/workbench/tester-ai-config-settings-panel.tsx');
  const capabilities = readTesterAiTestingSurface(root);
  const runTarget = read('src/tester/tester-run-target.ts');
  const styles = read('src/tester/tester-workbench.css');

  for (const required of [
    'NimiAIProfile',
    'NimiAIConfig',
    'createNimiAppAIScopeRef',
    'createNimiAIConfigStore',
    'createNimiAISnapshotStore',
    'parseNimiAIProfile',
    'createNimiAIHostSurface',
    'createNimiAIConfigSubscriptionRegistry',
    'validateNimiAIConfig',
    'versionNimiAIConfig',
    'importTesterAIProfileJson',
    'TESTER_AI_PROFILE_LIBRARY_STORAGE_KEY',
    'TESTER_AI_SNAPSHOT_INDEX_KEY',
    'previewApply',
    'apply(scopeRef',
    'saveTesterAIConfig',
    'recordTesterAISnapshot',
    'getLatestTesterAISnapshot',
    '@nimiplatform/kit/features/model-config/headless',
  ]) {
    assert.match(store, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(store, /createAppAIScopeRef/);
  assert.doesNotMatch(store, /createScopedAIConfigStore/);
  assert.doesNotMatch(store, /createScopedAISnapshotStore/);
  assert.doesNotMatch(store, /createHostAIProfileSurface/);
  assert.doesNotMatch(store, /validateAIProfileRuntimeBindings/);

  // The kit model-config mechanics live in the scaffold-managed sectioned config
  // surface skeleton (inherited by every generated app). It composes admitted kit
  // primitives and accepts an initialSection so a capability gear can deep-link.
  for (const required of [
    'ModelConfigCapabilityDetail',
    'ProfileConfigSection',
    'useModelConfigProfileController',
    'defaultModelConfigProfileCopy',
    'Import AIProfile JSON',
    'Open Apply AI Profile to preview and confirm',
    'fail closed',
    'initialSection',
  ]) {
    assert.match(surface, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
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

  // The AI config lives in Settings; the AI Capabilities settings gear deep-links
  // into the configured capability's section. App Lab no longer owns a bespoke
  // AIConfig lives in a right slide-over opened by the per-capability settings
  // gear (full adoption of the canonical kit model-config surface). App Lab's
  // bespoke AIConfig panel was removed entirely.
  assert.match(capabilities, /TesterAiConfigSettingsPanel/);
  assert.match(capabilities, /CAPABILITY_TO_SECTION/);
  assert.match(capabilities, /onOpenConfig/);
  assert.doesNotMatch(capabilities, /function RunTargetBar/);
  assert.doesNotMatch(capabilities, /data-testid="studio-run-target"/);
  assert.match(capabilities, /createTesterRunTargetSummary/);
  assert.match(capabilities, /canDispatch=\{runTarget\.canDispatch\}/);
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
  assert.match(runTarget, /targetRef\.kind === 'profile-slice'/);
  assert.match(runTarget, /runtime\.status !== 'ready'/);
  assert.match(runTarget, /Choose a Runtime model target/);
  assert.doesNotMatch(runTarget, /gpt-4|claude|gemini|openai|anthropic|model:\s*['"]auto['"]/i);
  assert.doesNotMatch(styles, /\.studio-run-target/);
  assert.doesNotMatch(styles, /\.studio-run-target__params/);
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*\.section-ai-testing__drawer[\s\S]*position:\s*fixed/);
});

test('tester product-local persistence consumes Kit core storage helpers', () => {
  const preferences = read('src/tester/tester-preferences.ts');
  const store = read('src/tester/tester-ai-config-store.ts');

  assert.match(preferences, /from '@nimiplatform\/kit\/core\/storage-json'/);
  for (const helper of [
    'resolveBrowserStorage',
    'readStorageJsonFrom',
    'writeStorageJsonTo',
    'removeStorageKeyFrom',
  ]) {
    assert.match(preferences, new RegExp(helper));
  }
  assert.match(store, /from '@nimiplatform\/kit\/core\/storage-json'/);
  assert.match(store, /resolveBrowserStorage\('local'\)/);
});

test('tester LLM invokers consume AIConfig bindings and fail closed without binding', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  const unavailable = read('src/tester/tester-unavailable.ts');
  const llmInvokers = invokers.slice(
    invokers.indexOf('async function invokeTextGenerate'),
    invokers.indexOf('function summariseArtifact'),
  );

  assert.doesNotMatch(llmInvokers, /model:\s*['"]auto['"]/);
  assert.match(unavailable, /ai-config-binding-missing/);
  assert.match(invokers, /resolveTesterLLMBinding/);
  assert.match(invokers, /textRuntimeParametersFromBinding/);
  assert.match(invokers, /optionalFiniteParam\(capabilityId, params, 'temperature'\)/);
  assert.match(invokers, /optionalPositiveIntegerParam\(capabilityId, params, 'timeoutMs'\)/);
  assert.match(invokers, /stopSequences/);
  assert.match(invokers, /must be a finite number/);
  assert.match(invokers, /must be a positive integer/);
  assert.match(invokers, /createTesterTextModel\(client, resolved, textParams\.timeoutMs\)/);
  assert.match(invokers, /\.\.\.textParams\.parameters/);
  assert.match(invokers, /temperature: textParams\.parameters\.temperature/);
  assert.match(invokers, /timeoutMs: textParams\.timeoutMs/);
  assert.match(invokers, /text\.generate' \|\| capabilityId === 'chat\.stream'/);
  assert.match(invokers, /capabilityId === 'text\.embed'/);
  assert.match(invokers, /Runtime invocation failed closed before request dispatch/);
  assert.match(invokers, /routeInput/);
  assert.match(invokers, /config\.capabilities\.targetRefs\[bindingCapabilityId\]/);
  assert.match(invokers, /targetRef\.kind === 'profile-slice'/);
  assert.match(invokers, /targetRef\.kind === 'cloud-connector'/);
  assert.match(invokers, /targetRef\.kind === 'local-runtime'/);
  assert.match(invokers, /connectorId: resolved\.connectorId/);
  assert.match(invokers, /route: 'local'/);
  assert.match(invokers, /aiConfigScopeKind/);
  assert.match(invokers, /aiConfigProfileId/);
  assert.match(invokers, /aiConfigBindingCapabilityId/);
  assert.match(invokers, /aiConfigBindingModel/);
  assert.match(invokers, /aiConfigTargetRefKind/);
  assert.match(invokers, /aiConfigHash/);
  assert.match(invokers, /versionNimiAIConfig/);
  assert.match(invokers, /from '@nimiplatform\/sdk\/ai'/);
  assert.match(invokers, /createNimiRuntimeAISchedulingClient/);
  assert.match(invokers, /client\.runtime/);
  assert.doesNotMatch(invokers, /resolveAIConfigRuntimeSchedulingTargetForCapability/);
  assert.doesNotMatch(invokers, /peekRuntimeSchedulingBatch/);
  assert.doesNotMatch(invokers, /client\.runtime\.ai\.peekScheduling/);

  const mediaBindings = read('src/tester/tester-runtime-media-bindings.ts');
  const mediaInvokers = read('src/tester/tester-runtime-invokers-media.ts');
  assert.match(mediaBindings, /selectedParamRecord\(resolved\)/);
  assert.match(mediaBindings, /\.\.\.forwardedParams,\s*profile_entries:/);
  assert.match(mediaInvokers, /videoParamsFromBinding/);
  assert.match(mediaInvokers, /transcriptionParamsFromBinding/);
  assert.match(mediaInvokers, /mode: videoParams\.mode/);
  assert.match(mediaInvokers, /negativePrompt: videoParams\.negativePrompt/);
  assert.match(mediaInvokers, /options: videoParams\.options/);
  assert.match(mediaInvokers, /speakerCount: transcriptionParams\.speakerCount/);
  assert.match(mediaInvokers, /diarization: transcriptionParams\.diarization/);
  assert.match(mediaInvokers, /timeoutMs,\s*signal/s);
});

test('tester LLM binding resolver fails closed for missing and malformed bindings', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();

  const missing = invokers.resolveTesterLLMBinding('text.generate', {
    scopeRef,
    capabilities: { targetRefs: {}, selectedParams: {} },
    profileOrigin: null,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'ai-config-binding-missing');

  const unresolvedProfileSlice = invokers.resolveTesterLLMBinding('text.generate', {
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'profile-slice',
          sourceProfileId: 'profile-chat',
          sliceId: 'text-generate-local',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });
  assert.equal(unresolvedProfileSlice.ok, false);
  assert.equal(unresolvedProfileSlice.reason, 'ai-config-binding-missing');
  assert.match(unresolvedProfileSlice.message, /profile-slice .* apply\/materialize/i);

  const malformedProfile = store.importTesterAIProfileJson(JSON.stringify({
    profileId: 'malformed',
    title: 'Malformed',
    description: '',
    tags: [],
    capabilities: {
      'text.generate': {
        targetRef: {
          kind: 'cloud-connector',
          connectorId: '',
          providerModelId: '',
        },
      },
    },
  }));
  assert.equal(malformedProfile.ok, false);
  assert.match(malformedProfile.message, /AIProfile validation failed/i);
  assert.match(malformedProfile.errors.join('\n'), /targetRef.*connectorId.*required/i);
  assert.match(malformedProfile.errors.join('\n'), /targetRef.*providerModelId.*required/i);

  const legacyBindingProfile = store.importTesterAIProfileJson(JSON.stringify({
    profileId: 'legacy-binding-facade',
    title: 'Legacy Binding Facade',
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
  assert.equal(legacyBindingProfile.ok, false);
  assert.match(legacyBindingProfile.errors.join('\n'), /binding is forbidden/i);

  assert.throws(() => store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: '',
          providerModelId: '',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  }), /AIConfig validation failed: .*connectorId.*required.*providerModelId.*required/i);

  assert.throws(() => store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  }), /AIConfig validation failed: .*readinessRef or targetId\/profileId/i);

  const previousWindow = globalThis.window;
  const invalidStoredConfig = {
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          providerModelId: '',
        },
      },
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
    assert.throws(() => store.loadTesterAIConfig(scopeRef), /Stored AIConfig is invalid: .*providerModelId is required/i);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('Tester consumes SDK scoped AISnapshot store as App Lab execution evidence proof', async () => {
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const { createNimiAISnapshotRecord } = await import('@nimiplatform/sdk/ai');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  const targetRef = {
    kind: 'cloud-connector',
    connectorId: 'runtime-connector',
    providerModelId: 'runtime-model',
  };
  const config = store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': targetRef,
      },
      selectedParams: {},
    },
    profileOrigin: {
      profileId: 'snapshot-profile',
      title: 'Snapshot Profile',
      appliedAt: '2026-06-02T00:00:00.000Z',
    },
  });
  const snapshot = createNimiAISnapshotRecord({
    executionId: 'tester-snapshot-exec-1',
    scopeRef,
    createdAt: '2026-06-02T00:00:01.000Z',
    config,
    capability: 'text.generate',
    selectedTargetRef: targetRef,
    metadata: { flow: 'app-lab-capability-run' },
  });

  assert.deepEqual(store.recordTesterAISnapshot(snapshot), snapshot);
  assert.deepEqual(store.getTesterAISnapshot(snapshot.executionId), snapshot);
  assert.deepEqual(store.getLatestTesterAISnapshot(scopeRef), snapshot);
});

test('tester LLM invoker dispatches configured AIConfig route payload', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          providerModelId: 'runtime-model',
        },
        'text.embed': {
          kind: 'local-runtime',
          targetId: 'core:runtime',
          profileId: 'embedding-model',
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
      scheduling: {
        async peekScheduling(input, options) {
          captured.push({ surface: 'peekScheduling', input, options });
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario(input, options) {
          captured.push({ surface: 'executeScenario', input, options });
          if (input.scenarioType === RUNTIME_SCENARIO_TYPE_TEXT_EMBED) {
            return textEmbedScenarioResponse(input);
          }
          return textGenerateScenarioResponse(input);
        },
        streamScenario(input, options) {
          captured.push({ surface: 'streamScenario', input, options });
          return textScenarioStream(input);
        },
      },
    },
  };

  const textResult = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'Hello runtime',
    scenarioId: 'behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(textResult.ok, true);

  const streamResult = await invokers.invokeTesterCapability(client, 'chat.stream', {
    prompt: 'Hello stream',
    scenarioId: 'behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(streamResult.ok, true);

  const embedResult = await invokers.invokeTesterCapability(client, 'text.embed', {
    prompt: 'Hello embed',
    scenarioId: 'behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(embedResult.ok, true);

  assert.deepEqual(captured.map((entry) => entry.surface), [
    'peekScheduling',
    'executeScenario',
    'peekScheduling',
    'streamScenario',
    'peekScheduling',
    'executeScenario',
  ]);
  assert.equal(captured[0].input.targets[0].targetId, 'runtime-connector');
  assert.equal(captured[0].input.targets[0].profileId, 'runtime-model');
  assert.equal(captured[1].input.scenarioType, RUNTIME_SCENARIO_TYPE_TEXT_GENERATE);
  assert.equal(captured[1].input.executionMode, RUNTIME_EXECUTION_MODE_SYNC);
  assert.equal(captured[1].input.head.modelId, 'runtime-model');
  assert.equal(captured[1].input.head.subjectUserId, 'subject-user-1');
  assert.equal(captured[1].input.head.connectorId, 'runtime-connector');
  assert.equal(captured[1].input.head.routePolicy, RUNTIME_ROUTE_POLICY_CLOUD);
  assert.equal(captured[1].options.metadata.aiConfigProfileId, 'behavior-profile');
  assert.equal(captured[1].options.metadata.aiConfigBindingCapabilityId, 'text.generate');
  assert.equal(captured[1].options.metadata.aiConfigTargetRefKind, 'cloud-connector');
  assert.equal(captured[3].input.scenarioType, RUNTIME_SCENARIO_TYPE_TEXT_GENERATE);
  assert.equal(captured[3].input.executionMode, RUNTIME_EXECUTION_MODE_STREAM);
  assert.equal(captured[3].input.head.modelId, 'runtime-model');
  assert.equal(captured[3].input.head.subjectUserId, 'subject-user-1');
  assert.equal(captured[3].input.head.connectorId, 'runtime-connector');
  assert.equal(captured[3].input.head.routePolicy, RUNTIME_ROUTE_POLICY_CLOUD);
  assert.equal(captured[3].options.metadata.aiConfigBindingCapabilityId, 'text.generate');
  assert.equal(captured[4].input.targets[0].capability, 'text.embed');
  assert.equal(captured[4].input.targets[0].targetId, 'core:runtime');
  assert.equal(captured[4].input.targets[0].profileId, 'embedding-model');
  assert.equal(captured[5].input.scenarioType, RUNTIME_SCENARIO_TYPE_TEXT_EMBED);
  assert.equal(captured[5].input.executionMode, RUNTIME_EXECUTION_MODE_SYNC);
  assert.equal(captured[5].input.head.modelId, 'embedding-model');
  assert.equal(captured[5].input.head.subjectUserId, 'subject-user-1');
  assert.equal(captured[5].input.head.connectorId, '');
  assert.equal(captured[5].input.head.routePolicy, RUNTIME_ROUTE_POLICY_LOCAL);
  assert.equal(captured[5].options.metadata.aiConfigBindingCapabilityId, 'text.embed');
  assert.equal(captured[5].options.metadata.runtimeSchedulingState, 'runnable');
  assert.equal(Object.hasOwn(captured[5].options.metadata, 'runtimeSchedulingDetail'), false);
});

test('tester LLM invokers forward selectedParams and timeout to Runtime payloads', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          providerModelId: 'runtime-model',
        },
      },
      selectedParams: {
        'text.generate': {
          temperature: '0.25',
          topP: 0.8,
          topK: '40',
          maxTokens: '128',
          presencePenalty: '0.1',
          frequencyPenalty: '0.2',
          stopSequences: ['END', ''],
          timeoutMs: '90000',
        },
      },
    },
    profileOrigin: {
      profileId: 'params-profile',
      title: 'Params Profile',
      appliedAt: '2026-06-03T00:00:00.000Z',
    },
  });

  const captured = [];
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling(input, options) {
          captured.push({ surface: 'peekScheduling', input, options });
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario(input, options) {
          captured.push({ surface: 'executeScenario', input, options });
          return textGenerateScenarioResponse(input);
        },
        streamScenario(input, options) {
          captured.push({ surface: 'streamScenario', input, options });
          return textScenarioStream(input);
        },
      },
    },
  };

  const textResult = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'Hello with params',
    scenarioId: 'selected-params',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(textResult.ok, true);

  const streamResult = await invokers.invokeTesterCapability(client, 'chat.stream', {
    prompt: 'Hello stream params',
    scenarioId: 'selected-params',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(streamResult.ok, true);

  const generateCall = captured.find((entry) => entry.surface === 'executeScenario');
  const generateSpec = generateCall.input.spec.spec.textGenerate;
  assert.equal(generateCall.input.head.timeoutMs, 90000);
  assert.equal(generateSpec.temperature, 0.25);
  assert.equal(generateSpec.topP, 0.8);
  assert.equal(generateSpec.topK, 40);
  assert.equal(generateSpec.maxTokens, 128);
  assert.equal(generateSpec.presencePenalty, 0.1);
  assert.equal(generateSpec.frequencyPenalty, 0.2);
  assert.deepEqual(generateSpec.stop, ['END']);
  assert.equal(generateCall.options.metadata.aiConfigBindingCapabilityId, 'text.generate');

  const streamCall = captured.find((entry) => entry.surface === 'streamScenario');
  const streamSpec = streamCall.input.spec.spec.textGenerate;
  assert.equal(streamCall.input.head.timeoutMs, 90000);
  assert.equal(streamSpec.temperature, 0.25);
  assert.equal(streamSpec.topP, 0.8);
  assert.equal(streamSpec.maxTokens, 128);
  assert.equal(streamSpec.topK, 0);
  assert.equal(streamSpec.presencePenalty, 0);
  assert.equal(streamSpec.frequencyPenalty, 0);
  assert.deepEqual(streamSpec.stop, []);
});

test('tester LLM selectedParams validation fails closed before dispatch', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          providerModelId: 'runtime-model',
        },
      },
      selectedParams: {
        'text.generate': {
          maxTokens: 'not-a-number',
        },
      },
    },
    profileOrigin: null,
  });

  const captured = [];
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling(input) {
          captured.push({ surface: 'peekScheduling', input });
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario(input) {
          captured.push({ surface: 'executeScenario', input });
          return textGenerateScenarioResponse(input);
        },
        streamScenario(input) {
          captured.push({ surface: 'streamScenario', input });
          return textScenarioStream(input);
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'This must not dispatch',
    scenarioId: 'invalid-selected-params',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'input-invalid');
  assert.match(result.message, /selectedParams\.maxTokens must be a finite number/);
  assert.deepEqual(captured, []);

  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          providerModelId: 'runtime-model',
        },
      },
      selectedParams: {
        'text.generate': {
          maxTokens: '12.5',
        },
      },
    },
    profileOrigin: null,
  });

  const fractionalResult = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'This fractional integer must not dispatch',
    scenarioId: 'fractional-selected-params',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(fractionalResult.ok, false);
  assert.equal(fractionalResult.reason, 'input-invalid');
  assert.match(fractionalResult.message, /selectedParams\.maxTokens must be a positive integer/);
  assert.deepEqual(captured, []);
});

test('tester video invoker forwards selected media params to Runtime media lane', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'video.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-video-connector',
          providerModelId: 'runtime-video-model',
        },
      },
      selectedParams: {
        'video.generate': {
          mode: 't2v',
          negativePrompt: 'blur',
          ratio: '9:16',
          durationSec: '6',
          resolution: '720p',
          fps: '24',
          seed: '42',
          cameraFixed: true,
          generateAudio: true,
          timeoutMs: '123000',
        },
      },
    },
    profileOrigin: {
      profileId: 'video-profile',
      title: 'Video Profile',
      appliedAt: '2026-06-03T00:00:00.000Z',
    },
  });

  let capturedVideo = null;
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario() {
          throw new Error('executeScenario should not run when media.video.generate is available');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called');
        },
      },
      media: {
        video: {
          async generate(input) {
            capturedVideo = input;
            return {
              job: {
                jobId: 'video-job-1',
                state: 'completed',
                modelResolved: 'runtime-video-model',
                routeDecision: 'cloud',
                traceId: 'video-trace-1',
              },
              artifacts: [],
              traceId: 'video-trace-1',
            };
          },
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'video.generate', {
    prompt: 'Generate a moving product shot',
    scenarioId: 'video-selected-params',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(result.ok, true);
  assert.equal(capturedVideo.mode, 't2v');
  assert.equal(capturedVideo.connectorId, 'runtime-video-connector');
  assert.equal(capturedVideo.model, 'runtime-video-model');
  assert.equal(capturedVideo.subjectUserId, 'subject-user-1');
  assert.equal(capturedVideo.prompt, 'Generate a moving product shot');
  assert.equal(capturedVideo.negativePrompt, 'blur');
  assert.deepEqual(capturedVideo.options, {
    ratio: '9:16',
    durationSec: 6,
    resolution: '720p',
    fps: 24,
    seed: '42',
    cameraFixed: true,
    generateAudio: true,
  });
  assert.equal(capturedVideo.timeoutMs, 123000);
  assert.equal(capturedVideo.signal instanceof AbortSignal, true);
  assert.equal(capturedVideo.metadata.aiConfigBindingCapabilityId, 'video.generate');
});

test('tester local text.generate binding omits runtime connectorId payload', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  const runtimeLocalModelId = 'local.chat.gemma-4-e2b-it.q8-0';
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          targetId: 'core:runtime',
          profileId: runtimeLocalModelId,
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
      scheduling: {
        async peekScheduling(input) {
          capturedSchedulingInput = input;
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario(input) {
          capturedInput = input;
          return textGenerateScenarioResponse(input, 'trace-local', 'nimi runtime llm ok');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called');
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'Reply with exactly: nimi runtime llm ok',
    scenarioId: 'local-behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(result.ok, true);
  assert.equal(capturedInput.scenarioType, RUNTIME_SCENARIO_TYPE_TEXT_GENERATE);
  assert.equal(capturedInput.executionMode, RUNTIME_EXECUTION_MODE_SYNC);
  assert.equal(capturedInput.head.modelId, runtimeLocalModelId);
  assert.equal(capturedInput.head.subjectUserId, 'subject-user-1');
  assert.equal(capturedInput.head.routePolicy, RUNTIME_ROUTE_POLICY_LOCAL);
  assert.equal(capturedInput.head.connectorId, '');
  assert.deepEqual(capturedSchedulingInput.targets, [{
    capability: 'text.generate',
    targetId: 'core:runtime',
    profileId: runtimeLocalModelId,
    resourceHint: undefined,
  }]);
});

test('tester local LLM scheduling denial fails closed before Runtime execution', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          targetId: 'core:runtime',
          profileId: 'local.chat.blocked',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });

  let generateCalled = false;
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling() {
          return {
            occupancy: { globalUsed: 1, globalCap: 1, appUsed: 1, appCap: 1 },
            aggregateJudgement: {
              state: RUNTIME_SCHEDULING_DENIED,
              detail: 'dependency missing',
              occupancy: { globalUsed: 1, globalCap: 1, appUsed: 1, appCap: 1 },
              resourceWarnings: ['dependency missing'],
            },
            targetJudgements: [],
          };
        },
      },
      ai: {
        async executeScenario() {
          generateCalled = true;
          throw new Error('executeScenario must not run after denied scheduling');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called');
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
    async listRuntimeRouteOptions(input) {
      calls.push({ surface: 'listRuntimeRouteOptions', input });
      return {
        capability: input.capability,
        selected: null,
        local: {
          models: [
            {
              localModelId: runtimeLocalModelId,
              model: runtimeLocalModelId,
              modelId: runtimeLocalModelId,
              label: runtimeLocalModelId,
              engine: 'llama',
              status: 'active',
              capabilities: ['text.generate'],
            },
          ],
          defaultEndpoint: 'http://127.0.0.1:11434/v1',
        },
        connectors: [
          {
            id: remoteConnectorId,
            provider: 'cloud-provider',
            label: 'Cloud Provider',
            models: ['remote.chat.model'],
            modelCapabilities: {
              'remote.chat.model': ['text.generate'],
            },
          },
        ],
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
        selectedBinding: undefined,
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
