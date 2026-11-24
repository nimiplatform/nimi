import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionDrafts, emptyDraft } from '../src/product/session-drafts.ts';

test('using an existing file keeps the latest text and one reference across reloads', async () => {
  let saved;
  const scope = { signal: new AbortController().signal, client: { storage: {
    async writeJson(_key, value) { saved = structuredClone(value); },
    async readJson() { return { value: saved }; },
  } } };
  const drafts = createSessionDrafts(scope);
  const initial = emptyDraft();
  drafts.put('review', initial);
  const file = { name: 'brief.md', ref: 'work/brief.md' };
  const changes = [];
  const unsubscribe = drafts.subscribe(() => changes.push(drafts.current('review')));
  const attaching = drafts.attach('review', file);
  drafts.put('review', { ...initial, text: 'Check the date' });
  await attaching;
  const attached = drafts.current('review');
  assert.equal(attached.text, 'Check the date');
  assert.notEqual(attached.requestId, initial.requestId);
  assert.deepEqual(attached.files, [file]);
  await drafts.attach('review', file);
  assert.equal(drafts.current('review'), attached);
  assert.equal(changes.at(-1), attached);
  unsubscribe();
  assert.deepEqual(await createSessionDrafts(scope).load('review'), attached);
});

test('returning to a session restores its own attached draft and its retry ID, including after reload', async () => {
  const docs = new Map();
  const scope = { signal: new AbortController().signal, client: { storage: {
    async writeJson(path, value) { docs.set(path, structuredClone(value)); },
    async readJson(path) { return { value: docs.get(path) }; },
  } } };
  const a = createSessionDrafts(scope);
  const seed = { ...emptyDraft(), text: 'to revise', files: [{ name: 'brief.txt', ref: 'material-abc/brief.txt' }] };
  const bDraft = { ...emptyDraft(), text: 'second task' };
  a.put('one', seed); const writing = a.flush('one');
  const revised = { ...seed, text: 'final draft' };
  a.put('one', revised); a.put('two', bDraft);
  await Promise.all([writing, a.flush('one'), a.flush('two')]);
  const reopened = createSessionDrafts(scope);
  assert.deepEqual(await reopened.load('two'), bDraft);
  assert.deepEqual(await reopened.load('one'), revised);
});
