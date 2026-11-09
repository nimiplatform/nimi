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
const sdkAppModuleUrl = import.meta.resolve('@nimiplatform/sdk/app');
const separationRequestOutput = ts.transpileModule(read('src/ai-studio-core/audio-separation-request.ts'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const separationRequestModuleUrl = `data:text/javascript;base64,${Buffer.from(separationRequestOutput).toString('base64')}`;
const managedReferencesOutput = ts.transpileModule(read('src/ai-studio-core/managed-result-references.ts'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const managedReferencesModuleUrl = `data:text/javascript;base64,${Buffer.from(managedReferencesOutput).toString('base64')}`;
const historyPolicySource = read('src/ai-studio-core/history-policy.ts');
const historyPolicyOutput = ts.transpileModule(historyPolicySource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText.replace(
  /from\s+['"]@nimiplatform\/sdk\/types['"]/g,
  `from ${JSON.stringify(sdkTypesStubUrl)}`,
).replace(
  /from\s+['"]@nimiplatform\/sdk\/app['"]/g,
  `from ${JSON.stringify(sdkAppModuleUrl)}`,
).replace(
  /from\s+['"]\.\/audio-separation-request\.js['"]/g,
  `from ${JSON.stringify(separationRequestModuleUrl)}`,
).replace(
  /from\s+['"]\.\/managed-result-references\.js['"]/g,
  `from ${JSON.stringify(managedReferencesModuleUrl)}`,
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
  assert.equal('lastCapabilityId' in legacy.preferences, false);

  const saved = saveLabPreferences({
    ...legacy.preferences,
    historyPanel: { collapsed: false, scope: 'media', hideFailures: true },

  }, storage);
  assert.equal(saved.status.state, 'ready');

  const loaded = loadLabPreferences(storage);
  assert.deepEqual(loaded.preferences.historyPanel, { collapsed: false, scope: 'media', hideFailures: true });
  assert.equal('lastCapabilityId' in loaded.preferences, false);

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
  assert.equal('lastCapabilityId' in recovered.preferences, false);
});

test('reset removes only the preference key and leaves unrelated app state untouched', () => {
  const {
    LAB_PREFERENCES_STORAGE_KEY,
    resetLabPreferences,
  } = preferencesModule;
  const LAB_PROMPT_DRAFTS_STORAGE_KEY = 'nimiapp-lab:prompt-drafts:v1';
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

const { createStudioPromptDraftRepository } = await import(promptDraftModuleUrl);
function privateDraftOwner() {
  const documents = new Map();
  return {
    documents,
    async readJson(path) { if (!documents.has(path)) throw { reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' }; return { value: documents.get(path) }; },
    async writeJson(path, value) { documents.set(path, structuredClone(value)); },
  };
}
const promptKey = { surfaceId: 'ai-capabilities', capabilityId: 'text.generate', scenarioId: 'note' };

test('drafts use the captured owner and do not import unowned browser content', async () => {
  const a = privateDraftOwner(), b = privateDraftOwner();
  const previous = globalThis.localStorage;
  globalThis.localStorage = createStorage({ 'nimiapp-lab:prompt-drafts:v1': JSON.stringify({ schemaVersion: 1, drafts: { 'ai-capabilities:text.generate:note': 'unowned' } }) });
  try {
    const first = createStudioPromptDraftRepository(a);
    assert.deepEqual(await first.load(promptKey, true), { prompt: null });
    await first.save(promptKey, 'private A', true);
    assert.deepEqual(await createStudioPromptDraftRepository(b).load(promptKey, true), { prompt: null });
    assert.deepEqual(await createStudioPromptDraftRepository(a).load({ scenarioId: promptKey.scenarioId, surfaceId: promptKey.surfaceId, capabilityId: promptKey.capabilityId }, true), { prompt: 'private A' });
    await createStudioPromptDraftRepository(b).save(promptKey, 'private B', true);
    assert.deepEqual(await createStudioPromptDraftRepository(a).load(promptKey, true), { prompt: 'private A' });
  } finally { globalThis.localStorage = previous; }
});

test('disabled persistence keeps only this view and writes preserve input order', async () => {
  const owner = privateDraftOwner();
  const drafts = createStudioPromptDraftRepository(owner);
  await drafts.save(promptKey, 'session only', false);
  assert.equal(owner.documents.size, 0);
  assert.equal((await drafts.load(promptKey, false)).prompt, 'session only');
  assert.equal((await createStudioPromptDraftRepository(owner).load(promptKey, false)).prompt, null);
  await Promise.all([drafts.save(promptKey, 'first', true), drafts.save(promptKey, '', true)]);
  assert.equal((await createStudioPromptDraftRepository(owner).load(promptKey, true)).prompt, '');
});

test('a late persisted draft cannot replace a newer edit and storage errors stay visible', async () => {
  let finish;
  const drafts = createStudioPromptDraftRepository({ readJson: () => new Promise(resolve => { finish = resolve; }), writeJson: async () => {} });
  const loading = drafts.load(promptKey, true);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await drafts.save(promptKey, 'new edit', false);
  finish({ value: { schemaVersion: 1, prompt: 'old persisted' } });
  assert.equal((await loading).prompt, 'new edit');
  const failed = createStudioPromptDraftRepository({ readJson: async () => { throw new Error('owner unavailable'); }, writeJson: async () => { throw new Error('quota'); } });
  await assert.rejects(failed.load(promptKey, true), /owner unavailable/);
  await assert.rejects(failed.save(promptKey, 'retain in view', true), /quota/);
});
