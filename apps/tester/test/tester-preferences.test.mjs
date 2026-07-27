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
const storageJsonSource = readFileSync(
  path.resolve(root, '../../kit/core/src/storage-json.ts'),
  'utf8',
);
const storageJsonOutput = ts.transpileModule(storageJsonSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const storageJsonModuleUrl = `data:text/javascript;base64,${Buffer.from(storageJsonOutput).toString('base64')}`;
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const rewrittenOutput = outputText.replace(
  /from\s+['"]@nimiplatform\/kit\/core\/storage-json['"]/g,
  `from ${JSON.stringify(storageJsonModuleUrl)}`,
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(rewrittenOutput).toString('base64')}`;
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
  }, storage);
  assert.equal(saved.status.state, 'ready');

  const loaded = loadTesterPreferences(storage);
  assert.equal(loaded.preferences.draftPersistence, false);
  assert.equal(loaded.preferences.verboseConsole, true);
  assert.equal(Object.hasOwn(loaded.preferences, 'evidenceCaptureMode'), false);

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
