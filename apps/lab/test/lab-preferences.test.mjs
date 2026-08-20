import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

const source = read('src/lab/lab-preferences.ts');
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
const promptDraftSource = read('src/ai-studio-core/prompt-drafts.ts');
const promptDraftOutput = ts.transpileModule(promptDraftSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const promptDraftModuleUrl = `data:text/javascript;base64,${Buffer.from(promptDraftOutput).toString('base64')}`;
const sdkTypesStubUrl = `data:text/javascript;base64,${Buffer.from('export const isJsonObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);').toString('base64')}`;
const historyPolicySource = read('src/ai-studio-core/history-policy.ts');
const historyPolicyOutput = ts.transpileModule(historyPolicySource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText.replace(
  /from\s+['"]@nimiplatform\/sdk\/types['"]/g,
  `from ${JSON.stringify(sdkTypesStubUrl)}`,
);
const historyPolicyModuleUrl = `data:text/javascript;base64,${Buffer.from(historyPolicyOutput).toString('base64')}`;
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const rewrittenOutput = outputText
  .replace(
    /from\s+['"]@nimiplatform\/kit\/core\/storage-json['"]/g,
    `from ${JSON.stringify(storageJsonModuleUrl)}`,
  )
  .replace(
    /from\s+['"]\.\.\/ai-studio-core\/prompt-drafts\.js['"]/g,
    `from ${JSON.stringify(promptDraftModuleUrl)}`,
  )
  .replace(
    /from\s+['"]\.\.\/ai-studio-core\/history-policy\.js['"]/g,
    `from ${JSON.stringify(historyPolicyModuleUrl)}`,
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

test('lab preferences use a versioned localStorage schema and fail closed', () => {
  const {
    LAB_PREFERENCES_STORAGE_KEY,
    LAB_PREFERENCES_SCHEMA_VERSION,
    defaultLabPreferences,
    loadLabPreferences,
    saveLabPreferences,
  } = preferencesModule;
  const storage = createStorage();

  assert.equal(LAB_PREFERENCES_STORAGE_KEY, 'nimiapp-lab:workbench-preferences:v1');
  assert.equal(LAB_PREFERENCES_SCHEMA_VERSION, 1);

  const initial = loadLabPreferences(storage);
  assert.deepEqual(initial.preferences, defaultLabPreferences());
  assert.equal(initial.status.state, 'defaulted');

  const saved = saveLabPreferences({
    schemaVersion: 1,
    draftPersistence: false,
    verboseConsole: true,
    unknownLegacyField: 'ignored',
  }, storage);
  assert.equal(saved.status.state, 'ready');

  const loaded = loadLabPreferences(storage);
  assert.equal(loaded.preferences.draftPersistence, false);
  assert.equal(loaded.preferences.verboseConsole, true);
  assert.equal(Object.hasOwn(loaded.preferences, 'unknownLegacyField'), false);

  storage.setItem(LAB_PREFERENCES_STORAGE_KEY, '{bad json');
  const corrupt = loadLabPreferences(storage);
  assert.deepEqual(corrupt.preferences, defaultLabPreferences());
  assert.equal(corrupt.status.state, 'corrupt');
});

test('legacy stored preferences gain history panel defaults and keep saved panel state', () => {
  const {
    LAB_PREFERENCES_STORAGE_KEY,
    loadLabPreferences,
    saveLabPreferences,
  } = preferencesModule;
  const storage = createStorage({
    [LAB_PREFERENCES_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      draftPersistence: false,
      verboseConsole: true,
    }),
  });

  const legacy = loadLabPreferences(storage);
  assert.equal(legacy.status.state, 'ready');
  assert.equal(legacy.preferences.draftPersistence, false);
  assert.deepEqual(legacy.preferences.historyPanel, { collapsed: true, scope: 'capability', hideFailures: false });
  assert.equal(legacy.preferences.lastCapabilityId, null);

  const saved = saveLabPreferences({
    ...legacy.preferences,
    historyPanel: { collapsed: false, scope: 'media', hideFailures: true },
    lastCapabilityId: 'image.generate',
  }, storage);
  assert.equal(saved.status.state, 'ready');

  const loaded = loadLabPreferences(storage);
  assert.deepEqual(loaded.preferences.historyPanel, { collapsed: false, scope: 'media', hideFailures: true });
  assert.equal(loaded.preferences.lastCapabilityId, 'image.generate');

  const invalidScope = createStorage({
    [LAB_PREFERENCES_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      draftPersistence: true,
      verboseConsole: false,
      historyPanel: { collapsed: 'yes', scope: 'everything', hideFailures: 1 },
      lastCapabilityId: 42,
    }),
  });
  const recovered = loadLabPreferences(invalidScope);
  assert.equal(recovered.status.state, 'ready');
  assert.deepEqual(recovered.preferences.historyPanel, { collapsed: true, scope: 'capability', hideFailures: false });
  assert.equal(recovered.preferences.lastCapabilityId, null);
});

test('reset removes only the preference key and leaves unrelated app state untouched', () => {
  const {
    LAB_PREFERENCES_STORAGE_KEY,
    LAB_PROMPT_DRAFTS_STORAGE_KEY,
    resetLabPreferences,
  } = preferencesModule;
  const storage = createStorage({
    [LAB_PREFERENCES_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      draftPersistence: false,
      verboseConsole: true,
    }),
    [LAB_PROMPT_DRAFTS_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      drafts: {
        'app-lab:text.generate:acceptance-note': 'saved prompt',
      },
    }),
    unrelated_product_state: 'keep',
  });

  const reset = resetLabPreferences(storage);
  assert.equal(reset.status.state, 'reset');
  const snapshot = storage.snapshot();
  assert.equal(snapshot[LAB_PREFERENCES_STORAGE_KEY], undefined);
  assert.match(snapshot[LAB_PROMPT_DRAFTS_STORAGE_KEY], /saved prompt/);
  assert.equal(snapshot.unrelated_product_state, 'keep');
});

test('prompt drafts use versioned localStorage and fail closed to presets', () => {
  const {
    LAB_PROMPT_DRAFTS_STORAGE_KEY,
    LAB_PROMPT_DRAFTS_SCHEMA_VERSION,
    loadLabPromptDraft,
    saveLabPromptDraft,
  } = preferencesModule;
  const storage = createStorage();
  const key = {
    surfaceId: 'app-lab',
    capabilityId: 'text.generate',
    scenarioId: 'acceptance-note',
  };

  assert.equal(LAB_PROMPT_DRAFTS_STORAGE_KEY, 'nimiapp-lab:prompt-drafts:v1');
  assert.equal(LAB_PROMPT_DRAFTS_SCHEMA_VERSION, 1);

  const empty = loadLabPromptDraft(key, true, storage);
  assert.equal(empty.prompt, null);
  assert.equal(empty.status.state, 'defaulted');

  const saved = saveLabPromptDraft(key, 'draft body', true, storage);
  assert.equal(saved.status.state, 'ready');

  const loaded = loadLabPromptDraft(key, true, storage);
  assert.equal(loaded.prompt, 'draft body');
  assert.equal(loaded.status.state, 'ready');

  const emptied = saveLabPromptDraft(key, '', true, storage);
  assert.equal(emptied.status.state, 'ready');
  assert.equal(loadLabPromptDraft(key, true, storage).prompt, '');

  storage.setItem(LAB_PROMPT_DRAFTS_STORAGE_KEY, '{bad json');
  const corrupt = loadLabPromptDraft(key, true, storage);
  assert.equal(corrupt.prompt, null);
  assert.equal(corrupt.status.state, 'corrupt');
});

test('disabled prompt draft persistence does not save new edits', () => {
  const {
    LAB_PROMPT_DRAFTS_STORAGE_KEY,
    loadLabPromptDraft,
    saveLabPromptDraft,
  } = preferencesModule;
  const storage = createStorage({
    [LAB_PROMPT_DRAFTS_STORAGE_KEY]: JSON.stringify({
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

  const disabledLoad = loadLabPromptDraft(key, false, storage);
  assert.equal(disabledLoad.prompt, null);
  assert.equal(disabledLoad.status.state, 'disabled');

  const disabledSave = saveLabPromptDraft(key, 'new draft', false, storage);
  assert.equal(disabledSave.status.state, 'disabled');
  assert.match(storage.snapshot()[LAB_PROMPT_DRAFTS_STORAGE_KEY], /existing draft/);
  assert.doesNotMatch(storage.snapshot()[LAB_PROMPT_DRAFTS_STORAGE_KEY], /new draft/);
});
