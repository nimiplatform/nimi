import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { RUNTIME_PAGE_META } from '../src/shell/renderer/features/runtime-config/runtime-config-meta-v11';
import { readDesktopLocale } from './helpers/read-desktop-locale';

const sidebarSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-sidebar.tsx'),
  'utf8',
);

const panelViewSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-panel-view.tsx'),
  'utf8',
);

const modelsPageSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-models.tsx'),
  'utf8',
);

const recommendPageSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-recommend.tsx'),
  'utf8',
);

const recommendSectionsSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-recommend-sections.tsx'),
  'utf8',
);

const detailSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-recommend-detail.tsx'),
  'utf8',
);

const enLocale = readDesktopLocale('en');
const zhLocale = readDesktopLocale('zh');

// T2.4 six-section IA: `recommend` is no longer a top-level Runtime section.
// It lives as a sub-tab inside the canonical `Models` section.

test('runtime config sidebar exposes Models as a canonical six-section IA entry', () => {
  assert.match(
    sidebarSource,
    /{\s*id:\s*'models',\s*section:\s*'Runtime',\s*label:\s*'Models',\s*icon:\s*ICON_MODELS,\s*}/s,
  );
  // Retired top-level entries must not survive.
  assert.doesNotMatch(sidebarSource, /id:\s*'recommend'/);
  assert.doesNotMatch(sidebarSource, /id:\s*'catalog'/);
});

test('runtime config panel mounts the Models section with a stable page root', () => {
  assert.match(
    panelViewSource,
    /activePage === 'models'[\s\S]*?data-testid=\{E2E_IDS\.runtimePageRoot\('models'\)\}[\s\S]*?<ModelsPage model=\{model\} state=\{state\} \/>/s,
  );
});

test('Models section composes the recommend sub-tab', () => {
  assert.match(modelsPageSource, /RecommendPage/);
  assert.match(modelsPageSource, /runtime-models-subtab:/);
  assert.match(modelsPageSource, /E2E_IDS\.runtimeModelsPane\('recommend'\)/);
  // The three retired sections all collapse into Models sub-tabs.
  assert.match(modelsPageSource, /LocalPage/);
  assert.match(modelsPageSource, /CatalogPage/);
});

test('Models section defaults to the installed sub-tab', () => {
  assert.match(modelsPageSource, /useState<ModelsSubTabId>\('installed'\)/);
});

test('recommend page keeps device profile bar, tier summary, and filter toolbar', () => {
  assert.match(recommendPageSource, /DeviceProfileBar/);
  assert.match(recommendPageSource, /TierSummaryBar/);
  assert.match(recommendPageSource, /ModelRow/);
});

test('recommend filter dropdowns render through portal popovers', () => {
  assert.match(recommendSectionsSource, /PopoverContent/);
  assert.match(recommendSectionsSource, /<Popover open=\{open\} onOpenChange=\{setOpen\}>/);
  assert.doesNotMatch(recommendSectionsSource, /absolute\s+left-0\s+z-50/);
  assert.doesNotMatch(recommendSectionsSource, /fixed\s+inset-0\s+z-40/);
});

test('recommend single-select chips make the selected value visually explicit', () => {
  assert.match(
    recommendSectionsSource,
    /<span className="font-semibold text-\[var\(--nimi-action-primary-bg\)\]">\{displayLabel\}<\/span>/,
  );
  assert.doesNotMatch(recommendSectionsSource, /<span className="text-\[var\(--nimi-text-secondary\)\]">\{displayLabel\}<\/span>/);
});

test('recommend capability dropdown uses the compact single-select menu width', () => {
  assert.match(recommendSectionsSource, /contentClassName\?: string/);
  assert.match(
    recommendPageSource,
    /label=\{t\('runtimeConfig\.recommend\.capabilityLabel'[\s\S]*?contentClassName="w-40 overflow-hidden rounded-xl bg-white p-0"/,
  );
});

test('recommend page retries empty or stale model-index snapshots on mount', () => {
  assert.match(recommendPageSource, /cacheState === 'fresh' \? 24 \* 60 \* 60 \* 1000 : 0/);
  assert.match(recommendPageSource, /refetchOnMount:\s*true/);
});

test('runtime page meta defines Models section copy', () => {
  assert.equal(RUNTIME_PAGE_META.models.name, 'Models');
  assert.match(RUNTIME_PAGE_META.models.description, /catalog/i);
});

test('RecommendDetailPage is exported from detail source', () => {
  assert.match(detailSource, /export function RecommendDetailPage/);
});

test('recommend page imports and renders RecommendDetailPage for detail navigation', () => {
  assert.match(recommendPageSource, /RecommendDetailPage/);
  assert.match(recommendPageSource, /selectedDetailItem/);
});

test('recommend locale keys exist in english and chinese bundles', () => {
  assert.equal(typeof enLocale.runtimeConfig?.recommend?.heroTitle, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.recommend?.whyRankingTitle, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.sidebar?.models, 'string');

  assert.equal(typeof zhLocale.runtimeConfig?.recommend?.heroTitle, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.recommend?.whyRankingTitle, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.sidebar?.models, 'string');
});
