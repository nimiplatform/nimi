import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNimiRealmWorldHistorySummary,
  buildNimiRealmWorldDetailWithAgentsCacheKey,
  formatNimiRealmWorldDisplayLabel,
  loadNimiRealmMainWorld,
  loadNimiRealmWorldAgents,
  loadNimiRealmWorldBindings,
  loadNimiRealmWorldDetailById,
  loadNimiRealmWorldDetailWithAgents,
  loadNimiRealmWorldHistory,
  loadNimiRealmWorldLevelAudits,
  loadNimiRealmWorldList,
  loadNimiRealmWorldLorebooks,
  loadNimiRealmWorldScenes,
  loadNimiRealmWorldSemanticBundle,
  mergeNimiRealmWorldPrimaryDetailTruth,
  normalizeNimiRealmWorldTruthAnchor,
  normalizeNimiRealmWorldTruthDetail,
  normalizeNimiRealmWorldTruthListItem,
  normalizeNimiRealmWorldTruthSummary,
  toNimiRealmWorldDisplayAgent,
  toNimiRealmWorldDisplayAuditItem,
  toNimiRealmWorldDisplayBindingItem,
  toNimiRealmWorldDisplayData,
  toNimiRealmWorldDisplayFallback,
  toNimiRealmWorldDisplayHistoryBundle,
  toNimiRealmWorldDisplayHistoryItem,
  toNimiRealmWorldDisplayLorebookItem,
  toNimiRealmWorldDisplaySceneItem,
  toNimiRealmWorldDisplaySemanticBundle,
  type NimiRealmWorldApi,
} from './index';

function assertRealmError(error: unknown, reasonCode: string): boolean {
  const record = error as { readonly reasonCode?: string; readonly source?: string };
  assert.equal(record.reasonCode, reasonCode);
  assert.equal(record.source, 'realm');
  return true;
}

test('Realm world helpers bind generated world methods with vNext request envelopes', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown }> = [];
  const realm = {
    world: {
      async worldControllerListWorlds(request) {
        calls.push({ method: 'worldControllerListWorlds', request });
        return [{ id: 'world-1', name: 'Cloud City', status: 'ACTIVE', computed: {} }];
      },
      async worldControllerGetWorldDetailWithAgents(request) {
        calls.push({ method: 'worldControllerGetWorldDetailWithAgents', request });
        return {
          id: 'world-1',
          name: 'Cloud City',
          status: 'ACTIVE',
          computed: {},
          agents: [{ id: 'agent-1', name: 'Guide', importance: 'PRIMARY' }],
        };
      },
      async getWorldScenes(request) {
        calls.push({ method: 'getWorldScenes', request });
        return { worldId: 'world-1', items: [{ id: 'scene-1', name: 'Gate', activeEntities: [] }] };
      },
      async worldControllerGetWorldHistory() {
        return { worldId: 'world-1', items: [] };
      },
      async worldControllerGetMainWorld() {
        return { id: 'world-1', computed: {} };
      },
      async worldControllerGetWorld() {
        return { id: 'world-1', computed: {} };
      },
      async worldControllerGetWorldAgents() {
        return [];
      },
      async worldControllerGetWorldBindings() {
        return { worldId: 'world-1', items: [] };
      },
      async worldControllerGetWorldLevelAudits() {
        return [];
      },
      async worldControllerGetWorldLorebooks() {
        return { worldId: 'world-1', items: [] };
      },
      async worldControllerGetWorldview() {
        return { id: 'view-1', truth: {} };
      },
    },
  } as unknown as NimiRealmWorldApi;

  assert.equal(buildNimiRealmWorldDetailWithAgentsCacheKey(' world-1 ', 99), 'world:world-1:detail:recommended-agents:12');
  assert.equal((await loadNimiRealmWorldList(realm, 'ACTIVE'))[0]?.id, 'world-1');
  assert.equal((await loadNimiRealmWorldDetailWithAgents(realm, 'world-1', 2))?.id, 'world-1');
  assert.deepEqual(await loadNimiRealmWorldScenes(realm, 'world-1'), {
    worldId: 'world-1',
    items: [{ id: 'scene-1', name: 'Gate', activeEntities: [] }],
  });
  assert.deepEqual(calls, [
    {
      method: 'worldControllerListWorlds',
      request: { path: {}, query: { status: 'ACTIVE' } },
    },
    {
      method: 'worldControllerGetWorldDetailWithAgents',
      request: { path: { id: 'world-1' }, query: { recommendedAgentLimit: 2 } },
    },
    {
      method: 'getWorldScenes',
      request: { path: { id: 'world-1' } },
    },
  ]);
});

test('Realm world loaders cover complete generated envelope surface', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown }> = [];
  const realm = {
    world: {
      async worldControllerListWorlds(request) {
        calls.push({ method: 'worldControllerListWorlds', request });
        return [{ id: 'world-1', name: 'Cloud City', status: 'ACTIVE', computed: {} }];
      },
      async worldControllerGetMainWorld(request) {
        calls.push({ method: 'worldControllerGetMainWorld', request });
        return { id: 'main-world', name: 'Main World', computed: {} };
      },
      async worldControllerGetWorldLevelAudits(request) {
        calls.push({ method: 'worldControllerGetWorldLevelAudits', request });
        return [{ id: 'audit-1', eventType: 'LEVEL_UP', occurredAt: '2026-06-05T00:00:00Z', nextLevel: 2 }];
      },
      async worldControllerGetWorld(request) {
        calls.push({ method: 'worldControllerGetWorld', request });
        return request.path.id === 'missing-world'
          ? null
          : { id: request.path.id, name: 'Cloud City', computed: {} };
      },
      async worldControllerGetWorldHistory(request) {
        calls.push({ method: 'worldControllerGetWorldHistory', request });
        return { worldId: request.path.id, items: [] };
      },
      async worldControllerGetWorldLorebooks(request) {
        calls.push({ method: 'worldControllerGetWorldLorebooks', request });
        return { worldId: request.path.id, items: [{ id: 'lore-1', key: 'origin', content: 'Origin truth' }] };
      },
      async worldControllerGetWorldBindings(request) {
        calls.push({ method: 'worldControllerGetWorldBindings', request });
        return {
          worldId: request.path.id,
          items: [{
            id: 'binding-1',
            objectType: 'RESOURCE',
            objectId: 'resource-1',
            hostType: 'WORLD',
            hostId: request.path.id,
            bindingKind: 'PRESENTATION',
            priority: 1,
            tags: ['cover'],
            resource: {
              id: 'resource-1',
              url: 'https://assets.example/world.png',
              resourceType: 'IMAGE',
            },
          }],
        };
      },
      async getWorldScenes(request) {
        calls.push({ method: 'getWorldScenes', request });
        return { worldId: request.path.id, items: [{ id: 'scene-1', name: 'Gate', activeEntities: ['agent-1'] }] };
      },
      async worldControllerGetWorldAgents(request) {
        calls.push({ method: 'worldControllerGetWorldAgents', request });
        return [{ id: 'agent-1', name: 'Guide', importance: 'PRIMARY' }];
      },
      async worldControllerGetWorldDetailWithAgents(request) {
        calls.push({ method: 'worldControllerGetWorldDetailWithAgents', request });
        return request.path.id === 'missing-world'
          ? null
          : {
              id: request.path.id,
              name: 'Cloud City',
              status: 'ACTIVE',
              computed: {},
              agents: [{ id: 'agent-1', name: 'Guide', importance: 'PRIMARY' }],
            };
      },
      async worldControllerGetWorldview(request) {
        calls.push({ method: 'worldControllerGetWorldview', request });
        return { id: 'view-1', truth: { title: `Truth for ${request.path.id}` } };
      },
    },
  } as unknown as NimiRealmWorldApi;

  assert.equal(buildNimiRealmWorldDetailWithAgentsCacheKey('world-1'), 'world:world-1:detail');
  assert.equal((await loadNimiRealmWorldList(realm))[0]?.id, 'world-1');
  assert.equal((await loadNimiRealmMainWorld(realm)).id, 'main-world');
  assert.equal((await loadNimiRealmWorldLevelAudits(realm, ' world-1 ', 128))[0]?.nextLevel, 2);
  assert.equal((await loadNimiRealmWorldLevelAudits(realm, 'world-1', -1))[0]?.id, 'audit-1');
  assert.equal((await loadNimiRealmWorldDetailById(realm, 'world-1'))?.id, 'world-1');
  assert.equal(await loadNimiRealmWorldDetailById(realm, 'missing-world'), null);
  assert.equal((await loadNimiRealmWorldHistory(realm, 'world-1')).worldId, 'world-1');
  assert.equal((await loadNimiRealmWorldLorebooks(realm, 'world-1')).items[0]?.id, 'lore-1');
  assert.equal((await loadNimiRealmWorldBindings(realm, 'world-1')).items[0]?.id, 'binding-1');
  assert.equal((await loadNimiRealmWorldScenes(realm, 'world-1')).items[0]?.id, 'scene-1');
  assert.equal((await loadNimiRealmWorldAgents(realm, 'world-1'))[0]?.id, 'agent-1');
  assert.equal((await loadNimiRealmWorldDetailWithAgents(realm, 'world-1'))?.agents?.[0]?.id, 'agent-1');
  assert.equal((await loadNimiRealmWorldDetailWithAgents(realm, 'world-1', 2))?.id, 'world-1');
  assert.equal(await loadNimiRealmWorldDetailWithAgents(realm, 'missing-world'), null);
  assert.equal((await loadNimiRealmWorldSemanticBundle(realm, 'world-1')).worldview?.id, 'view-1');

  assert.deepEqual(calls.map((call) => call.request), [
    { path: {}, query: {} },
    { path: {} },
    { path: { id: 'world-1' }, query: { limit: 100 } },
    { path: { id: 'world-1' }, query: { limit: 20 } },
    { path: { id: 'world-1' } },
    { path: { id: 'missing-world' } },
    { path: { id: 'world-1' } },
    { path: { id: 'world-1' } },
    { path: { id: 'world-1' } },
    { path: { id: 'world-1' } },
    { path: { id: 'world-1' } },
    { path: { id: 'world-1' }, query: {} },
    { path: { id: 'world-1' }, query: { recommendedAgentLimit: 2 } },
    { path: { id: 'missing-world' }, query: {} },
    { path: { id: 'world-1' } },
  ]);
});

test('Realm world helpers fail closed on mismatched world identifiers', async () => {
  const realm = {
    world: {
      async worldControllerGetWorldHistory() {
        return { worldId: 'other-world', items: [] };
      },
    },
  } as unknown as NimiRealmWorldApi;

  await assert.rejects(
    () => loadNimiRealmWorldHistory(realm, 'world-1'),
    (error: unknown) => {
      const record = error as { readonly reasonCode?: string; readonly source?: string };
      assert.equal(record.reasonCode, 'SDK_REALM_WORLD_HISTORY_WORLD_ID_MISMATCH');
      assert.equal(record.source, 'realm');
      return true;
    },
  );
});

test('Realm world loaders fail closed on invalid generated payloads', async () => {
  assert.throws(
    () => buildNimiRealmWorldDetailWithAgentsCacheKey('   '),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_WORLD_ID_REQUIRED'),
  );

  await assert.rejects(
    () => loadNimiRealmWorldList({
      world: {
        async worldControllerListWorlds() {
          return [{}];
        },
      },
    } as unknown as NimiRealmWorldApi),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_WORLD_LIST_CONTRACT_INVALID'),
  );
  await assert.rejects(
    () => loadNimiRealmMainWorld({
      world: {
        async worldControllerGetMainWorld() {
          return null;
        },
      },
    } as unknown as NimiRealmWorldApi),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_MAIN_WORLD_CONTRACT_INVALID'),
  );
  await assert.rejects(
    () => loadNimiRealmWorldDetailById({
      world: {
        async worldControllerGetWorld() {
          return { id: 'other-world', computed: {} };
        },
      },
    } as unknown as NimiRealmWorldApi, 'world-1'),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_WORLD_DETAIL_WORLD_ID_MISMATCH'),
  );
  await assert.rejects(
    () => loadNimiRealmWorldDetailWithAgents({
      world: {
        async worldControllerGetWorldDetailWithAgents() {
          return { id: 'other-world', computed: {}, agents: [] };
        },
      },
    } as unknown as NimiRealmWorldApi, 'world-1'),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_WORLD_DETAIL_WITH_AGENTS_WORLD_ID_MISMATCH'),
  );
  await assert.rejects(
    () => loadNimiRealmWorldLorebooks({
      world: {
        async worldControllerGetWorldLorebooks() {
          return { worldId: 'world-1' };
        },
      },
    } as unknown as NimiRealmWorldApi, 'world-1'),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_WORLD_LOREBOOKS_CONTRACT_INVALID'),
  );
  await assert.rejects(
    () => loadNimiRealmWorldBindings({
      world: {
        async worldControllerGetWorldBindings() {
          return { worldId: 'other-world', items: [] };
        },
      },
    } as unknown as NimiRealmWorldApi, 'world-1'),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_WORLD_BINDINGS_WORLD_ID_MISMATCH'),
  );
  await assert.rejects(
    () => loadNimiRealmWorldScenes({
      world: {
        async getWorldScenes() {
          return { worldId: 'world-1' };
        },
      },
    } as unknown as NimiRealmWorldApi, 'world-1'),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_WORLD_SCENES_CONTRACT_INVALID'),
  );
  await assert.rejects(
    () => loadNimiRealmWorldAgents({
      world: {
        async worldControllerGetWorldAgents() {
          return [{ id: 'agent-1' }, null];
        },
      },
    } as unknown as NimiRealmWorldApi, 'world-1'),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_WORLD_AGENTS_CONTRACT_INVALID'),
  );
  await assert.rejects(
    () => loadNimiRealmWorldSemanticBundle({
      world: {
        async worldControllerGetWorldview() {
          return null;
        },
      },
    } as unknown as NimiRealmWorldApi, 'world-1'),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_WORLDVIEW_CONTRACT_INVALID'),
  );
});

test('Realm world public asset display projection fails closed on missing resource URL', () => {
  assert.throws(
    () => toNimiRealmWorldDisplayBindingItem({
      id: 'binding-1',
      objectType: 'RESOURCE',
      objectId: 'resource-1',
      hostType: 'WORLD',
      hostId: 'world-1',
      bindingKind: 'PRESENTATION',
      priority: 1,
      tags: ['cover'],
      resource: {
        id: 'resource-1',
        resourceType: 'IMAGE',
      },
    }),
    (error: unknown) => {
      const record = error as { readonly reasonCode?: string; readonly source?: string };
      assert.equal(record.reasonCode, 'SDK_REALM_WORLD_DISPLAY_BINDING_RESOURCE_URL_INVALID');
      assert.equal(record.source, 'realm');
      return true;
    },
  );
});

test('Realm world history and semantic projections preserve evidence and defaults', () => {
  const futureEvent = toNimiRealmWorldDisplayHistoryItem({
    id: 'event-1',
    title: 'Sky Gate Opens',
    eventType: 'future_secondary',
    happenedAt: '2999-01-01T00:00:00Z',
    timeRef: 'Year 9',
    summary: 'The gate opens above the city.',
    locationRefs: ['gate'],
    characterRefs: ['agent-1'],
    evidenceRefs: [{
      segmentId: 'segment-1',
      offsetStart: 4,
      offsetEnd: 12,
      excerpt: 'gate opens',
      confidence: 0.8,
      sourceType: 'LOREBOOK',
    }],
  }, 3);
  const ongoingEvent = toNimiRealmWorldDisplayHistoryItem({
    id: 'event-2',
    title: 'Council Holds',
    eventType: 'ONGOING_PRIMARY',
    happenedAt: '2026-06-05T00:00:00Z',
    cause: 'The city needs a route.',
    locationRefs: [],
    characterRefs: [],
  }, 0);

  assert.deepEqual({
    timelineSeq: futureEvent.timelineSeq,
    tag: futureEvent.tag,
    level: futureEvent.level,
    eventHorizon: futureEvent.eventHorizon,
    confidence: futureEvent.confidence,
    needsEvidence: futureEvent.needsEvidence,
  }, {
    timelineSeq: 4,
    tag: 'Future Secondary',
    level: 'SECONDARY',
    eventHorizon: 'FUTURE',
    confidence: 0.8,
    needsEvidence: false,
  });
  assert.equal(ongoingEvent.needsEvidence, true);
  assert.deepEqual(buildNimiRealmWorldHistorySummary([futureEvent, ongoingEvent]), {
    primaryCount: 1,
    secondaryCount: 1,
    totalCount: 2,
    eventCharacterCoverage: 0.5,
    eventLocationCoverage: 0.5,
  });
  assert.equal(toNimiRealmWorldDisplayHistoryBundle({ items: [] }).summary, null);

  const semantic = toNimiRealmWorldDisplaySemanticBundle({
    worldview: {
      truth: {
        operation: {
          title: 'Sky transit',
          description: 'Move between floating districts.',
          rules: [{ key: 'gravity', title: 'Gravity', value: 'Respect the lift fields' }],
        },
        geography: {
          topology: {
            type: 'floating',
            boundary: 'storm wall',
            dimensions: 'upper/lower',
            realms: [{ name: 'Upper Ring', description: 'High air', accessibility: 'licensed' }],
          },
        },
        metaphysics: {
          causality: { type: 'karma', karmaEnabled: true, fateWeight: '0.7' },
        },
        coreSystem: {
          powerSystems: [{
            name: 'Aether',
            description: 'Lift physics.',
            levels: [{ name: 'Lift', description: 'First ascent', breakthroughCondition: 'storm pact' }],
            rules: ['do not sever anchors'],
          }],
          levels: [{ name: 'Citizen', description: 'Entry rank' }],
          taboos: [{ title: 'Anchor cutting', severity: 'fatal' }],
        },
      },
      languages: {
        languages: [{
          name: 'Nimi',
          category: 'common',
          description: 'Trade language',
          writingSample: 'ni-mi',
          spokenSample: 'nimi',
          isCommon: true,
        }],
      },
    },
    worldviewEvents: [{ summary: 'Founding wind' }],
    worldviewSnapshots: [{ version: '2', summary: 'Second law' }],
  });

  assert.equal(semantic.hasContent, true);
  assert.equal(semantic.operationRules[0]?.key, 'gravity');
  assert.equal(semantic.powerSystems[0]?.levels[0]?.extra, 'storm pact');
  assert.equal(semantic.taboos[0]?.name, 'Anchor cutting');
  assert.equal(semantic.topology?.realms[0]?.name, 'Upper Ring');
  assert.equal(semantic.causality?.fateWeight, 0.7);
  assert.equal(semantic.languages[0]?.isCommon, true);
  assert.deepEqual(semantic.worldviewEvents[0], {
    id: 'worldview-event-1',
    title: 'Founding wind',
    summary: 'Founding wind',
    eventType: null,
    createdAt: null,
  });
  assert.deepEqual(semantic.worldviewSnapshots[0], {
    id: 'worldview-snapshot-1',
    versionLabel: '2',
    summary: 'Second law',
    createdAt: null,
  });

  assert.throws(
    () => toNimiRealmWorldDisplaySemanticBundle({
      worldview: {
        truth: {
          operation: {
            rules: [{ key: 'gravity', value: 'missing title' }],
          },
        },
      },
    }),
    (error: unknown) => assertRealmError(error, 'SDK_REALM_WORLD_DISPLAY_SEMANTIC_RULE_TITLE_INVALID'),
  );
});

test('Realm world projection helpers normalize truth and display data', () => {
  const world = {
    id: 'world-1',
    name: 'Cloud City',
    description: 'A city above the sea.',
    status: 'ACTIVE',
    type: 'CREATOR',
    computed: {
      time: { currentWorldTime: 'Dawn', flowRatio: 2, isPaused: false },
      languages: { primary: 'Nimi', common: ['Nimi', 'Trade'] },
      entry: { recommendedAgents: [{ id: 'agent-1', name: 'Guide' }] },
      score: { scoreEwma: 7 },
      featuredAgentCount: 1,
    },
    themes: ['sky'],
    agents: [{ id: 'agent-1', name: 'Guide', importance: 'PRIMARY', display: { role: 'Host' } }],
  };
  const worldview = {
    truth: {
      operation: {
        title: 'Sky transit',
        rules: [{ key: 'gravity', title: 'Gravity', value: 'Float-safe' }],
      },
      coreSystem: {
        powerSystems: [{ name: 'Aether', levels: [{ name: 'Lift' }], rules: ['Respect wind'] }],
      },
    },
    languages: { languages: [{ name: 'Nimi', isCommon: true }] },
  };

  assert.deepEqual(normalizeNimiRealmWorldTruthListItem(world)?.computed?.languages?.common, ['Nimi', 'Trade']);
  assert.deepEqual(normalizeNimiRealmWorldTruthDetail({ detail: world, worldview })?.recommendedAgents?.[0], {
    agentId: 'agent-1',
    name: 'Guide',
    importance: 'PRIMARY',
    role: 'Host',
  });
  assert.equal(toNimiRealmWorldDisplayData(world).flowRatio, 2);
  assert.equal(toNimiRealmWorldDisplaySemanticBundle({ worldview, worldviewEvents: [], worldviewSnapshots: [] }).hasContent, true);
  assert.equal(
    toNimiRealmWorldDisplayHistoryBundle({
      items: [{
        id: 'event-1',
        title: 'Arrival',
        happenedAt: '2026-06-05T00:00:00Z',
        eventType: 'PRIMARY',
        locationRefs: [],
        characterRefs: [],
      }],
    }).summary?.primaryCount,
    1,
  );
});

test('Realm world display helpers normalize public developer-facing records', () => {
  const computed = toNimiRealmWorldDisplayFallback({
    id: 'world-computed',
    name: 'Computed World',
    computed: {
      time: { currentWorldTime: 'Dawn', currentLabel: 'First bell', eraLabel: 'Sky Age', flowRatio: 0, isPaused: true },
      languages: { primary: 'Nimi', common: ['Nimi', 'Trade'] },
      entry: {
        recommendedAgents: [
          { agentId: 'agent-1', name: 'Guide', handle: '@guide', avatarUrl: 'https://assets.example/guide.png' },
          { id: '', name: 'Invalid' },
        ],
      },
      score: { scoreEwma: '6' },
      featuredAgentCount: '3',
    },
  });

  assert.equal(formatNimiRealmWorldDisplayLabel('hello_world-test'), 'Hello World Test');
  assert.equal(computed.flowRatio, 0.0001);
  assert.equal(computed.recommendedAgents?.length, 1);
  assert.equal(computed.scoreEwma, 6);

  const fallback = toNimiRealmWorldDisplayFallback({
    id: 'world-1',
    title: 'Fallback Title',
    computed: {
      entry: { recommendedAgents: [{ id: 'agent-2', name: 'Computed Guide' }] },
      score: { scoreEwma: 4 },
    },
  });
  assert.deepEqual({
    id: fallback.id,
    name: fallback.name,
    type: fallback.type,
    status: fallback.status,
    nativeCreationState: fallback.nativeCreationState,
    scoreEwma: fallback.scoreEwma,
    recommendedAgentId: fallback.recommendedAgents?.[0]?.id,
  }, {
    id: 'world-1',
    name: 'Fallback Title',
    type: 'CREATOR',
    status: 'DRAFT',
    nativeCreationState: 'OPEN',
    scoreEwma: 4,
    recommendedAgentId: 'agent-2',
  });

  const display = toNimiRealmWorldDisplayData({
    id: 'world-2',
    name: 'Full World',
    description: 'World description',
    tagline: 'Above the storm',
    motto: 'Lift together',
    overview: 'A city in the sky.',
    contentRating: 'PG13',
    iconUrl: 'https://assets.example/icon.png',
    bannerUrl: 'https://assets.example/banner.png',
    type: 'OASIS',
    status: 'ACTIVE',
    level: '7',
    levelUpdatedAt: '2026-06-05T00:00:00Z',
    agentCount: '2',
    createdAt: '2026-06-01T00:00:00Z',
    creatorId: 'creator-1',
    freezeReason: 'GOVERNANCE_LOCK',
    lorebookEntryLimit: '12',
    nativeAgentLimit: '5',
    nativeCreationState: 'NATIVE_CREATION_FROZEN',
    scoreA: 1,
    scoreC: 2,
    scoreE: 3,
    scoreQ: 4,
    transitInLimit: 8,
    genre: 'fantasy',
    era: 'Sky Age',
    themes: ['air'],
    agents: [{
      id: 'agent-1',
      name: 'Guide',
      handle: '@guide',
      avatarUrl: 'https://assets.example/guide.png',
      importance: 'BACKGROUND',
      display: { role: 'Host', faction: 'Transit', location: 'Gate' },
    }],
  });
  assert.deepEqual(display.recommendedAgents?.[0], {
    id: 'agent-1',
    name: 'Guide',
    handle: '@guide',
    avatarUrl: 'https://assets.example/guide.png',
    importance: 'BACKGROUND',
    display: {
      role: 'Host',
      faction: 'Transit',
      location: 'Gate',
    },
  });
  assert.equal(display.type, 'OASIS');
  assert.equal(display.status, 'ACTIVE');
  assert.equal(display.freezeReason, 'GOVERNANCE_LOCK');

  assert.deepEqual(toNimiRealmWorldDisplayAgent({
    id: 'agent-3',
    name: '',
    handle: '@quiet',
    bio: 'Keeps the gate.',
    display: { role: 'Guard', faction: 'Transit', rank: 'Captain', sceneName: 'Gate', location: 'North' },
    createdAt: '',
    avatarUrl: 'https://assets.example/agent.png',
    importance: 'SECONDARY',
    stats: { vitalityScore: 9 },
  }, '2026-06-01T00:00:00Z'), {
    id: 'agent-3',
    name: 'Unknown',
    handle: '@quiet',
    bio: 'Keeps the gate.',
    role: 'Guard',
    faction: 'Transit',
    rank: 'Captain',
    sceneName: 'Gate',
    location: 'North',
    createdAt: '2026-06-01T00:00:00Z',
    avatarUrl: 'https://assets.example/agent.png',
    importance: 'SECONDARY',
    stats: { vitalityScore: 9 },
  });
  assert.deepEqual(toNimiRealmWorldDisplayAuditItem({
    id: 'audit-1',
    eventType: 'LEVEL_CHANGED',
    createdAt: '2026-06-05T00:00:00Z',
    prevLevel: '1',
    nextLevel: '2',
    ewmaScore: '7',
    freezeReason: 'WORLD_INACTIVE',
  }), {
    id: 'audit-1',
    label: 'LEVEL_CHANGED',
    eventType: 'LEVEL_CHANGED',
    occurredAt: '2026-06-05T00:00:00Z',
    prevLevel: 1,
    nextLevel: 2,
    ewmaScore: 7,
    freezeReason: 'WORLD_INACTIVE',
  });
  assert.deepEqual(toNimiRealmWorldDisplayLorebookItem({
    id: 'lore-1',
    summary: 'Core truth',
    keywords: ['sky', 'gate'],
    priority: '4',
  }), {
    id: 'lore-1',
    key: 'lore-1',
    name: null,
    content: 'Core truth',
    keywords: ['sky', 'gate'],
    priority: 4,
  });
  assert.deepEqual(toNimiRealmWorldDisplaySceneItem({
    id: 'scene-1',
    activeEntities: ['agent-1', 'agent-2'],
  }), {
    id: 'scene-1',
    name: 'Unnamed scene',
    description: '',
    activeEntities: ['agent-1', 'agent-2'],
  });
  assert.deepEqual(toNimiRealmWorldDisplayBindingItem({
    id: 'binding-1',
    objectType: 'RESOURCE',
    objectId: 'resource-1',
    hostType: 'WORLD',
    hostId: 'world-1',
    bindingKind: 'PRESENTATION',
    bindingPoint: 'cover',
    priority: 1,
    tags: ['cover'],
    resource: {
      id: 'resource-1',
      url: 'https://assets.example/world.png',
      resourceType: 'IMAGE',
      label: 'World cover',
    },
  }).resource, {
    id: 'resource-1',
    url: 'https://assets.example/world.png',
    resourceType: 'IMAGE',
    label: 'World cover',
  });

  const truth = normalizeNimiRealmWorldTruthSummary({
    world: {
      world_id: 'world-3',
      displayName: 'Truth World',
      summary: 'Truth summary',
      tagline: 'Seen',
      genre: 'myth',
      themes: ['oath'],
      status: 'SUSPENDED',
      type: 'OASIS',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-05T00:00:00Z',
    },
    worldview: {
      lifecycle: 'MAINTENANCE',
      version: '2',
      updatedAt: '2026-06-05T00:00:00Z',
      languages: { languages: [{ name: 'Nimi' }] },
      locations: { regions: [{}], landmarks: [{}] },
      truthRules: [{}],
      visualGuide: {},
      summary: 'Worldview summary',
    },
  });
  assert.equal(normalizeNimiRealmWorldTruthAnchor({ world: { id: 'world-3' } })?.worldId, 'world-3');
  assert.equal(normalizeNimiRealmWorldTruthSummary({}), null);
  assert.equal(truth?.worldview?.hasVisualGuide, true);
  assert.equal(truth?.worldview?.languageCount, 1);

  assert.deepEqual(mergeNimiRealmWorldPrimaryDetailTruth({ id: 'world-3' }, {
    worldId: 'world-3',
    title: 'Truth World',
  }), {
    id: 'world-3',
    worldTruth: {
      worldId: 'world-3',
      title: 'Truth World',
    },
  });
});
