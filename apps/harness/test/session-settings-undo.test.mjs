import assert from 'node:assert/strict';
import test from 'node:test';
import { getNimiToastSnapshot, nimiToast } from '@nimiplatform/kit/ui';
import {
  deleteInstructionPresetOptimistically,
  INSTRUCTION_PRESETS_KEY,
  LEGACY_REUSABLE_INSTRUCTIONS_KEY,
  presetsForScope,
} from '../src/product/session-presets.ts';

const reviewer = { id: 'a', name: 'Code Reviewer', text: 'Review carefully' };
const concise = { id: 'b', name: 'Concise', text: 'Keep answers short' };
const writer = { id: 'c', name: 'Writer', text: 'Write a draft' };

function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}

const afterWrites = () => new Promise(resolve => setImmediate(resolve));

async function openPresets(t, beforeWrite = async () => {}) {
  nimiToast.clear();
  t.after(() => nimiToast.clear());
  const docs = new Map([[INSTRUCTION_PRESETS_KEY, [reviewer, concise]]]);
  let writes = 0;
  const scope = {
    signal: new AbortController().signal,
    client: { storage: {
      async readJson(key) { return { value: structuredClone(docs.get(key)) }; },
      async writeJson(key, value) {
        if (key === INSTRUCTION_PRESETS_KEY) await beforeWrite(++writes);
        docs.set(key, structuredClone(value));
      },
      async removeJson(key) { docs.delete(key); },
    } },
  };
  const store = presetsForScope(scope);
  await store.load();
  const errors = [];
  function remove(preset) {
    const id = deleteInstructionPresetOptimistically({
      scope, preset,
      message: 'Removed ' + preset.name,
      undoLabel: 'Undo',
      onError: message => errors.push(message),
    });
    const toast = getNimiToastSnapshot().find(item => item.id === id);
    assert.equal(toast?.message, 'Removed ' + preset.name);
    assert.equal(toast?.action?.label, 'Undo');
    return toast.action.onClick;
  }
  return { store, docs, remove, errors };
}

test('deleting and undoing a preset update the visible list while storage is pending', async t => {
  const firstWrite = deferred();
  const { store, docs, remove, errors } = await openPresets(t, n => n === 1 ? firstWrite.promise : undefined);
  const undo = remove(reviewer);
  assert.deepEqual(store.getSnapshot(), [concise]);
  undo();
  assert.deepEqual(store.getSnapshot(), [reviewer, concise]);
  firstWrite.resolve();
  await afterWrites();
  assert.deepEqual(errors, []);
  assert.deepEqual(docs.get(INSTRUCTION_PRESETS_KEY), [reviewer, concise]);
  assert.equal(docs.get(LEGACY_REUSABLE_INSTRUCTIONS_KEY), reviewer.text);
});

test('a failed delete restores the saved preset and dismisses its Undo action', async t => {
  const { store, docs, remove, errors } = await openPresets(t, () => { throw new Error('storage-offline'); });
  remove(reviewer);
  assert.deepEqual(store.getSnapshot(), [concise]);
  await afterWrites();
  assert.deepEqual(store.getSnapshot(), [reviewer, concise]);
  assert.deepEqual(store.getSnapshot(), docs.get(INSTRUCTION_PRESETS_KEY));
  assert.deepEqual(errors, ['storage-offline']);
  assert.equal(getNimiToastSnapshot().length, 0);
});

test('undo during a new preset write keeps both changes in the visible and saved list', async t => {
  const started = deferred();
  const finish = deferred();
  const { store, docs, remove, errors } = await openPresets(t, async n => {
    if (n === 2) { started.resolve(); await finish.promise; }
  });
  const undo = remove(reviewer);
  const added = store.add(writer);
  await started.promise;
  undo();
  const expected = [writer, reviewer, concise];
  assert.deepEqual(store.getSnapshot(), expected);
  finish.resolve();
  await added;
  await afterWrites();
  assert.deepEqual(errors, []);
  assert.deepEqual(store.getSnapshot(), expected);
  assert.deepEqual(docs.get(INSTRUCTION_PRESETS_KEY), expected);
  assert.equal(docs.get(LEGACY_REUSABLE_INSTRUCTIONS_KEY), writer.text);
});

test('a failed Undo leaves the saved deletion intact and preserves a later addition', async t => {
  const { store, docs, remove, errors } = await openPresets(t, n => {
    if (n === 2) throw new Error('restore-failed');
  });
  const undo = remove(reviewer);
  undo();
  assert.deepEqual(store.getSnapshot(), [reviewer, concise]);
  await store.add(writer);
  assert.deepEqual(errors, ['restore-failed']);
  assert.deepEqual(store.getSnapshot(), [writer, concise]);
  assert.deepEqual(docs.get(INSTRUCTION_PRESETS_KEY), [writer, concise]);
});

test('independent Undo actions retain the order of adjacent deleted presets', async t => {
  const { store, docs, remove } = await openPresets(t);
  const undoConcise = remove(concise);
  const undoReviewer = remove(reviewer);
  undoConcise();
  undoReviewer();
  await afterWrites();
  assert.deepEqual(store.getSnapshot(), [reviewer, concise]);
  assert.deepEqual(docs.get(INSTRUCTION_PRESETS_KEY), [reviewer, concise]);
});
