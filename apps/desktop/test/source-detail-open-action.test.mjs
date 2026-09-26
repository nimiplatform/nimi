// Exercise the actual panel actions with owner response fixtures. No live product acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const ts = require('typescript');
const renderer = path.join(root, 'apps/desktop/src/shell/renderer');
const load = (p) => import(pathToFileURL(path.join(renderer, p)).href);
const { ensureCharacterSourceMaterialized } = await load('features/relationship/character-source-launch-target.ts');
const { resolveAgentTargetSnapshotForSourceRef } = await load('features/agents/agent-conversation-source-resolution.ts');
const { localAgentListQueryKey } = await load('features/agents/local-agent-list-model.ts');
const { characterSourceRefKey, characterSourceMaterializationMessage, characterSourceMaterializationFailureMessage } = await load('features/explore/character-source-materialization.ts');
const { launchAgentConversationFromDisplay } = await load('features/chat/agent-conversation-launcher.ts');
const { EMPTY_AGENT_CONVERSATION_SELECTION } = await load('features/chat/chat-shell-types.ts');

function loadHandler(file, names, env) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
      declarations.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(declarations.size, names.length);
  const program = names.map((name) => declarations.get(name)).join('\n');
  const emitted = ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(env), `${emitted}\nreturn ${names.at(-1)};`)(...Object.values(env));
}

const sourceRef = {
  kind: 'worldCharacter', id: 'character-1', worldId: 'world-1',
  worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'character-1' },
  sourceHash: 'a'.repeat(64),
};
const source = { id: sourceRef.id, displayName: 'Partner', handle: 'partner', bio: null, sourceRef };

async function run(surface, posture = 'missing', action = 'open') {
  let auth = { status: 'authenticated' };
  const currentAction = { current: { ownerUserId: 'owner-1', sourceKey: characterSourceRefKey(sourceRef) } };
  const events = [];
  let materialized = false;
  const localAgent = {
    localAgentRef: 'local-agent:new-empty-partner', ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source:new-empty-partner', displayName: 'Partner',
    sourceKind: sourceRef.kind, sourceWorldId: sourceRef.worldId, sourceId: sourceRef.id,
    sourceHash: sourceRef.sourceHash,
    sourceContextStatus: { ready: true, localAgentRef: 'local-agent:new-empty-partner', sourceRef },
  };
  const sdk = {
    runtimeAgentDiscovery: () => ({
      discoverLocalAgentsBySource: async () => {
        events.push('discover');
        if (posture === 'ambiguous') return [localAgent, { ...localAgent, localAgentRef: 'local-agent:second', sourceContextStatus: { ...localAgent.sourceContextStatus, localAgentRef: 'local-agent:second' } }];
        return materialized || ['existing', 'denied', 'stale', 'switch-account', 'switch-source'].includes(posture) ? [localAgent] : [];
      },
      listLocalAgents: async () => {
        events.push('list-current-inventory');
        if (posture === 'unavailable') throw new Error('owner unavailable');
        if (posture === 'switch-account') auth = { status: 'authenticated' };
        if (posture === 'switch-source') currentAction.current = null;
        if (posture === 'ambiguous') return [localAgent, { ...localAgent, localAgentRef: 'local-agent:second', sourceContextStatus: { ...localAgent.sourceContextStatus, localAgentRef: 'local-agent:second' } }];
        return materialized || ['existing', 'denied', 'stale', 'switch-account', 'switch-source'].includes(posture) ? [localAgent] : [];
      },
    }),
    accountProduct: () => ({
      materializeRealmSource: async () => {
        events.push('MATERIALIZE_NEW_AGENT');
        materialized = true;
        return { localAgentRef: localAgent.localAgentRef, reasonCode: 1, idempotentReplay: false };
      },
    }),
    resolveDesktopAgentReference: async ({ localAgentRef }) => {
        events.push(`resolve:${localAgentRef}`);
        if (posture === 'denied') throw new Error('denied');
        if (posture === 'stale') return {};
        return { reference: { agentHandle: 'agent_ref_' + 'B'.repeat(43), displayName: 'Partner', avatarUrl: null } };
    },
    conversation: () => ({ open: async ({ agentHandle }) => {
      events.push(`OPEN_CONVERSATION:${agentHandle}`);
      return { conversationAnchorId: 'anchor-new', activeTurnId: null };
    } }),
  };
  const env = {
    source, ownerUserId: 'owner-1', currentAction, currentSourceKey: characterSourceRefKey(sourceRef),
    appStore: { getState: () => ({ auth }) },
    sourceMaterialization: { sourceKey: characterSourceRefKey(sourceRef), phase: 'ready' },
    setSourceMaterialization: () => {}, i18n: { t: (_, options) => options?.defaultValue ?? '' },
    bindings: { sdk }, queryClient: { invalidateQueries: async () => {} },
    ensureCharacterSourceMaterialized, localAgentListQueryKey,
    characterSourceMaterializationMessage, characterSourceMaterializationFailureMessage,
    resolveAgentTargetSnapshotForSourceRef, characterSourceRefKey, launchAgentConversationFromDisplay,
    EMPTY_AGENT_CONVERSATION_SELECTION,
    logRendererEvent: () => {},
    setActiveTab: (tab) => events.push(`navigate:${tab}`), setChatMode: () => {},
    setSelectedTargetForSource: () => {}, setAgentConversationSelection: () => {},
    setAgentConversationTargetSnapshot: () => {}, setPendingAgentComposerPrefill: () => {},
    setFeedback: (feedback) => events.push(`feedback:${feedback.kind}`),
  };
  const handler = surface === 'source-detail'
    ? loadHandler(path.join(renderer, 'features/source-detail/source-detail-panel.tsx'), ['ensureCharacterSourceReady', action === 'create' ? 'handlePrimaryAction' : 'handleStartChat'], env)
    : loadHandler(path.join(renderer, 'features/world/world-detail.tsx'), ['handleOpenCharacterConversation'], env);
  await handler(surface === 'source-detail' ? undefined : source);
  return { surface, posture, events, materialized, opened: events.some((event) => event.startsWith('OPEN_CONVERSATION:')) };
}

for (const posture of ['missing', 'ambiguous', 'denied', 'stale', 'unavailable', 'switch-account', 'switch-source']) {
  test(`Source Detail Open refuses ${posture} even after a previous successful creation`, async () => {
    const result = await run('source-detail', posture);
    assert.equal(result.materialized, false);
    assert.equal(result.opened, false);
    assert.equal(result.events.includes('feedback:success'), false);
  });
}
test('Source Detail Open uses the sole current target without creation', async () => {
  const result = await run('source-detail', 'existing');
  assert.equal(result.materialized, false);
  assert.equal(result.opened, true);
  assert.equal(result.events.filter((event) => event.startsWith('OPEN_CONVERSATION:')).length, 1);
});
test('explicit creation materializes a missing partner without opening a conversation', async () => {
  const result = await run('source-detail', 'missing', 'create');
  assert.equal(result.materialized, true);
  assert.equal(result.opened, false);
});
test('World Detail Open also refuses missing targets without creation', async () => {
  const result = await run('world-detail');
  assert.equal(result.materialized, false);
  assert.equal(result.opened, false);
});
