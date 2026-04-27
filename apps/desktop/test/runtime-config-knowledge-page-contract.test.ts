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

const knowledgePageSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-knowledge.tsx'),
  'utf8',
);

const knowledgeDiscoveryActionsSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-knowledge-discovery-actions.ts'),
  'utf8',
);

const knowledgeServiceSource = readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-knowledge-sdk-service.ts'),
  'utf8',
);

const enLocale = readDesktopLocale('en');
const zhLocale = readDesktopLocale('zh');

test('runtime config sidebar exposes knowledge as an operations page', () => {
  assert.match(
    sidebarSource,
    /{\s*id:\s*'knowledge',\s*section:\s*'Operations',\s*label:\s*'Knowledge',\s*icon:\s*ICON_KNOWLEDGE,\s*}/s,
  );
});

test('runtime config panel mounts knowledge page with a stable page root', () => {
  assert.match(
    panelViewSource,
    /activePage === 'knowledge'[\s\S]*?data-testid=\{E2E_IDS\.runtimePageRoot\('knowledge'\)\}[\s\S]*?<KnowledgePage model=\{model\} \/>/s,
  );
});

test('runtime page meta defines knowledge page copy', () => {
  assert.equal(RUNTIME_PAGE_META.knowledge.name, 'Knowledge');
  assert.match(RUNTIME_PAGE_META.knowledge.description, /runtime-local knowledge banks, pages, search, ingest tasks, and same-bank graph\/backlink inspection/i);
});

test('knowledge page composes bank list, page editor, ingest, search, and graph sections', () => {
  assert.match(knowledgePageSource, /createRuntimeKnowledgeBank/);
  assert.match(knowledgePageSource, /putRuntimeKnowledgePage/);
  assert.match(knowledgePageSource, /ingestRuntimeKnowledgeDocument/);
  assert.match(knowledgePageSource, /getRuntimeKnowledgeIngestTask/);
  assert.match(knowledgePageSource, /createKnowledgeDiscoveryActions/);
  assert.match(knowledgePageSource, /loadMoreSearchHits/);
  assert.match(knowledgePageSource, /loadMoreBanks/);
  assert.match(knowledgePageSource, /loadMorePages/);
  assert.match(knowledgeDiscoveryActionsSource, /searchRuntimeKnowledgeKeyword/);
  assert.match(knowledgeDiscoveryActionsSource, /searchRuntimeKnowledgeHybrid/);
  assert.match(knowledgeDiscoveryActionsSource, /addRuntimeKnowledgeLink/);
  assert.match(knowledgeDiscoveryActionsSource, /listRuntimeKnowledgeLinks/);
  assert.match(knowledgeDiscoveryActionsSource, /listRuntimeKnowledgeBacklinks/);
  assert.match(knowledgeDiscoveryActionsSource, /traverseRuntimeKnowledgeGraph/);
  assert.match(knowledgeDiscoveryActionsSource, /loadMoreSearchHits/);
});

test('knowledge sdk service stays on admitted runtime knowledge methods', () => {
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.listKnowledgeBanks/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.createKnowledgeBank/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.putPage/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.ingestDocument/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.getIngestTask/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.searchKeyword/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.searchHybrid/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.addLink/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.removeLink/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.listLinks/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.listBacklinks/);
  assert.match(knowledgeServiceSource, /runtimeKnowledge\(\)\.traverseGraph/);
  assert.doesNotMatch(knowledgeServiceSource, /BuildIndex|SearchIndex|DeleteIndex/);
});

test('knowledge locale keys exist in english and chinese bundles', () => {
  assert.equal(typeof enLocale.runtimeConfig?.sidebar?.knowledge, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.knowledge?.contextTitle, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.knowledge?.searchTitle, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.knowledge?.ingestTaskTitle, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.knowledge?.searchModeHybrid, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.knowledge?.hybridUnavailableTitle, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.knowledge?.graphTitle, 'string');
  assert.equal(typeof enLocale.runtimeConfig?.knowledge?.outgoingLinks, 'string');

  assert.equal(typeof zhLocale.runtimeConfig?.sidebar?.knowledge, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.knowledge?.contextTitle, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.knowledge?.searchTitle, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.knowledge?.ingestTaskTitle, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.knowledge?.searchModeHybrid, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.knowledge?.hybridUnavailableTitle, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.knowledge?.graphTitle, 'string');
  assert.equal(typeof zhLocale.runtimeConfig?.knowledge?.outgoingLinks, 'string');
});
