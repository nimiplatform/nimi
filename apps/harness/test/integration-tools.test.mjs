import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationTools } from '../dist-electron/integration-tools.js';
import { progressText, textPreview } from '../dist-electron/text-preview.js';

function setup() {
  const source = { available: true, integrationId: 'mcp', targetRef: 'approved', displayName: 'Documents',
    permittedOperations: ['document.read', 'document.update'], operations: [
      { name: 'document.read', effect: 'read', description: 'Read a document', inputSchemaJson: '{"type":"object"}' },
      { name: 'document.update', effect: 'write', description: 'Change a document', inputSchemaJson: '{"type":"object"}' },
      { name: 'document.private', effect: 'read', description: 'Unavailable document', inputSchemaJson: '{"type":"object"}' },
    ] };
  const calls = [];
  const client = { async listCatalog() { return [source]; },
    async invoke(input) { calls.push(input); return { callId: 'a', status: 'accepted', resultJson: '' }; },
    async getCall() { return { callId: 'a', status: 'completed', resultJson: '{"text":"ok"}' }; },
  };
  const tools = integrationTools(client, new AbortController().signal).tools;
  const run = (name, input) => tools.find(tool => tool.name === name).execute(input, {}, {});
  return { source, client, calls, run };
}

test('discovery and dispatch use current read grants, and receipts never resubmit', async () => {
  const { source, calls, run, client } = setup();
  const found = await run('find_nimi_reads', { query: 'Document' });
  assert.deepEqual(JSON.parse(found.output[0].text).items.map(op => op.operation), ['document.read']);
  const args = { targetRef: 'approved', operation: 'document.read', input: { key: 'a' } };
  const result = await run('read_nimi_integration', args);
  assert.deepEqual(result.details, { callId: 'a', status: 'completed' });
  assert.equal(JSON.parse(result.output[0].text).resultText, '{"text":"ok"}');
  await assert.rejects(run('read_nimi_integration', { ...args, operation: 'document.update' }), /unavailable/);
  source.permittedOperations = [];
  await assert.rejects(run('read_nimi_integration', args), /unavailable/);
  client.getCall = async () => ({ callId: 'a', status: 'unconfirmed', errorCode: 'EXECUTOR_RESTARTED' });
  assert.deepEqual(JSON.parse((await run('read_nimi_receipt', {callId:'a'})).output[0].text), { callId:'a', status:'unconfirmed', errorCode:'EXECUTOR_RESTARTED' });
  assert.equal(calls.length, 1);
});

test('lost observation preserves the admitted receipt and large results keep valid Unicode', async () => {
  const { run, client, calls } = setup();
  client.getCall = async () => { throw Error('connection ended'); };
  const result = await run('read_nimi_integration', { targetRef: 'approved', operation: 'document.read', input: {} });
  assert.deepEqual(JSON.parse(result.output[0].text), { callId: 'a', status: 'accepted', observation: 'unavailable' });
  assert.equal(calls.length, 1);
  const prefix = '🌙'.repeat(16384);
  assert.deepEqual(textPreview(prefix + 'x'), { text: prefix, truncated: true });
  assert.deepEqual(textPreview(prefix), { text: prefix, truncated: false });
});

test('a full progress preview continues moving and preserves complete Unicode characters', () => {
  const text = '😀'.repeat(8192);
  assert.deepEqual(progressText(text), { text, truncated: false });
  assert.deepEqual(progressText('prefix' + text + '!'), { text: '😀'.repeat(8191) + '!', truncated: true });
  assert.deepEqual(progressText(text + 'Z'), { text: '😀'.repeat(8191) + 'Z', truncated: true });
});

test('find_nimi_integrations and invoke_nimi_integration support granted writes with honest uncertain receipts', async () => {
  const { source, client, calls, run } = setup();
  const allFound = await run('find_nimi_integrations', {});
  const items = JSON.parse(allFound.output[0].text).items;
  assert.deepEqual(items.map(op => [op.operation, op.effect]), [
    ['document.read', 'read'],
    ['document.update', 'write'],
  ]);

  const writesOnly = await run('find_nimi_integrations', { effect: 'write' });
  assert.deepEqual(JSON.parse(writesOnly.output[0].text).items.map(op => op.operation), ['document.update']);

  // Uncertain write (unconfirmed) returns honest receipt and never resubmits
  client.getCall = async () => ({ callId: 'a', status: 'unconfirmed', errorCode: 'NETWORK_LOST' });
  const writeResult = await run('invoke_nimi_integration', { targetRef: 'approved', operation: 'document.update', input: { title: 'Updated' } });
  assert.deepEqual(JSON.parse(writeResult.output[0].text), { callId: 'a', status: 'unconfirmed', errorCode: 'NETWORK_LOST' });
  assert.equal(calls.length, 1);

  // Revoked operation is rejected cleanly
  source.permittedOperations = ['document.read'];
  await assert.rejects(run('invoke_nimi_integration', { targetRef: 'approved', operation: 'document.update', input: {} }), /unavailable/);
  assert.equal(calls.length, 1);
});
