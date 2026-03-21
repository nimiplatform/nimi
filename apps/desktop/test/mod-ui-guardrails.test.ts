import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const STATUS_BANNER_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/ui/feedback/status-banner.tsx'),
  'utf8',
);
const SYNC_RUNTIME_EXTENSIONS_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/lifecycle/sync-runtime-extensions.tsx'),
  'utf8',
);
const RUNTIME_QUERY_PANEL_VIEW_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/host/view.tsx'),
  'utf8',
);
const DEVELOPER_HOST_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/lifecycle/runtime-mod-developer-host.ts'),
  'utf8',
);
const SLOT_HOST_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/host/slot-host.tsx'),
  'utf8',
);
const SHELL_STATE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/lifecycle/runtime-mod-shell-state.ts'),
  'utf8',
);

test('status banner truncates and normalizes long messages before rendering', () => {
  assert.match(STATUS_BANNER_SOURCE, /STATUS_BANNER_MAX_MESSAGE_LENGTH = 200/);
  assert.match(STATUS_BANNER_SOURCE, /formatStatusBannerMessage/);
  assert.match(STATUS_BANNER_SOURCE, /replace\(\/\\s\+\/g, ' '\)/);
});

test('mod ui slot sync reuses shared slot ids and reactive retention checks', () => {
  assert.match(SYNC_RUNTIME_EXTENSIONS_SOURCE, /UI_SLOT_IDS/);
  assert.doesNotMatch(SYNC_RUNTIME_EXTENSIONS_SOURCE, /const SLOT_ALLOWLIST = new Set/);
  assert.match(SYNC_RUNTIME_EXTENSIONS_SOURCE, /context\.isModTabRetained/);
});

test('runtime query panel view uses i18n instead of hardcoded Chinese labels', () => {
  assert.match(RUNTIME_QUERY_PANEL_VIEW_SOURCE, /i18n\.t\('ModUI\.queryLoading'/);
  assert.match(RUNTIME_QUERY_PANEL_VIEW_SOURCE, /i18n\.t\('ModUI\.queryRun'/);
  assert.doesNotMatch(RUNTIME_QUERY_PANEL_VIEW_SOURCE, /加载中\.\.\.|运行/);
});

test('developer host attachment is single-flight and reports async subscription callback errors', () => {
  assert.match(DEVELOPER_HOST_SOURCE, /runtimeModDeveloperHostSubscriptionsPromise/);
  assert.match(DEVELOPER_HOST_SOURCE, /reportDeveloperHostSubscriptionError\('source-change'/);
  assert.match(DEVELOPER_HOST_SOURCE, /reportDeveloperHostSubscriptionError\('reload-result'/);
  assert.match(DEVELOPER_HOST_SOURCE, /runtimeModDeveloperHostSubscriptionsAttached = true/);
});

test('slot host and runtime mod shell state avoid sentinel strings and eager store defaults', () => {
  assert.match(SLOT_HOST_SOURCE, /useState<string \| null>\(null\)/);
  assert.doesNotMatch(SLOT_HOST_SOURCE, /useState<string>\(''\)/);
  assert.match(SHELL_STATE_SOURCE, /const effectiveManifests = manifests \?\? useAppStore\.getState\(\)\.localManifestSummaries/);
});
