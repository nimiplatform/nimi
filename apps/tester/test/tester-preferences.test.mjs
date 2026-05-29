import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

const source = read('src/tester/tester-preferences.ts');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
const preferencesModule = await import(moduleUrl);

function createStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    snapshot() {
      return Object.fromEntries(data.entries());
    },
  };
}

test('tester preferences use a versioned localStorage schema and fail closed', () => {
  const {
    TESTER_PREFERENCES_STORAGE_KEY,
    TESTER_PREFERENCES_SCHEMA_VERSION,
    defaultTesterPreferences,
    loadTesterPreferences,
    saveTesterPreferences,
  } = preferencesModule;
  const storage = createStorage();

  assert.equal(TESTER_PREFERENCES_STORAGE_KEY, 'nimiapp-tester:workbench-preferences:v1');
  assert.equal(TESTER_PREFERENCES_SCHEMA_VERSION, 1);

  const initial = loadTesterPreferences(storage);
  assert.deepEqual(initial.preferences, defaultTesterPreferences());
  assert.equal(initial.status.state, 'defaulted');

  const saved = saveTesterPreferences({
    schemaVersion: 1,
    draftPersistence: false,
    verboseConsole: true,
    evidenceCaptureMode: 'after-run',
  }, storage);
  assert.equal(saved.status.state, 'ready');

  const loaded = loadTesterPreferences(storage);
  assert.equal(loaded.preferences.draftPersistence, false);
  assert.equal(loaded.preferences.verboseConsole, true);
  assert.equal(loaded.preferences.evidenceCaptureMode, 'after-run');

  storage.setItem(TESTER_PREFERENCES_STORAGE_KEY, '{bad json');
  const corrupt = loadTesterPreferences(storage);
  assert.deepEqual(corrupt.preferences, defaultTesterPreferences());
  assert.equal(corrupt.status.state, 'corrupt');
});

test('reset removes only the preference key and leaves evidence stores untouched', () => {
  const {
    TESTER_PREFERENCES_STORAGE_KEY,
    TESTER_PROMPT_DRAFTS_STORAGE_KEY,
    resetTesterPreferences,
  } = preferencesModule;
  const storage = createStorage({
    [TESTER_PREFERENCES_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      draftPersistence: false,
      verboseConsole: true,
      evidenceCaptureMode: 'after-run',
    }),
    [TESTER_PROMPT_DRAFTS_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      drafts: {
        'app-lab:text.generate:acceptance-note': 'saved prompt',
      },
    }),
    tester_run_history: 'keep',
    tester_image_history: 'keep',
  });

  const reset = resetTesterPreferences(storage);
  assert.equal(reset.status.state, 'reset');
  const snapshot = storage.snapshot();
  assert.equal(snapshot[TESTER_PREFERENCES_STORAGE_KEY], undefined);
  assert.match(snapshot[TESTER_PROMPT_DRAFTS_STORAGE_KEY], /saved prompt/);
  assert.equal(snapshot.tester_run_history, 'keep');
  assert.equal(snapshot.tester_image_history, 'keep');
});

test('prompt drafts use versioned localStorage and fail closed to presets', () => {
  const {
    TESTER_PROMPT_DRAFTS_STORAGE_KEY,
    TESTER_PROMPT_DRAFTS_SCHEMA_VERSION,
    loadTesterPromptDraft,
    saveTesterPromptDraft,
  } = preferencesModule;
  const storage = createStorage();
  const key = {
    surfaceId: 'app-lab',
    capabilityId: 'text.generate',
    scenarioId: 'acceptance-note',
  };

  assert.equal(TESTER_PROMPT_DRAFTS_STORAGE_KEY, 'nimiapp-tester:prompt-drafts:v1');
  assert.equal(TESTER_PROMPT_DRAFTS_SCHEMA_VERSION, 1);

  const empty = loadTesterPromptDraft(key, true, storage);
  assert.equal(empty.prompt, null);
  assert.equal(empty.status.state, 'defaulted');

  const saved = saveTesterPromptDraft(key, 'draft body', true, storage);
  assert.equal(saved.status.state, 'ready');

  const loaded = loadTesterPromptDraft(key, true, storage);
  assert.equal(loaded.prompt, 'draft body');
  assert.equal(loaded.status.state, 'ready');

  storage.setItem(TESTER_PROMPT_DRAFTS_STORAGE_KEY, '{bad json');
  const corrupt = loadTesterPromptDraft(key, true, storage);
  assert.equal(corrupt.prompt, null);
  assert.equal(corrupt.status.state, 'corrupt');
});

test('disabled prompt draft persistence does not save new edits', () => {
  const {
    TESTER_PROMPT_DRAFTS_STORAGE_KEY,
    loadTesterPromptDraft,
    saveTesterPromptDraft,
  } = preferencesModule;
  const storage = createStorage({
    [TESTER_PROMPT_DRAFTS_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      drafts: {
        'app-lab:text.generate:acceptance-note': 'existing draft',
      },
    }),
  });
  const key = {
    surfaceId: 'app-lab',
    capabilityId: 'text.generate',
    scenarioId: 'acceptance-note',
  };

  const disabledLoad = loadTesterPromptDraft(key, false, storage);
  assert.equal(disabledLoad.prompt, null);
  assert.equal(disabledLoad.status.state, 'disabled');

  const disabledSave = saveTesterPromptDraft(key, 'new draft', false, storage);
  assert.equal(disabledSave.status.state, 'disabled');
  assert.match(storage.snapshot()[TESTER_PROMPT_DRAFTS_STORAGE_KEY], /existing draft/);
  assert.doesNotMatch(storage.snapshot()[TESTER_PROMPT_DRAFTS_STORAGE_KEY], /new draft/);
});

test('settings control plane avoids fake controls and runtime authority claims', () => {
  const settings = read('src/tester/workbench/section-settings.tsx');
  const workbench = read('src/tester/tester-workbench.tsx');
  const commandBar = read('src/tester/workbench/workbench-command-bar.tsx');
  const appLab = read('src/tester/workbench/section-app-lab.tsx');
  const aiTesting = read('src/tester/workbench/section-ai-testing.tsx');

  assert.doesNotMatch(settings, /ProgressIndicator/);
  assert.doesNotMatch(settings, /continuous/);
  assert.match(settings, /Manual/);
  assert.match(settings, /After run/);
  assert.match(settings, /window\.localStorage/);
  assert.match(settings, /save prompt edits per capability and scenario/);
  assert.match(settings, /Settings cannot change Runtime, Auth, Provider, or SDK admission permissions/);
  assert.match(settings, /Prompt drafts, runs, and artifacts are not cleared/);
  assert.match(workbench, /evidenceCaptureMode === 'after-run'/);
  assert.match(workbench, /handleCaptureEvidence\(\)/);
  assert.match(workbench, /draftPersistence=\{preferenceState\.preferences\.draftPersistence\}/);
  assert.match(appLab, /loadTesterPromptDraft/);
  assert.match(appLab, /saveTesterPromptDraft/);
  assert.match(appLab, /surfaceId: 'app-lab'/);
  assert.match(aiTesting, /loadTesterPromptDraft/);
  assert.match(aiTesting, /saveTesterPromptDraft/);
  assert.match(aiTesting, /surfaceId: 'ai-capabilities'/);
  assert.match(commandBar, /Capture: after run/);
});
