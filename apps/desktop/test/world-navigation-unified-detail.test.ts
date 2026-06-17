import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const worldListSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-list.tsx'),
  'utf8',
);
const mainLayoutSource = [
  fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout-view.tsx'),
    'utf8',
  ),
  fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout-panel-stack.tsx'),
    'utf8',
  ),
].join('\n');
const worldDetailSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail.tsx'),
  'utf8',
);
const worldDetailRouteStateSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/world/world-detail-route-state.tsx'),
  'utf8',
);
const explorePanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/explore/explore-panel.tsx'),
  'utf8',
);
const agentDetailPanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/source-detail/source-detail-panel.tsx'),
  'utf8',
);
const uiSliceSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/app-shell/providers/ui-slice.ts'),
  'utf8',
);

test('Explore-owned World list routes detail entry through navigateToWorld unified path', () => {
  // D-EXPL-001: the standalone World surface folds into Explore; the World
  // list lives in the Explore panel, not a parallel standalone WorldList.
  assert.doesNotMatch(worldListSource, /export function WorldList\b/);
  assert.match(explorePanelSource, /const navigateToWorld = useAppStore\(\(state\) => state\.navigateToWorld\)/);
  assert.match(explorePanelSource, /navigateToWorld\(worldId\)/);
});

test('world detail tab renders active world detail panel through route-state loader', () => {
  assert.match(mainLayoutSource, /loadWorldDetailPanelModule\(\)/);
  assert.match(mainLayoutSource, /WorldDetailRouteLoading/);
  assert.match(worldDetailRouteStateSource, /import\('@renderer\/features\/world\/world-detail-active-panel'\)/);
});

test('world detail uses explicit initial loading state to avoid first-render flicker', () => {
  assert.match(worldDetailSource, /const initialLoading = worldCompositeQuery\.isPending && !display/);
  assert.match(worldDetailSource, /loading=\{initialLoading\}/);
});

test('Explore World list click prefetches world detail and history before navigation', () => {
  // World list navigation now lives in the Explore panel (D-EXPL-001 fold).
  assert.match(explorePanelSource, /fetchWorldListItems\(\)/);
  assert.match(explorePanelSource, /prefetchWorldDetailPanel\(\)/);
  assert.match(explorePanelSource, /prefetchWorldDetailAndHistory\(worldId\)/);
  assert.doesNotMatch(explorePanelSource, /dataSync\.loadWorlds\(/);
});

test('explore world banner click prefetches world detail and history before navigation', () => {
  assert.match(explorePanelSource, /fetchWorldListItems\(\)/);
  assert.match(explorePanelSource, /prefetchWorldDetailPanel\(\)/);
  assert.match(explorePanelSource, /prefetchWorldDetailAndHistory\(worldId\)/);
});

test('source detail open world prefetches world detail and history before navigation', () => {
  assert.match(agentDetailPanelSource, /prefetchWorldDetailPanel\(\)/);
  assert.match(agentDetailPanelSource, /prefetchWorldDetailAndHistory\(agent\.worldId\)/);
});

test('world navigation uses a transition to avoid clearing revealed content during detail boot', () => {
  assert.match(uiSliceSource, /startTransition\(\(\) => \{/);
  assert.match(uiSliceSource, /activeTab: 'world-detail'/);
});
