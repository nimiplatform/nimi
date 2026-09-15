// Exercise the actual panel action, source helper and SDK session binding.
// Owner endpoints are isolated fixtures; no real account is read or changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const ts = require('typescript');
const renderer = path.join(root, 'apps/desktop/src/shell/renderer');
const load = (p) => import(pathToFileURL(path.join(renderer, p)).href);
const { ensureCharacterSourceMaterialized } = await load('features/relationship/character-source-launch-target.ts');
const { localAgentListQueryKey } = await load('features/agents/local-agent-list-model.ts');
const { characterSourceRefKey, characterSourceMaterializationMessage, characterSourceMaterializationFailureMessage } = await load('features/explore/character-source-materialization.ts');
const { createNimiDesktopFirstPartyRuntimeClients } = await import(pathToFileURL(path.join(root, 'sdks/typescript/runtime/desktop-first-party-runtime.ts')).href);

function loadCreationHandler(env) {
  const file = path.join(renderer, 'features/source-detail/source-detail-panel.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['ensureCharacterSourceReady', 'handlePrimaryAction'];
  const declarations = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
      declarations.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(declarations.size, names.length);
  const emitted = ts.transpileModule(names.map((name) => declarations.get(name)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(env), `${emitted}\nreturn handlePrimaryAction;`)(...Object.values(env));
}

test('creation clicked by account A must not dispatch against switched account B', async (t) => {
  const sourceRef = {kind: 'worldCharacter', id: 'character-1', worldId: 'world-1', worldEntityRef: {kind: 'worldEntity', worldId: 'world-1', entityId: 'character-1'}, sourceHash: 'a'.repeat(64)};
  const source = {id: sourceRef.id, displayName: 'Partner', handle: 'partner', bio: null, sourceRef};
  let auth = {status: 'authenticated', user: {id: 'account-A'}};
  const currentAction = {current: {ownerUserId: 'account-A', sourceKey: characterSourceRefKey(sourceRef)}};
  const events = [];
  let completeFirstDiscovery;
  let discoveryCalls = 0;
  const actualClients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop',
    getSubjectUserId: () => auth.user.id,
    transport: {
      unary: async (request) => {
        assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource');
        events.push(`MATERIALIZE:subject=${request.body.context.subjectUserId},owner=${request.body.context.ownerUserId}`);
        return {localAgentRef: 'local-agent:account-b-new', reasonCode: 0, idempotentReplay: false};
      },
      serverStream: async function* () {},
    },
  });
  const sdk = {
    runtimeAgentDiscovery: (getOwner) => ({discoverLocalAgentsBySource: async () => {
      const owner = getOwner();
      events.push(`discover:${owner}`);
      if (++discoveryCalls === 1) return new Promise((resolve) => { completeFirstDiscovery = resolve; });
      return [];
    }}),
    accountProduct: () => actualClients.accountProduct,
  };
  const handler = loadCreationHandler({
    source, ownerUserId: 'account-A', currentAction, currentSourceKey: characterSourceRefKey(sourceRef),
    appStore: {getState: () => ({auth})}, sourceMaterialization: null,
    setSourceMaterialization: () => {}, i18n: {t: (_, options) => options?.defaultValue ?? ''},
    bindings: {sdk}, queryClient: {invalidateQueries: async () => {}},
    ensureCharacterSourceMaterialized, localAgentListQueryKey,
    characterSourceMaterializationMessage, characterSourceMaterializationFailureMessage,
    setFeedback: (feedback) => events.push(`feedback:${feedback.kind}`),
  });
  const pending = handler();
  assert.equal(typeof completeFirstDiscovery, 'function');
  auth = {status: 'authenticated', user: {id: 'account-B'}};
  currentAction.current = {ownerUserId: 'account-B', sourceKey: characterSourceRefKey(sourceRef)};
  events.push('switch:account-B');
  completeFirstDiscovery([]);
  await pending;
  t.diagnostic(JSON.stringify(events));
  assert.equal(events.some((event) => event.startsWith('MATERIALIZE:')), false, 'stale creation crossed account boundary');
});
