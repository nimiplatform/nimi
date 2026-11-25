import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NimiElectronLocalAppHostError } from '@nimiplatform/kit/shell/electron/main';
import { openHarness } from '../dist-electron/harness.js';
import { isInsideWorkspace, previewWorkspaceFile } from '../dist-electron/workspace-files.js';

function createMockEnv(namespace, streamTurnImpl) {
  const documents = new Map([['harness-namespace.json', namespace]]);
  const activities = [];
  const assets = new Map();
  const services = {
    storage: {
      async readJson(key) {
        if (!documents.has(key)) throw new NimiElectronLocalAppHostError('not-found', false);
        return { value: structuredClone(documents.get(key)) };
      },
      async writeJson(key, value) {
        documents.set(key, structuredClone(value));
        return { value };
      },
      assets: {
        async write({ relativePath, mediaType, body }) {
          const chunks = [];
          for await (const chunk of body) chunks.push(Buffer.from(chunk));
          const buf = Buffer.concat(chunks);
          const record = { relativePath, mediaType, sizeBytes: buf.length, sha256: 'sha256:test', bytes: buf };
          assets.set(relativePath, record);
          return record;
        },
        async stat(relativePath) {
          const rec = assets.get(relativePath);
          if (!rec) throw new Error('Asset not found');
          return rec;
        },
      },
    },
    activity: {
      async put(entry) {
        activities.push(entry);
        return { record: entry, changed: true };
      },
    },
    integration: {
      async listCatalog() {
        return [{
          available: true,
          integrationId: 'mcp.notes',
          targetRef: 'notes-1',
          displayName: 'Notes',
          permittedOperations: ['notes.read', 'notes.write'],
          operations: [
            { name: 'notes.read', displayName: 'Read note', description: 'Read a note', effect: 'read', inputSchemaJson: '{"type":"object"}' },
            { name: 'notes.write', displayName: 'Write note', description: 'Update a note', effect: 'write', inputSchemaJson: '{"type":"object"}' },
          ],
        }];
      },
    },
    aiConfig: {
      async get() {
        return {
          record: { configRef: 'main', name: 'Default', revision: '1', isDefault: true },
          effectiveSelections: [{
            capabilityContract: 'text.generate',
            state: 'ready',
            contextWindowTokens: 32768,
            reasoningInput: {
              followsModelDefault: true,
              supportsDisabled: true,
              supportsRequired: true,
              supportsAdaptive: true,
              efforts: ['low', 'medium', 'high'],
              supportsBudget: false,
              presentations: ['summary', 'hidden'],
            },
            resource: {
              oneofKind: 'local',
              local: {
                label: 'Test Reasoning Model',
                loadoutRef: 'loadout-r',
                implementation: { implementationId: 'test-r' },
                configuredFeatures: [],
              },
            },
          }],
        };
      },
    },
    ai: { text: { streamTurn: streamTurnImpl } },
  };
  return { services, activities, assets };
}

async function waitFor(harness, predicate, limit = 250) {
  let last;
  for (let i = 0; i < limit; i++) {
    const view = await harness.snapshot();
    last = view;
    if (predicate(view)) return view;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Condition not reached: ${JSON.stringify(last)}`);
}

test('local workspace binding, expanded previews, containment, and safe delete preserve user folders', async t => {
  const namespace = randomUUID();
  const folder = join(homedir(), '.nimi-harness', namespace);
  const userProject = await mkdtemp(join(tmpdir(), 'harness-user-project-'));
  const outsideDir = await mkdtemp(join(tmpdir(), 'harness-outside-'));
  let harness;
  t.after(async () => {
    await harness?.close();
    await rm(folder, { recursive: true, force: true });
    await rm(userProject, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  await writeFile(join(userProject, 'App.tsx'), 'export const App = () => <div/>;\n');
  await writeFile(join(userProject, '.gitignore'), 'node_modules/\n');
  await writeFile(join(outsideDir, 'secret.txt'), 'outside');
  if (process.platform !== 'win32') {
    await symlink(outsideDir, join(userProject, 'escape-dir'));
  }

  // Expanded text previews & containment checks
  const tsxPreview = await previewWorkspaceFile(userProject, 'App.tsx', new AbortController().signal);
  assert.equal(tsxPreview.format, 'text');
  assert.match(tsxPreview.content, /export const App/);
  const gitignorePreview = await previewWorkspaceFile(userProject, '.gitignore', new AbortController().signal);
  assert.equal(gitignorePreview.format, 'text');
  assert.match(gitignorePreview.content, /node_modules/);

  assert.equal(await isInsideWorkspace(userProject, 'src/new-file.ts'), true);
  assert.equal(await isInsideWorkspace(userProject, '../secret.txt'), false);
  if (process.platform !== 'win32') {
    assert.equal(await isInsideWorkspace(userProject, 'escape-dir/secret.txt'), false);
  }

  const { services } = createMockEnv(namespace, async input => {
    const lastUser = input.messages.findLastIndex(m => m.role === 'user');
    const done = input.messages.slice(lastUser + 1).some(m => m.turnItems?.some(item => item.type === 'tool-result'));
    return {
      async *[Symbol.asyncIterator]() {
        if (!done) {
          yield { type: 'tool-call', itemIndex: 0, toolCall: { id: randomUUID(), name: 'write', arguments: { path: 'created.txt', content: 'bound-ok' } } };
          yield { type: 'completed', finishReason: 'tool-calls' };
        } else {
          yield { type: 'delta', itemIndex: 0, text: 'Done in local project.' };
          yield { type: 'completed', finishReason: 'stop' };
        }
      },
      async cancel() {},
    };
  });

  harness = await openHarness(services, new AbortController().signal);

  await harness.create(undefined, userProject);
  const created = await harness.snapshot();
  assert.ok(created.workspaceDir);
  assert.ok(created.workspaceLabel);
  await harness.setPermissionMode(created.sessionId, 'workspace-edit');
  await harness.submit(created.sessionId, 'Create file', randomUUID());
  await waitFor(harness, v => !v.running && v.entries.some(e => e.text === 'Done in local project.'));
  assert.equal(await readFile(join(userProject, 'created.txt'), 'utf8'), 'bound-ok');

  // Deleting a session with a bound local folder MUST NOT delete the user's folder!
  await harness.deleteSession(created.sessionId);
  assert.equal(await readFile(join(userProject, 'created.txt'), 'utf8'), 'bound-ok');
  assert.equal(await readFile(join(userProject, 'App.tsx'), 'utf8'), 'export const App = () => <div/>;\n');
});

test('permission modes (strict, workspace-edit, plan-readonly), session allowlist, reasoning effort, activity, history, and export', async t => {
  const namespace = randomUUID();
  const folder = join(homedir(), '.nimi-harness', namespace);
  const outsideFile = join(tmpdir(), `harness-outside-${randomUUID()}.txt`);
  let harness;
  t.after(async () => {
    await harness?.close();
    await rm(folder, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  });

  const observedInputs = [];
  const planTools = {
    'plan-write': { name: 'write', arguments: { path: 'blocked.txt', content: 'x' } },
    'plan-open': { name: 'open_attachment', arguments: { id: randomUUID() } },
    'share-second': { name: 'share_result_file', arguments: { filename: 'second.txt' } },
    'plan-share': { name: 'share_result_file', arguments: { filename: 'result.txt' } },
  };
  const { services, activities } = createMockEnv(namespace, async input => {
    observedInputs.push(input);
    const lastUser = input.messages.findLastIndex(m => m.role === 'user');
    const prompt = input.messages[lastUser].text;
    const toolResults = input.messages.slice(lastUser + 1).flatMap(m => (m.turnItems ?? []).filter(item => item.type === 'tool-result'));
    return {
      async *[Symbol.asyncIterator]() {
        if (toolResults.length === 0) {
          yield { type: 'reasoning-summary', itemIndex: 0, text: 'Planning the requested step.' };
          if (prompt === 'write-inside') {
            yield { type: 'tool-call', itemIndex: 1, toolCall: { id: randomUUID(), name: 'write', arguments: { path: 'inside.txt', content: 'hello' } } };
            yield { type: 'completed', finishReason: 'tool-calls' };
            return;
          }
          if (prompt === 'write-outside') {
            yield { type: 'tool-call', itemIndex: 1, toolCall: { id: randomUUID(), name: 'write', arguments: { path: outsideFile, content: 'nope' } } };
            yield { type: 'completed', finishReason: 'tool-calls' };
            return;
          }
          if (prompt === 'write-control-plane') {
            yield { type: 'tool-call', itemIndex: 1, toolCall: { id: randomUUID(), name: 'write', arguments: { path: 'package.json', content: '{"scripts":{"test":"echo hi"}}' } } };
            yield { type: 'completed', finishReason: 'tool-calls' };
            return;
          }
          if (Object.hasOwn(planTools, prompt)) {
            yield { type: 'tool-call', itemIndex: 1, toolCall: { id: randomUUID(), ...planTools[prompt] } };
            yield { type: 'completed', finishReason: 'tool-calls' };
            return;
          }
          if (prompt === 'bash-echo') {
            yield { type: 'tool-call', itemIndex: 1, toolCall: { id: randomUUID(), name: 'bash', arguments: { command: 'echo allowlist-ok' } } };
            yield { type: 'completed', finishReason: 'tool-calls' };
            return;
          }
        }
        yield { type: 'delta', itemIndex: 0, text: `Finished ${prompt}` };
        yield { type: 'completed', finishReason: 'stop', usage: { promptTokens: 42, completionTokens: 11, totalTokens: 53 } };
      },
      async cancel() {},
    };
  });

  harness = await openHarness(services, new AbortController().signal);

  // 1. Reasoning choices & effort pass-through
  const initial = await harness.snapshot();
  assert.deepEqual(initial.reasoningChoices.map(c => c.value), ['default', 'off', 'low', 'medium', 'high']);
  await harness.setReasoningEffort('main', 'high');
  await harness.pinSession('main', true);
  assert.equal((await harness.snapshot()).reasoningEffort, 'high');
  assert.equal((await harness.snapshot()).sessions.find(s => s.id === 'main').pinned, true);

  // 2. Plan Read-Only blocks file mutations without parking
  await harness.setPermissionMode('main', 'plan-readonly');
  for (const [prompt, { name }] of Object.entries(planTools)) {
    await harness.submit('main', prompt, randomUUID());
    const planDone = await waitFor(harness, v => v.decisions.length > 0 ||
      (!v.running && v.entries.some(e => e.text === `Finished ${prompt}`)));
    assert.equal(planDone.decisions.length, 0);
    assert.ok(planDone.entries.some(e => e.toolFailure === 'blocked' && e.text.includes(`Plan Read-Only mode: "${name}"`)));
  }
  assert.deepEqual(observedInputs[0].reasoning, { activation: 'adaptive', effort: 'high', presentation: 'summary' });
  // Thinking + toolCalls projected in snapshot
  assert.ok((await harness.snapshot()).entries.some(e => e.role === 'assistant' && e.thinking === 'Planning the requested step.' && e.toolCalls?.length === 1));

  await harness.setPermissionMode('main', 'strict');
  for (const [prompt, filename] of [['plan-share', 'result.txt'], ['share-second', 'second.txt']]) {
    await writeFile(join(initial.workspace, filename), 'acceptance result');
    await harness.submit('main', prompt, randomUUID());
    const view = await waitFor(harness, v => v.decisions.length === 1);
    const card = view.decisions[0];
    assert.equal(card.name, 'share_result_file');
    assert.equal(card.allowSessionPermitted, false);
    await harness.decide('main', card.id, true, undefined, true, card.revision);
    await waitFor(harness, v => !v.running && v.decisions.length === 0);
    assert.deepEqual((await harness.snapshot()).sessionAllowlist, []);
  }

  // 3. Workspace Auto-Edit auto-approves in-workspace write, but still asks approval for out-of-workspace write!
  await harness.setPermissionMode('main', 'workspace-edit');
  await harness.submit('main', 'write-inside', randomUUID());
  await waitFor(harness, v => !v.running && v.entries.some(e => e.text === 'Finished write-inside'));
  assert.equal(await readFile(join(initial.workspace, 'inside.txt'), 'utf8'), 'hello');

  // v2.1 Gate 2: Out-of-workspace writes are hard-blocked (never allowed via approval).
  await harness.submit('main', 'write-outside', randomUUID());
  const outsideBlocked = await waitFor(harness, v => !v.running && v.entries.some(e => e.text === 'Finished write-outside'));
  assert.equal(outsideBlocked.decisions.length, 0);
  assert.ok(outsideBlocked.entries.some(e => e.toolFailure === 'blocked' && e.text.includes('escapes the active workspace root')));

  // v2.1 Gate 3: Control-plane files (package.json) still require explicit allow_once approval even in workspace-edit mode!
  await harness.submit('main', 'write-control-plane', randomUUID());
  const cpDecision = await waitFor(harness, v => v.decisions.length === 1);
  assert.equal(cpDecision.decisions[0].name, 'write');
  assert.equal(cpDecision.decisions[0].isControlPlane, true);
  assert.equal(cpDecision.decisions[0].allowSessionPermitted, false);
  // Automatic Home Activity must have fired with attention: true!
  assert.ok(activities.some(a => a.attention === true && a.objectRef === 'session:main'));
  await harness.decide('main', cpDecision.decisions[0].id, false, 'Keep package.json scripts untouched', false, cpDecision.decisions[0].revision);
  await waitFor(harness, v => !v.running && v.entries.some(e => e.text === 'Finished write-control-plane'));
  assert.ok(activities.some(a => a.attention === false && a.objectRef === 'session:main'));

  // 4. v2.1 Gate 4: Free Shell (bash) is NEVER permitted in sessionAllowlist (always allow_once)!
  if (process.platform !== 'win32') {
    await harness.setPermissionMode('main', 'strict');
    await harness.submit('main', 'bash-echo', randomUUID());
    const bashPrompt = await waitFor(harness, v => v.decisions.length === 1);
    assert.equal(bashPrompt.decisions[0].allowSessionPermitted, false);
    await harness.decide('main', bashPrompt.decisions[0].id, true, undefined, true, bashPrompt.decisions[0].revision);
    await waitFor(harness, v => !v.running && v.entries.filter(e => e.text === 'Finished bash-echo').length === 1);
    assert.deepEqual((await harness.snapshot()).sessionAllowlist, []);
  }

  // 5. Remote protocol helpers: getHistory pagination, listDetailed, outgoingWorkspaceFile, exportMarkdown, listIntegrations
  const page1 = await harness.getHistory('main', 0, 3);
  assert.equal(page1.entries.length, 3);
  assert.ok(page1.nextCursor !== null);
  const page2 = await harness.getHistory('main', page1.nextCursor, 50);
  assert.ok(page2.entries.length > 0);
  assert.equal(page2.nextCursor, null);

  const detailed = harness.listDetailed(0);
  assert.equal(detailed.sessions[0].id, 'main');
  assert.equal(detailed.sessions[0].status, 'idle');

  const published = await harness.outgoingWorkspaceFile('main', 'inside.txt');
  assert.equal(published.name, 'inside.txt');
  assert.ok(published.fileId);

  const md = await harness.exportMarkdown('main');
  assert.match(md, /# First session/);
  assert.match(md, /Finished write-inside/);

  const integrations = await harness.listIntegrations();
  assert.equal(integrations.length, 1);
  assert.deepEqual(integrations[0].operations.map(o => o.effect), ['read', 'write']);
});

test('agent purge waits for a pending first submission before acknowledging its catalog deletion', async t => {
  const root = await mkdtemp(join(tmpdir(), 'harness-purge-submit-'));
  const { services } = createMockEnv(randomUUID(), () => { throw new Error('unexpected model call'); });
  const started = Promise.withResolvers();
  const reply = Promise.withResolvers();
  const sessionClient = { async routeAndSubmitInput() { started.resolve(); return reply.promise; } };
  const symbiosis = {
    isRunning: () => true,
    isReadyForProjections: () => false,
    getEffectiveContextBudgetTokens: () => 64000,
    getAgentSessionClient: () => sessionClient,
  };
  const harness = await openHarness(services, new AbortController().signal, undefined, { dataRoot: root, requireSymbiosis: true });
  t.after(async () => { await harness.close(); await rm(root, { recursive: true, force: true }); });
  await harness.attachSymbiosis(symbiosis, 'binding', 'partner', 'Partner');
  const submit = harness.submit('main', 'Draft a note', randomUUID());
  await started.promise;
  let acknowledged = false;
  const purge = harness.handleBodyPurgeAgent('binding').then(() => { acknowledged = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(acknowledged, false);
  reply.resolve({ resolvedWorkSessionRef: 'ws-test', outboxId: 'intent', workSessionRecord: { agentBinding: 'binding' } });
  await submit;
  await purge;
  assert.equal(await harness.selectByWorkSessionRef('ws-test'), false);
});
