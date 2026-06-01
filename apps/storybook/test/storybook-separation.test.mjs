import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(next);
    return /\.(ts|tsx)$/.test(entry.name) ? [next] : [];
  });
}

const STUDIO_AUTHORING_TOKENS = [
  'convertIntake',
  'seedTruthPackage',
  'scaffoldStarterChapter',
  'approveBible',
  'applyBibleDraft',
  'buildPreparedPackage',
  'buildStudioProjection',
  'applyEdit',
  'createRegenerationRequest',
  'createImportedRef',
  'runFullDiagnostics',
  // NOTE: deriveCandidateFromTurn is NOT an authoring control — Play legitimately
  // derives run-emerged promotion candidates; only Studio assesses/accepts them.
];

test('Play surface exposes no Studio authoring controls', () => {
  const playFiles = ['src/storybook/ui/play/play-home.tsx', 'src/storybook/ui/play/play-run.tsx'];
  const playSource = playFiles.map(read).join('\n');
  for (const token of STUDIO_AUTHORING_TOKENS) {
    assert.doesNotMatch(playSource, new RegExp(`\\b${token}\\b`), `Play must not reference Studio authoring token ${token}`);
  }
  // Play renders generated choices by default.
  assert.match(read('src/storybook/ui/play/play-run.tsx'), /generateChoicesForNode/);
  assert.match(read('src/storybook/ui/play/play-run.tsx'), /data-testid="play-choices"/);
});

test('Studio surface owns the authoring path', () => {
  const intake = read('src/storybook/ui/studio/studio-intake.tsx');
  const project = read('src/storybook/ui/studio/studio-project.tsx');
  assert.match(intake, /convertIntake/);
  assert.match(intake, /seedTruthPackage/);
  assert.match(project, /approveBible/);
  assert.match(project, /scaffoldStarterChapter/);
  assert.match(project, /buildPreparedPackage/);
  assert.match(project, /buildStudioProjection/);
});

test('Studio advanced surfaces own editor/regeneration/promotion/realm/diagnostics', () => {
  const advanced = read('src/storybook/ui/studio/studio-advanced.tsx');
  assert.match(advanced, /applyEdit/);
  assert.match(advanced, /createRegenerationRequest/);
  assert.match(advanced, /runFullDiagnostics/);
  const promotion = read('src/storybook/ui/studio/studio-promotion.tsx');
  // Studio reviews REAL run-emerged candidates (reads runs), not hardcoded demos
  assert.match(promotion, /listRuns/);
  assert.match(promotion, /assessPromotionCandidateLocally/);
  assert.match(promotion, /enforcePromotionPolicy/);
  assert.match(promotion, /recordAcceptedPromotion/);
  // realm imports are persisted onto the truth package
  assert.match(promotion, /addRealmImport/);
  assert.match(promotion, /createImportedRef/);
  // run-state -> Realm promotion is demonstrated failing closed
  assert.match(promotion, /createRealmPromotionRequest/);
  const playtest = read('src/storybook/ui/studio/studio-playtest.tsx');
  assert.match(playtest, /generateChoicesForNode/);
  // all three panels wired into the project workbench
  const project = read('src/storybook/ui/studio/studio-project.tsx');
  assert.match(project, /StudioAdvanced/);
  assert.match(project, /StudioPromotion/);
  assert.match(project, /StudioPlaytest/);
});

test('Play free-text routes through the guarded narrative engine + derives real candidates (wave-8/11)', () => {
  const playRun = read('src/storybook/ui/play/play-run.tsx');
  assert.match(playRun, /processTurn/);
  assert.match(playRun, /buildPlayNarrativeContext/);
  // run-emerged promotion candidates come from the REAL guarded turn record
  assert.match(playRun, /deriveCandidateFromTurn/);
  assert.match(playRun, /promotionCandidates/);
  // still choice-primary: generated choices remain the default progression path
  assert.match(playRun, /generateChoicesForNode/);
});

test('app shell wires separated Play and Studio surfaces', () => {
  const app = read('src/storybook/ui/storybook-app.tsx');
  assert.match(app, /import \{ PlayHome \}/);
  assert.match(app, /import \{ StudioHome \}/);
  assert.match(app, /data-testid="surface-play"/);
  assert.match(app, /data-testid="surface-studio"/);
});

test('AI boundary uses AIConfig bindings with no provider/model hardcoding', () => {
  const invokers = read('src/storybook/ai/storybook-runtime-invokers.ts');
  // text path is binding-driven (AIConfig), not a named model
  assert.match(invokers, /resolveStorybookTextBinding/);
  const textPath = invokers.slice(0, invokers.indexOf('invokeStorybookImage'));
  assert.doesNotMatch(textPath, /model:\s*['"]auto['"]/, 'text path must not pin a model; it routes by AIConfig binding');
  // image path defers route selection to the runtime via "auto" (not a provider name)
  assert.match(invokers, /model:\s*['"]auto['"]/);

  // no hardcoded provider/model brand anywhere in the app source
  const allSource = listFiles(path.join(root, 'src', 'storybook')).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(allSource, /\b(openai|anthropic|gemini|gpt-4|gpt-3\.5|claude-3|claude-opus|mistral|deepseek|qwen)\b/i, 'no provider/model hardcoding in app source');
  // no app-local REST bypass of the runtime/SDK
  assert.doesNotMatch(allSource, /fetch\(['"]https?:\/\//i, 'no direct provider/REST calls from app code');
});

test('AI boundary returns typed unavailable states (no fabricated output)', () => {
  const runtime = read('src/storybook/ai/storybook-runtime.ts');
  const unavailable = read('src/storybook/ai/storybook-unavailable.ts');
  assert.match(runtime, /runtime-not-ready/);
  assert.match(unavailable, /ai-binding-missing/);
  assert.match(unavailable, /StorybookAIUnavailable/);
  // generation records provenance even on failure, and never fabricates an artifact
  const generation = read('src/storybook/ai/storybook-generation.ts');
  assert.match(generation, /returned no usable artifact/);
  assert.match(generation, /status: 'unavailable'/);
});

test('app-internal memory has no Runtime/Realm/ecosystem write surface', () => {
  const memory = read('src/storybook/engine/memory.ts');
  assert.match(memory, /STORYBOOK_MEMORY_SCOPE = 'app-internal-project-scoped'/);
  // No SDK / Realm / Runtime import => no surface that could write outside the app.
  // (The doc comment explains the boundary in prose; we assert on imports, not prose.)
  const memoryImports = memory.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
  assert.doesNotMatch(memoryImports, /@nimiplatform\/sdk/);
  assert.doesNotMatch(memoryImports, /realm|runtime/i);

  const store = read('src/storybook/store/storybook-store.ts');
  // the local store persists only to localStorage / in-memory, never to Realm/Runtime
  assert.match(store, /localStorage/);
  assert.doesNotMatch(store, /@nimiplatform\/sdk\/realm|runtime\.account|RealmWorld/);
});

test('Realm/Forge/narrative-engine remain references, not imports', () => {
  const allSource = listFiles(path.join(root, 'src', 'storybook')).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(allSource, /from ['"]@renderer\//);
  assert.doesNotMatch(allSource, /from ['"]@runtime\//);
  assert.doesNotMatch(allSource, /from ['"].*nimi-forge/);
  assert.doesNotMatch(allSource, /from ['"].*narrative-engine/);
  assert.doesNotMatch(allSource, /runtime\/internal/);
});

test('scaffold identity is Storybook, not Tester', () => {
  assert.match(read('nimi.app.yaml'), /app_id: nimi\.storybook/);
  assert.match(read('nimi.app.yaml'), /display_name: Storybook/);
  assert.match(read('package.json'), /"@nimiplatform\/storybook"/);
  assert.match(read('src/shell/auth/runtime-platform.ts'), /appId = 'nimi\.storybook'/);
  assert.match(read('src/shell/routes/product-area.tsx'), /StorybookApp/);
  assert.match(read('index.html'), /<title>Storybook<\/title>/);
  // tester product surfaces are gone
  assert.doesNotMatch(read('src/shell/routes/product-area.tsx'), /TesterWorkbench|world-tour/);
});
