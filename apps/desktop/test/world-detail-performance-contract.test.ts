import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { realmWorldData } from '../src/shell/renderer/features/world/data/realm-world-data.js';
import {
  fetchWorldPrimaryDisplayDetail,
} from '../src/shell/renderer/features/world/world-detail-queries.js';

const worldFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/data/realm-world-data.ts'),
  'utf8',
);
const worldDetailQueriesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-queries.ts'),
  'utf8',
);
const worldDetailPrimaryProjectionSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-primary-projection.ts'),
  'utf8',
);
const worldDetailSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail.tsx'),
  'utf8',
);
const worldListSelectedPanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-list-selected-panel.tsx'),
  'utf8',
);
const worldDetailTemplateSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-template.tsx'),
  'utf8',
);
const explorePanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/explore/explore-panel.tsx'),
  'utf8',
);
const authStateWatcherSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/auth-state-watcher.ts'),
  'utf8',
);

const primaryWorldFixture = {
  id: 'world-primary',
  name: 'Primary World',
  summary: 'Primary detail should render before supplemental sections.',
  description: 'Primary detail should render before supplemental sections.',
  tagline: 'Fast return',
  type: 'CREATOR',
  visibility: 'public',
  status: 'DISCOVERABLE',
  tags: ['Performance'],
  themes: ['Performance'],
  media: {
    iconUrl: null,
    bannerUrl: null,
    heroUrl: null,
    highlightUrls: [],
  },
  time: {
    mode: 'wallClockAnchored',
    flowRatio: 1,
    isPaused: false,
    anchorRealStartedAt: '2026-06-18T00:00:00.000Z',
    anchorWorldStartedAt: '2026-06-18T00:00:00.000Z',
    anchorWorldStartedAtDisplay: 'June 18, 2026',
    currentWorldTime: '2026-06-19T00:00:00.000Z',
    currentWorldTimeDisplay: 'June 19, 2026',
    computedAt: '2026-06-19T00:00:00.000Z',
  },
  stats: {
    characterCount: 1,
    personaCount: 0,
    sceneCount: 0,
    systemCount: 0,
    timelineEventCount: 0,
  },
  computed: {
    time: {
      currentWorldTime: '2026-06-19T00:00:00.000Z',
      currentLabel: 'June 19, 2026',
      eraLabel: 'June 18, 2026',
      flowRatio: 1,
      isPaused: false,
    },
    languages: { primary: null, common: [] },
    entry: { recommendedCharacters: [] },
    score: { scoreEwma: 0 },
    featuredCharacterCount: 1,
  },
  characterCount: 1,
  personaCount: 0,
  sceneCount: 0,
  systemCount: 0,
  timelineEventCount: 0,
  createdAt: '2026-06-18T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z',
  characters: [{
    id: 'character-primary',
    name: 'Fast Character',
    handle: 'fast-character',
    bio: 'Primary character.',
    avatarUrl: null,
    sourceKind: 'worldCharacter',
    ownership: 'worldOwned',
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-primary',
      sourceId: 'character-primary',
      sourceContentHash: 'hash-character-primary',
    },
    relation: {
      state: 'connectable',
      connectionId: null,
    },
    createdAt: '2026-06-19T00:00:00.000Z',
    importance: 'PRIMARY',
    display: {
      role: 'Guide',
      tags: [],
      sourceKind: 'worldCharacter',
      ownership: 'worldOwned',
      worldName: 'Primary World',
    },
    stats: null,
  }],
} satisfies NonNullable<Awaited<ReturnType<typeof realmWorldData.loadWorldDetailWithCharacters>>>;

test('world primary display detail resolves without waiting for supplemental section loaders', async () => {
  const originals = {
    loadWorldDetailWithCharacters: realmWorldData.loadWorldDetailWithCharacters,
    loadWorldHistory: realmWorldData.loadWorldHistory,
    loadWorldSemanticBundle: realmWorldData.loadWorldSemanticBundle,
    loadWorldAssets: realmWorldData.loadWorldAssets,
    loadWorldScenes: realmWorldData.loadWorldScenes,
  };
  const supplementalCalls: string[] = [];
  realmWorldData.loadWorldDetailWithCharacters = async () => primaryWorldFixture;
  realmWorldData.loadWorldHistory = async () => {
    supplementalCalls.push('history');
    return { items: [] };
  };
  realmWorldData.loadWorldSemanticBundle = async () => {
    supplementalCalls.push('semantic');
    return {};
  };
  realmWorldData.loadWorldAssets = async () => {
    supplementalCalls.push('assets');
    return { resourceRefs: [], externalRefs: [], intents: [] };
  };
  realmWorldData.loadWorldScenes = async () => {
    supplementalCalls.push('scenes');
    return { items: [] };
  };

  try {
    const detail = await fetchWorldPrimaryDisplayDetail('world-primary');

    assert.equal(detail.world.id, 'world-primary');
    assert.equal(detail.characters.length, 1);
    assert.deepEqual(supplementalCalls, []);
  } finally {
    realmWorldData.loadWorldDetailWithCharacters = originals.loadWorldDetailWithCharacters;
    realmWorldData.loadWorldHistory = originals.loadWorldHistory;
    realmWorldData.loadWorldSemanticBundle = originals.loadWorldSemanticBundle;
    realmWorldData.loadWorldAssets = originals.loadWorldAssets;
    realmWorldData.loadWorldScenes = originals.loadWorldScenes;
  }
});

test('world primary display detail preserves connected local-agent relation state', async () => {
  const originalLoadWorldDetailWithCharacters = realmWorldData.loadWorldDetailWithCharacters;
  realmWorldData.loadWorldDetailWithCharacters = async () => ({
    ...primaryWorldFixture,
    characters: primaryWorldFixture.characters.map((character) => ({
      ...character,
      relation: {
        state: 'connected',
        connectionId: 'local-agent-primary',
        runtimeSourceRef: 'realm-source:world-primary:character-primary',
      },
    })),
  });

  try {
    const detail = await fetchWorldPrimaryDisplayDetail('world-primary');
    const relation = detail.characters[0]?.relation;

    assert.equal(relation?.state, 'connected');
    assert.equal(relation?.connectionId, 'local-agent-primary');
    assert.equal(relation?.runtimeSourceRef, 'realm-source:world-primary:character-primary');
  } finally {
    realmWorldData.loadWorldDetailWithCharacters = originalLoadWorldDetailWithCharacters;
  }
});

test('world semantic bundle projects public world detail without raw core fallback', () => {
  const semanticStart = worldFlowSource.indexOf('export async function loadWorldSemanticBundle');
  const semanticEnd = worldFlowSource.indexOf('\nexport const realmWorldData', semanticStart);
  const semanticBundleSection = worldFlowSource.slice(semanticStart, semanticEnd);
  assert.match(semanticBundleSection, /getWorldCore\(realm, worldId\)/);
  assert.match(semanticBundleSection, /buildWorldPublicSemanticBundle\(asRecord\(world\)\)/);
  assert.doesNotMatch(semanticBundleSection, /semanticBundle\s*\?\?/);
  assert.doesNotMatch(semanticBundleSection, /loadWorldDetailById/);
  assert.doesNotMatch(semanticBundleSection, /catch\s*\{\s*return null;\s*\}/);
});

test('world entry no longer exposes eager world detail history prefetch', () => {
  assert.doesNotMatch(worldDetailQueriesSource, /export function prefetchWorldDetailAndHistory/);
});

test('world detail primary query adopts SDK public world DTO through a bounded adapter', () => {
  const oldRootSingletonPattern = new RegExp('get' + 'PlatformClient');
  assert.match(worldDetailPrimaryProjectionSource, /toWorldListItem\(asRecord\(detailValue\)\)/);
  assert.doesNotMatch(worldDetailQueriesSource, oldRootSingletonPattern);
  assert.doesNotMatch(worldDetailPrimaryProjectionSource, oldRootSingletonPattern);
  assert.match(worldDetailQueriesSource, /realmWorldData\.loadWorldSemanticBundle/);
  assert.match(worldDetailQueriesSource, /realmWorldData\.loadWorldDetailWithCharacters/);
  assert.doesNotMatch(worldDetailQueriesSource, /mergeNimiRealmWorldPrimaryDetailTruth/);
  assert.doesNotMatch(worldDetailQueriesSource, /WORLD_DETAIL_WORLD_TRUTH_INVALID/);
});

test('world atlas selected panel loads preview people from the primary display detail only', () => {
  assert.match(worldListSelectedPanelSource, /worldPrimaryDisplayDetailQueryKey\(world\.id\)/);
  assert.match(worldListSelectedPanelSource, /fetchWorldPrimaryDisplayDetail\(world\.id\)/);
  assert.match(worldListSelectedPanelSource, /enabled: Boolean\(world\.id\)/);
  assert.doesNotMatch(worldListSelectedPanelSource, /enabled: peopleCount > 0/);
  assert.doesNotMatch(worldListSelectedPanelSource, /worldDisplayDetailQueryKey\(world\.id\)/);
  assert.doesNotMatch(worldListSelectedPanelSource, /fetchWorldDisplayDetail\(world\.id\)/);
  assert.doesNotMatch(worldListSelectedPanelSource, /fetchWorldDetailWithCharacters/);
});

test('world detail only treats the primary query as a page-level error and defers non-critical sections', () => {
  assert.match(worldDetailSource, /fetchWorldPrimaryDisplayDetail/);
  assert.match(worldDetailSource, /fetchWorldSupplementalDisplayDetail/);
  assert.match(worldDetailSource, /worldPrimaryDisplayDetailQueryKey\(world\.id\)/);
  assert.match(worldDetailSource, /worldSupplementalDisplayDetailQueryKey\(world\.id\)/);
  assert.match(worldDetailSource, /const primaryLoading = worldPrimaryQuery\.isPending && !primaryDisplay/);
  assert.match(worldDetailSource, /const supplementalLoading = Boolean\(primaryDisplay\) && worldSupplementalQuery\.isPending && !supplementalDisplay/);
  assert.match(worldDetailSource, /const initialError = !initialLoading/);
  assert.doesNotMatch(worldDetailSource, /const supplementalError =/);
  assert.doesNotMatch(worldDetailSource, /Object\.values\(display\.sections\)\.some\(\(status\) => status === 'error'\)/);
  assert.match(worldDetailSource, /const pageError = initialError/);
  assert.match(worldDetailSource, /charactersLoading=\{primaryLoading\}/);
  assert.match(worldDetailSource, /historyLoading=\{supplementalLoading\}/);
  assert.match(worldDetailSource, /semanticLoading=\{supplementalLoading\}/);
  assert.match(worldDetailSource, /publicAssetsLoading=\{supplementalLoading\}/);
  assert.match(worldDetailSource, /message: 'detail:primary-ready'/);
  assert.match(worldDetailSource, /message: 'detail:history-semantic-settled'/);
  assert.match(worldDetailSource, /message: 'detail:assets-audits-settled'/);
  assert.doesNotMatch(worldDetailSource, /worldCompositeQuery/);
});

test('world detail error state keeps a back escape hatch', () => {
  assert.match(worldDetailTemplateSource, /function WorldDetailErrorState\(\{ onBack \}: \{ onBack\?: \(\) => void \}\)/);
  assert.match(worldDetailTemplateSource, /onClick=\{onBack\}/);
  assert.match(worldDetailTemplateSource, /return <WorldDetailErrorState onBack=\{props\.onBack\} \/>;/);
});

test('explore shares the world list cache key and does not refetch characters when world metadata changes', () => {
  assert.match(explorePanelSource, /fetchWorldListItems\(\)/);
  assert.match(explorePanelSource, /queryKey: worldListQueryKey\(\)/);
  assert.match(explorePanelSource, /queryKey: \['explore-personas', authStatus, selectedCategory, props\.searchText\]/);
  assert.match(explorePanelSource, /const personaSources = useMemo\(/);
  assert.doesNotMatch(explorePanelSource, /dataSync\.loadWorlds\(/);
  assert.doesNotMatch(explorePanelSource, /worldsDataVersion/);
});

test('auth-state-watcher does not duplicate contacts loading (handled by bootstrap-auth + React Query)', () => {
  assert.doesNotMatch(authStateWatcherSource, /loadContacts/);
  assert.doesNotMatch(authStateWatcherSource, /loadSocialSnapshot/);
});
