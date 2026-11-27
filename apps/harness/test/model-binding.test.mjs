import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NimiElectronLocalAppHostError } from '@nimiplatform/kit/shell/electron/main';
import { openHarness } from '../dist-electron/harness.js';

test('a missing or changed binding preserves history and requires a confirmed replacement across restarts', async () => {
  const namespace = randomUUID();
  const documents = new Map([['harness-namespace.json', namespace]]);
  const alternate = 'a'.repeat(32);
  const records = new Map([['main', '1'], [alternate, '1']]);
  const dispatched = [];
  const services = {
    storage: {
      async readJson(key) {
        if (!documents.has(key)) throw new NimiElectronLocalAppHostError('not-found', false);
        return { value: structuredClone(documents.get(key)) };
      },
      async writeJson(key, value) { documents.set(key, structuredClone(value)); return { value }; },
    },
    aiConfig: { async get(query) {
      const ref = query?.configRef ?? 'main';
      if (!records.has(ref)) throw new NimiElectronLocalAppHostError('ai-config-not-found', false);
      return { record: { configRef: ref, name: ref, revision: records.get(ref), isDefault: ref === 'main' }, effectiveSelections: [{
        capabilityContract: 'text.generate', state: 'ready',
        resource: { oneofKind: 'local', local: { label: ref, loadoutRef: 'loadout', implementation: { implementationId: 'text' }, configuredFeatures: [] } },
      }] };
    } },
    ai: { text: { async streamTurn(input) {
      if (input.configuration.expectedRevision !== records.get(input.configuration.configRef)) {
        throw new NimiElectronLocalAppHostError('ai-config-revision-conflict', false);
      }
      dispatched.push(input.configuration);
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'delta', itemIndex: 0, text: 'A stored answer.' };
          yield { type: 'completed', finishReason: 'stop', configuration: { configRef: input.configuration.configRef, revision: input.configuration.expectedRevision } };
        },
        async cancel() {},
      };
    } } },
  };
  const open = () => openHarness(services, new AbortController().signal);
  let harness = await open();
  async function send(text) {
    const request = randomUUID();
    await harness.submit('main', text, request);
    for (let i = 0; i < 100; i++) {
      if (await harness.inputStatus('main', request) === 'done') return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('input never reached done');
  }
  try {
    await send('First input');
    records.set('main', '2');
    await harness.submit('main', 'The route changed before dispatch', randomUUID());
    for (let i = 0; i < 100 && (await harness.snapshot()).failure !== 'ai-config-revision-conflict'; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const conflicted = await harness.snapshot();
    assert.equal(conflicted.failure, 'ai-config-revision-conflict');
    assert.equal(conflicted.model, undefined);
    const retry = randomUUID();
    await assert.rejects(harness.submit('main', 'Review first', retry), { code: 'HARNESS_MODEL_CHANGED' });
    assert.equal(await harness.inputStatus('main', retry), 'not-found');
    await harness.close();
    harness = await open();
    assert.equal((await harness.snapshot()).model, undefined);
    await assert.rejects(harness.submit('main', 'Stale', randomUUID()), { code: 'HARNESS_MODEL_CHANGED' });
    await harness.close();
    records.delete('main');
    harness = await open();
    const history = await harness.snapshot();
    assert.ok(history.entries.some(entry => entry.text === 'A stored answer.'));
    assert.equal(history.model, undefined);
    const obsolete = await harness.reviewModel('main', undefined, alternate);
    records.set(alternate, '2');
    await assert.rejects(harness.reviewModel('main', obsolete.confirmation, alternate), /changed again/);
    assert.equal(dispatched.length, 1);
    const next = await harness.reviewModel('main', undefined, alternate);
    await harness.reviewModel('main', next.confirmation, next.configRef);
    assert.equal((await harness.snapshot()).failure, undefined);
    await harness.close();
    harness = await open();
    assert.equal((await harness.snapshot()).configRef, alternate);
    assert.equal((await harness.snapshot()).failure, undefined);
    await send('Second input');
    assert.deepEqual(dispatched.map(guard => [guard.configRef, guard.expectedRevision]), [['main','1'],[alternate,'2']]);
  } finally {
    await harness.close();
    await rm(join(homedir(), '.nimi-harness', namespace), { recursive: true, force: true });
  }
});
