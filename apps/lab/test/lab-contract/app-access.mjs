import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  cleanupBehaviorModules,
  importBehaviorModule,
  root,
} from './helpers.mjs';

test.after(cleanupBehaviorModules);

const catalogModule = () => importBehaviorModule('lab/app-access/app-access-catalog.js');
const probesModule = () => importBehaviorModule('lab/app-access/app-access-probes.js');
const stateModule = () => importBehaviorModule('lab/app-access/app-access-state.js');
const mappingModule = () => importBehaviorModule('lab/app-access/app-access-mapping.js');

const rejected = (reasonCode) => Object.assign(new Error(`rejected: ${reasonCode}`), { reasonCode });

function storagePort(initial = {}) {
  const documents = new Map(Object.entries(initial));
  const calls = [];
  return {
    calls,
    documents,
    async readJson(relativePath) {
      calls.push(['readJson', relativePath]);
      if (!documents.has(relativePath)) throw rejected('SDK_LOCAL_APP_STORAGE_NOT_FOUND');
      return documents.get(relativePath);
    },
    async writeJson(relativePath, value) {
      calls.push(['writeJson', relativePath]);
      if (relativePath.includes('..')) throw rejected('SDK_LOCAL_APP_STORAGE_PATH_INVALID');
      if (JSON.stringify(value).length > 256 * 1024) throw rejected('SDK_LOCAL_APP_STORAGE_SIZE_LIMIT');
      const document = { value, sizeBytes: JSON.stringify(value).length };
      documents.set(relativePath, document);
      return { sizeBytes: document.sizeBytes };
    },
    async removeJson(relativePath) {
      calls.push(['removeJson', relativePath]);
      return { removed: documents.delete(relativePath) };
    },
  };
}

function clientPort(overrides = {}) {
  return {
    storage: storagePort(),
    realm: { worldCore: { async list() { return []; }, async create() { throw rejected('not-configured'); } } },
    ai: { text: { async generateCandidate() { throw rejected('not-configured'); } } },
    agents: { async listReferences() { return []; } },
    conversation: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------- catalog --

test('app-access catalog is complete, consistent, and campaign-free', async () => {
  const {
    appAccessGroups,
    appAccessProbes,
    appAccessProbeById,
    appAccessPageCopy,
    appAccessPageIds,
    appAccessSessionFacts,
  } = await catalogModule();

  const probeIds = appAccessProbes.map((probe) => probe.id);
  assert.equal(new Set(probeIds).size, probeIds.length, 'probe ids must be unique');
  assert.equal(probeIds.length, 8);
  assert.deepEqual(Object.keys(appAccessProbeById).sort(), [...probeIds].sort());

  const grouped = appAccessGroups.flatMap((group) => group.probes);
  assert.deepEqual([...grouped].sort(), [...probeIds].sort(), 'every probe belongs to exactly one group');
  for (const group of appAccessGroups) {
    for (const id of group.probes) {
      assert.equal(appAccessProbeById[id].group, group.id, `${id} group back-reference`);
    }
  }
  const campaignPattern = /imp[45]/iu;
  const allText = JSON.stringify({
    appAccessGroups,
    appAccessProbes,
    appAccessPageCopy,
    appAccessPageIds,
    appAccessSessionFacts,
  });
  assert.doesNotMatch(allText, campaignPattern, 'catalog must not carry campaign codenames');

  const allTestIds = [
    ...Object.values(appAccessPageIds),
    ...Object.values(appAccessSessionFacts).map((fact) => fact.testId),
    ...appAccessGroups.flatMap((group) => [group.testId, group.runTestId]),
    ...appAccessProbes.flatMap((probe) => [probe.testId, probe.runTestId, probe.resultTestId]),
  ];
  assert.equal(new Set(allTestIds).size, allTestIds.length, 'test ids must be unique');
  for (const testId of allTestIds) {
    assert.ok(testId.startsWith('app-access-'), `${testId} carries the app-access- prefix`);
  }
});

test('app-access page copy keeps machine codes out of primary text', async () => {
  const { appAccessProbes, appAccessPageCopy, appAccessFailureCopy } = await catalogModule();
  for (const probe of appAccessProbes) {
    for (const text of [probe.titleKey, probe.provesKey, probe.runningKey, probe.gate?.guidanceKey ?? '']) {
      assert.doesNotMatch(text, /\b[A-Z]{3,}_[A-Z0-9_]+\b/u, `no typed reason in primary copy: ${text}`);
      assert.doesNotMatch(text, /imp[45]/iu);
      if (text) assert.match(text, /^AppAccess\./u, `copy is an AppAccess i18n key: ${text}`);
    }
  }
  assert.ok(appAccessPageCopy.signedOut.length > 0);
  assert.ok(appAccessPageCopy.notRun.length > 0);
  for (const [reason, copy] of Object.entries(appAccessFailureCopy)) {
    assert.ok(!copy.includes(reason), `human copy for ${reason} must not embed the reason code`);
    assert.match(copy, /^AppAccess\.failures\./u, `failure copy is an i18n key: ${copy}`);
  }
});

// ------------------------------------------------------------------ state --

test('app-access state model starts neutral and transitions honestly', async () => {
  const {
    createInitialProbeStates,
    applyProbeStart,
    applyProbeOutcome,
    applySessionLoss,
  } = await stateModule();
  const { appAccessProbes, appAccessPageCopy } = await catalogModule();

  const initial = createInitialProbeStates();
  for (const probe of appAccessProbes) {
    assert.equal(initial[probe.id].status, 'not-run');
    assert.equal(initial[probe.id].headline, appAccessPageCopy.notRun);
    assert.equal(initial[probe.id].reasonCode, undefined);
  }

  const running = applyProbeStart(initial, 'world-list');
  assert.equal(running['world-list'].status, 'running');
  assert.equal(initial['world-list'].status, 'not-run', 'reducers do not mutate');

  const passed = applyProbeOutcome(running, 'world-list', {
    ok: true,
    headline: 'Local WorldCores listed',
    facts: ['3 WorldCore(s) returned'],
  });
  assert.equal(passed['world-list'].status, 'passed');
  assert.deepEqual(passed['world-list'].facts, ['3 WorldCore(s) returned']);

  const failed = applyProbeOutcome(passed, 'world-list', {
    ok: false,
    headlineKey: 'AppAccess.failures.operationFailed',
    reasonCode: 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE',
    detail: 'bounded detail',
  });
  assert.equal(failed['world-list'].status, 'failed');
  assert.equal(failed['world-list'].reasonCode, 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE', 'typed reason preserved for technical details');
  assert.ok(!failed['world-list'].headline.includes('SDK_LOCAL_APP'), 'headline stays human');

  const lost = applySessionLoss(failed);
  for (const probe of appAccessProbes) {
    assert.equal(lost[probe.id].status, 'not-run', 'session loss clears all evidence');
  }
});

test('app-access gates guide instead of erroring', async () => {
  const { createInitialProbeStates, resolveProbeGate } = await stateModule();
  const { appAccessPageCopy } = await catalogModule();

  const states = createInitialProbeStates();
  const signedOut = { sessionBound: false, agentReferenceSelected: true };
  for (const id of Object.keys(states)) {
    const gate = resolveProbeGate(id, states, signedOut);
    assert.equal(gate.runnable, false);
    assert.equal(gate.guidanceKey, appAccessPageCopy.signedOut);
  }

  const bound = { sessionBound: true, agentReferenceSelected: false };
  assert.equal(resolveProbeGate('storage-isolation', states, bound).runnable, true);
  assert.equal(resolveProbeGate('text-generation', states, bound).runnable, true);
  assert.equal(resolveProbeGate('agent-references', states, bound).runnable, true);

  const conversation = resolveProbeGate('agent-conversation', states, bound);
  assert.equal(conversation.runnable, false);
  assert.equal(conversation.guidanceKey, 'AppAccess.probes.agentConversation.gateGuidance');

  assert.equal(
    resolveProbeGate('agent-conversation', states, { ...bound, agentReferenceSelected: true }).runnable,
    true,
  );
});

test('app-access run plans follow dependency order', async () => {
  const { planGroupRun, planRunAll } = await stateModule();
  assert.deepEqual(planGroupRun('ai-consumption'), ['text-generation']);
  assert.deepEqual(planGroupRun('agent-conversation'), ['agent-references', 'agent-conversation', 'agent-interrupt']);
  const all = planRunAll();
  assert.equal(all.length, 8);
  assert.equal(new Set(all).size, 8);
  assert.ok(all.indexOf('agent-references') < all.indexOf('agent-conversation'));
  assert.ok(all.indexOf('agent-conversation') < all.indexOf('agent-interrupt'));
});

// ----------------------------------------------------------------- probes --

test('storage isolation probe runs the real roundtrip and stays bounded', async () => {
  const { runStorageIsolationProbe } = await probesModule();
  const storage = storagePort();
  const outcome = await runStorageIsolationProbe(clientPort({ storage }));
  assert.equal(outcome.ok, true);
  assert.match(outcome.headline, /roundtrip/iu);
  assert.deepEqual(
    storage.calls.map(([operation]) => operation),
    ['writeJson', 'readJson', 'removeJson', 'readJson'],
  );
  const written = storage.calls.find(([operation]) => operation === 'writeJson');
  assert.equal(written[1], 'app-access/app-private-roundtrip.json');
  assert.doesNotMatch(JSON.stringify(outcome), /imp[45]/iu);
});

test('storage isolation probe reports a bounded typed failure on mismatch', async () => {
  const { runStorageIsolationProbe } = await probesModule();
  const { appAccessFailureCopy } = await catalogModule();
  const storage = storagePort();
  const originalRead = storage.readJson;
  storage.readJson = async (relativePath) => {
    const document = await originalRead(relativePath);
    return { ...document, value: { tampered: true } };
  };
  const outcome = await runStorageIsolationProbe(clientPort({ storage }));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reasonCode, 'storage-roundtrip-mismatch');
  assert.equal(outcome.headlineKey, appAccessFailureCopy['storage-roundtrip-mismatch']);
  assert.ok(!outcome.headlineKey.includes('storage-roundtrip-mismatch'));
});

test('storage boundary probe expects real rejections for escape and oversize', async () => {
  const { runStorageBoundaryProbe } = await probesModule();
  const outcome = await runStorageBoundaryProbe(clientPort());
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.facts, ['path escape rejected', 'oversized write rejected']);
});

test('storage boundary probe fails closed when an escape write succeeds', async () => {
  const { runStorageBoundaryProbe } = await probesModule();
  const storage = storagePort();
  storage.writeJson = async () => ({ sizeBytes: 2 });
  const outcome = await runStorageBoundaryProbe(clientPort({ storage }));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reasonCode, 'unexpected-success');
  assert.equal(outcome.headlineKey, 'AppAccess.failures.unexpectedSuccess');
});

test('configured text probe reports finish and truncated trace facts without mutating AIConfig', async () => {
  const { runTextGenerationProbe } = await probesModule();
  const ai = {
    text: {
      async generateCandidate(input) {
        assert.equal(input.maxTokens, 32);
        assert.doesNotMatch(input.messages[0].text, /imp[45]/iu);
        return { text: 'ok', finishReason: 'stop', traceId: 'trace-abcdef0123456789' };
      },
    },
  };
  const outcome = await runTextGenerationProbe(clientPort({ ai }));
  assert.equal(outcome.ok, true);
  const facts = outcome.facts.join(' ');
  assert.match(facts, /finish stop/u);
  assert.ok(facts.includes('trace-abcdef…'), 'trace id truncated');
  assert.ok(!facts.includes('trace-abcdef0123456789'), 'full trace id never shown');
});

test('world create probe verifies list read-back and truncates opaque ids', async () => {
  const { runWorldCreateProbe } = await probesModule();
  const worldId = 'world_0123456789abcdef0123456789abcdef';

  const mismatchingRealm = {
    worldCore: {
      async create(input) {
        return { id: worldId, contentHash: 'hash-1', core: { identity: { name: input.core.identity.name } } };
      },
      async list() {
        return [{ id: worldId, contentHash: 'hash-1', core: { identity: { name: 'App Access World tampered' } } }];
      },
    },
  };
  const mismatch = await runWorldCreateProbe(clientPort({ realm: mismatchingRealm }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reasonCode, 'world-core-list-read-mismatch');

  let createdName = '';
  const agreeingRealm = {
    worldCore: {
      async create(input) {
        createdName = input.core.identity.name;
        assert.match(createdName, /^App Access World /u);
        assert.equal(input.core.authoring.source, 'nimi.lab.app-access');
        return { id: worldId, contentHash: 'hash-1', core: { identity: { name: createdName } } };
      },
      async list(input) {
        assert.equal(input.visibility, 'private');
        return [{ id: worldId, contentHash: 'hash-1', core: { identity: { name: createdName } } }];
      },
    },
  };
  const outcome = await runWorldCreateProbe(clientPort({ realm: agreeingRealm }));
  assert.equal(outcome.ok, true);
  const facts = outcome.facts.join(' ');
  assert.ok(facts.includes('world_012345…'), 'world id truncated');
  assert.ok(!facts.includes(worldId), 'full world id never shown');
  assert.match(facts, /home-world handoff value ready/u);
  assert.match(facts, /Agent owner not invoked/u);
});

test('agent references probe returns references and reports the empty case honestly', async () => {
  const { runAgentReferencesProbe } = await probesModule();
  const reference = { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', displayName: 'Atlas' };
  const agents = { async listReferences() { return [reference]; } };
  const run = await runAgentReferencesProbe(clientPort({ agents }));
  assert.equal(run.outcome.ok, true);
  assert.deepEqual(run.references, [reference]);
  assert.match(run.outcome.facts.join(' '), /1 active Agent reference/u);

  const empty = await runAgentReferencesProbe(clientPort());
  assert.equal(empty.outcome.ok, true);
  assert.match(empty.outcome.headline, /No active Agent reference/u);

  const broken = await runAgentReferencesProbe(clientPort({
    agents: { async listReferences() { throw rejected('SDK_LOCAL_APP_ACCESS_UNAVAILABLE'); } },
  }));
  assert.equal(broken.outcome.ok, false);
  assert.equal(broken.outcome.reasonCode, 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE');
  assert.deepEqual(broken.references, []);
});

test('agent conversation probe requires a reference and reports bounded facts', async () => {
  const { runAppAccessProbe } = await probesModule();
  const reference = { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', displayName: 'Atlas' };

  const missing = await runAppAccessProbe('agent-conversation', {
    client: clientPort(),
    agentReference: null,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reasonCode, 'agent-reference-required');

  // requestId is generated inside the runner; capture it on send so the
  // subscription can echo the matching acceptance event.
  let sentRequestId = '';
  const conversation = {
    async open() { return { conversationAnchorId: 'anchor-1' }; },
    async send(input) {
      sentRequestId = input.requestId;
      assert.match(input.requestId, /^lab-app-access-/u);
      return { turnId: 'turn-1' };
    },
    async subscribe() {
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'turn-accepted', conversationAnchorId: 'anchor-1', turnId: 'turn-1', requestId: sentRequestId };
          yield { type: 'message-committed', conversationAnchorId: 'anchor-1', turnId: 'turn-1', sequence: '2', messageId: 'm-1', text: 'confirmed' };
          yield { type: 'turn-completed', conversationAnchorId: 'anchor-1', turnId: 'turn-1', sequence: '3', terminalReason: 'stop' };
        },
        async cancel() {},
      };
    },
    async snapshot() { return { conversationAnchorId: 'anchor-1', activeTurnId: null, messages: [], truncatedBefore: false }; },
  };
  const outcome = await runAppAccessProbe('agent-conversation', {
    client: clientPort({ conversation }),
    agentReference: reference,
  });
  assert.equal(outcome.ok, true);
  const facts = outcome.facts.join(' ');
  assert.match(facts, /Atlas/u);
  assert.ok(facts.includes('agent_ref_AA…'), 'agent handle truncated');
  assert.ok(!facts.includes(reference.agentHandle), 'full agent handle never shown');
  assert.match(facts, /turn-completed · stop/u);
  assert.match(facts, /confirmed/u);
});

// ------------------------------------------------- naming and mount guards --

test('mapping tables cover every legacy id and keep current names campaign-free', async () => {
  const { appAccessTestIdMapping, appAccessLabelMapping } = await mappingModule();

  const legacyIds = appAccessTestIdMapping.map((entry) => entry.legacy);
  assert.equal(new Set(legacyIds).size, legacyIds.length, 'legacy ids unique');
  assert.equal(legacyIds.length, 28);
  for (const legacy of legacyIds) {
    assert.match(legacy, /^imp[45]-/u, `${legacy} is a real campaign id`);
  }
  for (const entry of appAccessTestIdMapping) {
    assert.ok(
      entry.current === '(folded)' || entry.current.startsWith('app-access-'),
      `${entry.legacy} maps to an app-access id or a documented fold`,
    );
    assert.doesNotMatch(entry.current, /imp[45]/iu);
    if (entry.note) assert.doesNotMatch(entry.note, /IMP[45]/u);
  }

  for (const entry of appAccessLabelMapping) {
    assert.ok(entry.legacy.trim().length > 0);
    assert.doesNotMatch(entry.current, /imp[45]/iu);
  }
});

test('no campaign codenames remain in lab sources outside the mapping module', async () => {
  const srcDir = path.join(root, 'src', 'lab');
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(srcDir);
  const allowed = new Set([path.join(srcDir, 'app-access', 'app-access-mapping.ts')]);
  const offenders = [];
  for (const file of files) {
    if (allowed.has(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (/imp4-|imp5-|Imp4|IMP4|IMP5/u.test(text)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, [], 'campaign codenames must not survive the redesign');
});

test('workbench mounts the App Access page on its own view', async () => {
  const source = readFileSync(path.join(root, 'src', 'lab', 'lab-workbench.tsx'), 'utf8');
  assert.match(source, /import \{ AppAccessPanel \} from '\.\/app-access\/app-access-panel\.js';/u);
  const branch = source.match(/view\.kind === 'app-access' \? \(\s*<([A-Za-z]+)/u);
  assert.ok(branch, 'app-access branch exists');
  assert.equal(branch[1], 'AppAccessPanel');

  const context = readFileSync(path.join(root, 'src', 'lab', 'workbench', 'workbench-context.ts'), 'utf8');
  assert.match(context, /\{ kind: 'app-access' \}/u);
});

test('Lab consumes the shared AI Studio controller instead of owning a parallel Section state tree', () => {
  const source = readFileSync(path.join(root, 'src', 'lab', 'lab-workbench.tsx'), 'utf8');
  assert.match(source, /useAIStudioWorkspaceController\s*\(/u);
  assert.match(source, /<LabAIStudioWorkspace/u);
  assert.doesNotMatch(source, /<SectionAITesting/u);
  assert.doesNotMatch(source, /StudioHistoryPanelContext\.Provider/u);
});
