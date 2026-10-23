// Execute the actual Explore handler and materialization helper with isolated owner fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const ts = require('typescript');
const { createStore } = require('zustand/vanilla');
const renderer = path.join(root, 'apps/desktop/src/shell/renderer');
const load = (name) => import(pathToFileURL(path.join(renderer, name)).href);
const { ensureCharacterSourceMaterialized, confirmCharacterSourceMaterialized, CharacterSourceConfirmationPendingError } = await load('features/relationship/character-source-launch-target.ts');
const { characterSourceRefKey, describeCharacterPrimaryAction, characterSourceMaterializationFailureMessage } = await load('features/explore/character-source-materialization.ts');
const { localAgentListQueryKey } = await load('features/agents/local-agent-list-model.ts');
const { captureAccountActionScope } = await load('app-shell/providers/account-action-scope.ts');

function loadHandler(env) {
  const file = path.join(renderer, 'features/explore/explore-panel.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'onPersonaSourceManage') initializer = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer);
  const emitted = ts.transpileModule(`const handler = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(env), `${emitted}\nreturn handler;`)(...Object.values(env));
}

function harness({ pauseAt, failConfirmation = false, failRefresh = false, target = { agentHandle: 'handle-1', conversationAnchorId: 'anchor-1' } } = {}) {
  const sourceRef = { kind: 'personaCharacter', id: 'persona-1', worldId: 'world-1', ownerAccountId: 'author-1', sourceHash: 'a'.repeat(64) };
  const source = { id: sourceRef.id, name: 'Partner', handle: 'partner', bio: null, sourceRef, sourceState: 'source_materialization_available' };
  const auth = { status: 'authenticated', user: { id: 'account-A' } };
  const realmBaseUrl = 'https://realm-a.example';
  const store = createStore(() => ({ auth, runtimeDefaults: { realm: { realmBaseUrl } } }));
  const mounted = { current: true };
  let release, reached;
  const blocked = new Promise((resolve) => { release = resolve; });
  const paused = new Promise((resolve) => { reached = resolve; });
  let held = false;
  const hold = async (phase) => { if (!held && phase === pauseAt) { held = true; reached(); await blocked; } };
  let created = false;
  let states = {};
  const events = [];
  const feedback = [];
  const projection = { ownerUserId: 'account-A', localAgentRef: 'local-agent:runtime-0123456789abcdef0123456789abcdef', sourceKind: sourceRef.kind, sourceWorldId: sourceRef.worldId, sourceId: sourceRef.id, sourceHash: sourceRef.sourceHash };
  const sdk = {
    runtimeAgentDiscovery: () => ({ discoverLocalAgentsBySource: async () => {
      events.push('discover');
      await hold('discover');
      if (created && failConfirmation) { failConfirmation = false; throw new Error('owner read unavailable'); }
      return created ? [projection] : [];
    } }),
    accountProduct: () => ({ materializeRealmSource: async () => {
      events.push('materialize'); created = true;
      await hold('materialize');
      return { localAgentRef: projection.localAgentRef, idempotentReplay: false };
    } }),
  };
  const handler = loadHandler({
    useCallback: (callback) => callback,
    appStore: store, mounted, ownerUserId: 'account-A', realmBaseUrl, captureAccountActionScope,
    sourceActionsInFlight: { current: new Set() },
    setSourceActionStates: (update) => { states = update(states); },
    i18n: { t: (_key, options) => options?.defaultValue ?? _key }, bindings: { sdk },
    queryClient: { invalidateQueries: async (_filter, options) => {
      assert.equal(options.throwOnError, true);
      events.push('refresh');
      await hold('refresh');
      if (failRefresh) { failRefresh = false; throw new Error('list refresh unavailable'); }
    } },
    navigation: { push: () => events.push('navigate') }, setAgentConversationTargetSnapshot: () => {},
    characterSourceRefKey, describeCharacterPrimaryAction, characterSourceMaterializationFailureMessage,
    ensureCharacterSourceMaterialized, confirmCharacterSourceMaterialized, CharacterSourceConfirmationPendingError,
    localAgentListQueryKey,
    resolveAgentTargetSnapshotForSourceRef: async () => { events.push('resolve-conversation'); await hold('resolve-conversation'); return target; },
    launchAgentConversationFromDisplay: async () => events.push('launch-conversation'),
    setFeedback: (item) => feedback.push(item), logRendererEvent: () => {},
  });
  return { source, handler, events, feedback, state: () => states[`${realmBaseUrl}:account-A:${characterSourceRefKey(sourceRef)}`], paused, release, mounted,
    project: (status, accountId = 'account-A') => store.setState({ auth: { status, user: accountId ? { id: accountId } : null, sequence: String(Number(store.getState().auth.sequence ?? '0') + 1) } }),
    switchRealm: () => store.setState({ runtimeDefaults: { realm: { realmBaseUrl: 'https://realm-b.example' } } }) };
}

test('Become my partner confirms the write and refreshes lists without opening a Conversation', async () => {
  const h = harness();
  await h.handler(h.source);
  assert.deepEqual(h.events, ['discover', 'materialize', 'discover', 'refresh', 'refresh', 'refresh']);
  assert.deepEqual(h.feedback.map((item) => item.kind), ['success']);
  assert.equal(h.state(), undefined);
});

test('Open partner revalidates an existing target and never materializes a replacement', async () => {
  const h = harness();
  await h.handler({ ...h.source, sourceState: 'local_agent_available' });
  assert.deepEqual(h.events, ['resolve-conversation', 'launch-conversation']);
  assert.deepEqual(h.feedback, []);
  const missing = harness({ target: null });
  await missing.handler({ ...missing.source, sourceState: 'local_agent_available' });
  assert.deepEqual(missing.events, ['resolve-conversation']);
  assert.deepEqual(missing.feedback.map((item) => item.kind), ['error']);
});

for (const failure of ['failConfirmation', 'failRefresh']) {
  test(`a committed partner with ${failure} offers read-only retry without another write`, async () => {
    const h = harness({ [failure]: true });
    await h.handler(h.source);
    assert.equal(h.state(), 'refresh');
    assert.deepEqual(h.feedback.map((item) => item.kind), ['warning']);
    assert.equal(h.events.filter((item) => item === 'materialize').length, 1);
    await h.handler({ ...h.source, materializationActionState: h.state() });
    assert.equal(h.events.filter((item) => item === 'materialize').length, 1);
    assert.equal(h.events.some((item) => item.includes('conversation') || item === 'navigate'), false);
    assert.deepEqual(h.feedback.map((item) => item.kind), ['warning', 'success']);
    assert.equal(h.state(), undefined);
  });
}

test('disabled source states cannot dispatch creation or Conversation calls', async () => {
  const h = harness();
  for (const sourceState of ['runtime_agent_inventory_pending', 'runtime_agent_inventory_unavailable', 'local_agent_ambiguous', 'source_materialization_unavailable']) {
    await h.handler({ ...h.source, sourceState });
  }
  assert.deepEqual(h.events, []);
});

for (const phase of ['discover', 'materialize', 'refresh', 'resolve-conversation']) {
  test('same-account token refresh during ' + phase + ' cannot leave the source action running', async () => {
    const h = harness({ pauseAt: phase });
    const pending = h.handler({ ...h.source, ...(phase === 'resolve-conversation' ? { sourceState: 'local_agent_available' } : {}) });
    await h.paused;
    assert.equal(h.state(), 'running');
    h.project('refresh-pending');
    h.project('authenticated');
    h.release();
    await pending;
    assert.equal(h.state(), undefined);
    assert.equal(h.events.filter(e => e === 'materialize').length, phase === 'resolve-conversation' ? 0 : 1);
    assert.equal(h.events.filter(e => e === 'launch-conversation').length, phase === 'resolve-conversation' ? 1 : 0);
  });
}
for (const transition of ['logout-return', 'switch-return', 'realm-change']) {
  test('a genuine ' + transition + ' cancels the old source operation without reviving it', async () => {
    const h = harness({ pauseAt: 'discover' });
    const pending = h.handler(h.source);
    await h.paused;
    if (transition === 'realm-change') h.switchRealm();
    else { h.project(transition === 'logout-return' ? 'anonymous' : 'authenticated', transition === 'logout-return' ? null : 'account-B'); h.project('authenticated'); }
    h.release(); await pending;
    assert.equal(h.state(), undefined);
    assert.equal(h.events.includes('materialize'), false);
    assert.deepEqual(h.feedback, []);
  });
}
test('confirmation failure during normal refresh retains read-only recovery and never creates twice', async () => {
  const h = harness({ pauseAt: 'materialize', failConfirmation: true });
  const pending = h.handler(h.source);
  await h.paused; h.project('refresh-pending'); h.release(); await pending;
  assert.equal(h.state(), 'refresh');
  assert.equal(h.events.filter(e => e === 'materialize').length, 1);
  h.project('authenticated');
  await h.handler({ ...h.source, materializationActionState: h.state() });
  assert.equal(h.state(), undefined);
  assert.equal(h.events.filter(e => e === 'materialize').length, 1);
});
