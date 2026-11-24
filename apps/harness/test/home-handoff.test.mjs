import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NimiElectronLocalAppHostError } from '@nimiplatform/kit/shell/electron/main';
import { openHarness } from '../dist-electron/harness.js';
import { parseHomeHandoff } from '../dist-electron/home-handoff.js';
import { createSessionDrafts } from '../src/product/session-drafts.ts';

const copy = {
  format: 'nimi.home-chat.v1',
  threadId: 'sample',
  title: 'Source',
  messages: [{ role: 'user', text: 'When?' }, { role: 'assistant', text: 'Friday, 17:10.' }],
  draft: 'Unconfirmed: 19:30?',
};

test('a partial handoff retries without a duplicate, a model call or an overwritten draft', async t => {
  const namespace = randomUUID();
  const documents = new Map([['harness-namespace.json', namespace]]);
  let refusePublish = true;
  const storage = {
    async readJson(key) {
      if (!documents.has(key)) throw new NimiElectronLocalAppHostError('not-found', false);
      return { value: structuredClone(documents.get(key)) };
    },
    async writeJson(key, value) {
      if (key === 'harness-sessions.json' && value.sessions.length > 1 && refusePublish) {
        throw new Error('catalog unavailable');
      }
      documents.set(key, structuredClone(value));
      return { value };
    },
  };
  const signal = new AbortController().signal;
  const scope = { signal, client: { storage } };
  let calls = 0;
  const services = {
    storage,
    aiConfig: { async get() { return { record: { configRef: 'main', revision: '1' }, effectiveSelections: [] }; } },
    ai: { text: { streamTurn() { calls++; throw new Error('unexpected inference'); } } },
  };
  const harness = await openHarness(services, signal);
  t.after(async () => {
    await harness.close();
    await rm(join(homedir(), '.nimi-harness', namespace), { recursive: true, force: true });
  });

  const source = JSON.stringify(copy);
  await assert.rejects(harness.importHome(source), /catalog unavailable/);
  assert.equal(harness.list(0).sessions.length, 1);

  refusePublish = false;
  await harness.importHome(source);
  const view = await harness.snapshot();
  assert.deepEqual(view.entries.map(({ role, text }) => ({ role, text })), copy.messages);
  assert.ok(view.entries.every(row => row.fromHome));
  assert.equal(view.running, false);
  assert.deepEqual(view.decisions, []);

  const drafts = createSessionDrafts(scope);
  const draft = await drafts.load(view.sessionId);
  assert.equal(draft.text, copy.draft);
  drafts.put(view.sessionId, { ...draft, text: 'My own later draft' });
  await drafts.flush(view.sessionId);
  await harness.importHome(source);
  assert.equal((await harness.snapshot()).sessionId, view.sessionId);
  assert.equal(harness.list(0).sessions.length, 2);
  assert.equal((await createSessionDrafts(scope).load(view.sessionId)).text, 'My own later draft');
  assert.equal(calls, 0);
});

test('handoff accepts historical text only', () => {
  const invalidCopies = [
    { ...copy, format: 'other' },
    { ...copy, messages: [{ role: 'tool', text: 'run' }] },
    { ...copy, draft: [] },
  ];
  for (const invalid of invalidCopies) {
    assert.throws(() => parseHomeHandoff(JSON.stringify(invalid)), /Invalid/);
  }
});
