import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const dataSyncFacadeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade.ts'),
  'utf8',
);
const worldFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/flows/world-flow.ts'),
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

test('desktop DataSync reuses a Realm client instead of routing calls through withRealmContextLock', () => {
  assert.match(dataSyncFacadeSource, /private realmClient: Realm \| null = null;/);
  assert.match(dataSyncFacadeSource, /const realm = this\.getRealmClient\(\);/);
  assert.doesNotMatch(dataSyncFacadeSource, /withRealmContextLock/);
});

test('world semantic bundle no longer fetches world detail before worldview', () => {
  const semanticBundleSection = worldFlowSource.slice(
    worldFlowSource.indexOf('export async function loadWorldSemanticBundle'),
  );
  assert.match(semanticBundleSection, /worldControllerGetWorldview/);
  assert.doesNotMatch(semanticBundleSection, /loadWorldDetailById\(callApi, emitDataSyncError, normalizedWorldId\)/);
  assert.match(semanticBundleSection, /world: null/);
});

test('world detail prefetch is limited to first-screen queries', () => {
  const prefetchSection = worldDetailQueriesSource.slice(
    worldDetailQueriesSource.indexOf('export function prefetchWorldDetailAndHistory'),
  );
  assert.match(prefetchSection, /worldDetailWithAgentsQueryKey/);
  assert.match(prefetchSection, /worldHistoryQueryKey/);
  assert.match(prefetchSection, /worldSemanticBundleQueryKey/);
  assert.doesNotMatch(prefetchSection, /worldListQueryKey/);
  assert.doesNotMatch(prefetchSection, /worldLevelAuditsQueryKey/);
  assert.doesNotMatch(prefetchSection, /worldPublicAssetsQueryKey/);
});

test('world detail panel can resolve the selected world from cache before world list finishes loading', () => {
  assert.match(worldDetailActivePanelSource, /queryClient\.getQueryData<ReturnType<typeof toWorldListItem>\[\]>/);
  assert.match(worldDetailActivePanelSource, /worldDetailWithAgentsQueryKey\(selectedWorldId\)/);
  assert.match(worldDetailActivePanelSource, /const selectedWorld = worldsQuery\.data\?\.find/);
  assert.match(worldDetailActivePanelSource, /if \(!selectedWorld && worldsQuery\.isPending\)/);
});

test('world detail only treats the primary query as a page-level error and defers non-critical sections', () => {
  assert.match(worldDetailSource, /const initialError = !initialLoading/);
  assert.match(worldDetailSource, /enabled: isReady && worldCompositeQuery\.isSuccess/);
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
  assert.match(explorePanelSource, /queryKey: worldListQueryKey\(\)/);
  assert.match(explorePanelSource, /queryKey: \['explore-agents', authStatus, selectedCategory, searchText\]/);
  assert.match(explorePanelSource, /const agents = useMemo\(/);
  assert.doesNotMatch(explorePanelSource, /worldsDataVersion/);
});

test('auth preload warms lightweight contacts instead of the full social snapshot', () => {
  assert.match(authStateWatcherSource, /void dataSync\.loadContacts\(\)\.catch\(\(error\) => \{/);
  assert.match(authStateWatcherSource, /message: 'phase:auth-contacts-prewarm:failed'/);
  assert.doesNotMatch(authStateWatcherSource, /void dataSync\.loadSocialSnapshot\(\)\.catch\(\(\) => \{\}\);/);
  assert.doesNotMatch(authStateWatcherSource, /void dataSync\.loadContacts\(\)\.catch\(\(\) => \{\}\);/);
});
