import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const worldFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/data/realm-world-data.ts'),
  'utf8',
);
const worldDetailQueriesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-queries.ts'),
  'utf8',
);
const worldDetailActivePanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-active-panel.tsx'),
  'utf8',
);
const worldDetailSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail.tsx'),
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

test('world semantic bundle no longer fetches world detail before worldview', () => {
  const semanticStart = worldFlowSource.indexOf('export async function loadWorldSemanticBundle');
  const semanticEnd = worldFlowSource.indexOf('\nexport const realmWorldData', semanticStart);
  const semanticBundleSection = worldFlowSource.slice(semanticStart, semanticEnd);
  assert.match(semanticBundleSection, /getWorldCore\(realm, worldId\)/);
  assert.match(semanticBundleSection, /semanticBundle/);
  assert.doesNotMatch(semanticBundleSection, /loadWorldDetailById/);
  assert.doesNotMatch(semanticBundleSection, /catch\s*\{\s*return null;\s*\}/);
});

test('world detail prefetch is limited to first-screen queries', () => {
  const prefetchSection = worldDetailQueriesSource.slice(
    worldDetailQueriesSource.indexOf('export function prefetchWorldDetailAndHistory'),
  );
  assert.match(prefetchSection, /worldDisplayDetailQueryKey/);
  assert.match(prefetchSection, /fetchWorldDisplayDetail/);
  assert.doesNotMatch(prefetchSection, /worldListQueryKey/);
  assert.doesNotMatch(prefetchSection, /worldDetailWithAgentsQueryKey/);
  assert.doesNotMatch(prefetchSection, /worldHistoryQueryKey/);
  assert.doesNotMatch(prefetchSection, /worldSemanticBundleQueryKey/);
  assert.doesNotMatch(prefetchSection, /worldLevelAuditsQueryKey/);
  assert.doesNotMatch(prefetchSection, /worldPublicAssetsQueryKey/);
});

test('world detail primary query adopts SDK WorldCore through a bounded adapter', () => {
  const oldRootSingletonPattern = new RegExp('get' + 'PlatformClient');
  assert.match(worldDetailQueriesSource, /toWorldListItem\(asRecord\(detailValue\)\)/);
  assert.doesNotMatch(worldDetailQueriesSource, oldRootSingletonPattern);
  assert.match(worldDetailQueriesSource, /realmWorldData\.loadWorldSemanticBundle/);
  assert.match(worldDetailQueriesSource, /realmWorldData\.loadWorldDetailWithAgents/);
  assert.doesNotMatch(worldDetailQueriesSource, /mergeNimiRealmWorldPrimaryDetailTruth/);
  assert.doesNotMatch(worldDetailQueriesSource, /WORLD_DETAIL_WORLD_TRUTH_INVALID/);
});

test('world detail panel can resolve the selected world from cache before world list finishes loading', () => {
  assert.match(worldDetailActivePanelSource, /queryClient\.getQueryData<ReturnType<typeof toWorldListItem>\[\]>/);
  assert.match(worldDetailActivePanelSource, /queryClient\.getQueryData<WorldDisplayDetail>/);
  assert.match(worldDetailActivePanelSource, /fetchWorldListItems\(\)/);
  assert.match(worldDetailActivePanelSource, /worldDisplayDetailQueryKey\(selectedWorldId\)/);
  assert.match(worldDetailActivePanelSource, /toWorldListItem\(cachedWorldDetail\.primary\)/);
  assert.match(worldDetailActivePanelSource, /const selectedWorld = worldsQuery\.data\?\.find/);
  assert.match(worldDetailActivePanelSource, /if \(!selectedWorld && worldsQuery\.isPending\)/);
});

test('world detail only treats the primary query as a page-level error and defers non-critical sections', () => {
  assert.match(worldDetailSource, /const initialError = !initialLoading/);
  assert.match(worldDetailSource, /const supplementalError = display/);
  assert.match(worldDetailSource, /Object\.values\(display\.sections\)\.some\(\(status\) => status === 'error'\)/);
  assert.match(worldDetailSource, /const pageError = initialError \|\| supplementalError/);
  assert.match(worldDetailSource, /message: 'detail:primary-ready'/);
  assert.match(worldDetailSource, /message: 'detail:history-semantic-settled'/);
  assert.match(worldDetailSource, /message: 'detail:assets-audits-settled'/);
});

test('world detail error state keeps a back escape hatch', () => {
  assert.match(worldDetailTemplateSource, /function WorldDetailErrorState\(\{ onBack \}: \{ onBack\?: \(\) => void \}\)/);
  assert.match(worldDetailTemplateSource, /onClick=\{onBack\}/);
  assert.match(worldDetailTemplateSource, /return <WorldDetailErrorState onBack=\{props\.onBack\} \/>;/);
});

test('explore shares the world list cache key and does not refetch agents when world metadata changes', () => {
  assert.match(explorePanelSource, /fetchWorldListItems\(\)/);
  assert.match(explorePanelSource, /queryKey: worldListQueryKey\(\)/);
  assert.match(explorePanelSource, /queryKey: \['explore-agents', authStatus, selectedCategory, props\.searchText\]/);
  assert.match(explorePanelSource, /const agents = useMemo\(/);
  assert.doesNotMatch(explorePanelSource, /dataSync\.loadWorlds\(/);
  assert.doesNotMatch(explorePanelSource, /worldsDataVersion/);
});

test('auth-state-watcher does not duplicate contacts loading (handled by bootstrap-auth + React Query)', () => {
  assert.doesNotMatch(authStateWatcherSource, /loadContacts/);
  assert.doesNotMatch(authStateWatcherSource, /loadSocialSnapshot/);
});
