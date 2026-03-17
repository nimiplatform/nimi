import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { RUNTIME_PAGE_META } from '../src/shell/renderer/features/runtime-config/runtime-config-meta-v11';

const sidebarSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-sidebar.tsx'),
  'utf8',
);

const panelViewSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-panel-view.tsx'),
  'utf8',
);

const recommendPageSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-recommend.tsx'),
  'utf8',
);

const enLocale = JSON.parse(readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/locales/en.json'),
  'utf8',
));

const zhLocale = JSON.parse(readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/locales/zh.json'),
  'utf8',
));

test('runtime config sidebar exposes recommend as a core page', () => {
  assert.match(
    sidebarSource,
    /{\s*id:\s*'recommend',\s*section:\s*'Core',\s*label:\s*'Recommend',\s*icon:\s*ICON_RECOMMEND,\s*}/s,
  );
});

test('runtime config panel mounts recommend page with a stable page root', () => {
  assert.match(
    panelViewSource,
    /activePage === 'recommend'[\s\S]*?data-testid=\{E2E_IDS\.runtimePageRoot\('recommend'\)\}[\s\S]*?<RecommendPage model=\{model\} state=\{state\} \/>/s,
  );
});

test('recommend page keeps machine summary, ranking explainer, and install review sections', () => {
  assert.match(recommendPageSource, /runtimeConfig\.recommend\.heroTitle/);
  assert.match(recommendPageSource, /runtimeConfig\.recommend\.whyRankingTitle/);
  assert.match(recommendPageSource, /runtimeConfig\.recommend\.installPreviewTitle/);
});

test('runtime page meta defines recommend page copy', () => {
  assert.equal(RUNTIME_PAGE_META.recommend.name, 'Recommend');
  assert.match(RUNTIME_PAGE_META.recommend.description, /Model-index powered leaderboard/i);
});

test('recommend locale keys exist in english and chinese bundles', () => {
  assert.equal(typeof enLocale.runtimeConfig?.recommend?.heroTitle, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.recommend?.whyRankingTitle, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.sidebar?.recommend, 'string');

  assert.equal(typeof zhLocale.runtimeConfig?.recommend?.heroTitle, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.recommend?.whyRankingTitle, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.sidebar?.recommend, 'string');
});
