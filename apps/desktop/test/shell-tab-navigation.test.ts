import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const storeTypesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/app-shell/providers/store-types.ts'),
  'utf8',
);
const navigationConfigSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/navigation-config.tsx'),
  'utf8',
);
const mainLayoutSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout.tsx'),
  'utf8',
);
const mainLayoutViewSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout-view.tsx'),
  'utf8',
);
const shellModeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/core/src/shell-mode.ts'),
  'utf8',
);

// D-SHELL-001: AppTab type includes all required navigation tabs

test('D-SHELL-001: AppTab type includes home', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'home'/);
});

test('D-SHELL-001: AppTab type includes chat', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'chat'/);
});

test('D-CONTACTS-000: AppTab type excludes retired contacts page', () => {
  assert.doesNotMatch(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'contacts'/);
});

test('D-SHELL-001: AppTab type includes explore', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'explore'/);
});

test('D-SHELL-001: AppTab type includes apps', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'apps'/);
});

test('D-SHELL-001: AppTab type includes runtime', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'runtime'/);
});

test('D-SHELL-001: AppTab type includes settings', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'settings'/);
});

test('D-SHELL-001: AppTab type excludes retired mods page', () => {
  assert.doesNotMatch(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'mods'/);
});

test('D-SHELL-001: AppTab type excludes retired primary world tab', () => {
  assert.doesNotMatch(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'world'/);
});

test('D-SHELL-001: core nav source is the product primary order', () => {
  const itemMatches = [...navigationConfigSource.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)'/g)];
  const coreIds = itemMatches.map((match) => match[1]);
  const labelsById = new Map(itemMatches.map((match) => [match[1], match[2]]));
  assert.deepEqual(coreIds, ['home', 'chat', 'explore', 'apps', 'runtime']);
  assert.equal(coreIds.includes('world'), false);
  assert.equal(labelsById.get('runtime'), 'Runtime');
  assert.equal(labelsById.get('apps'), 'Apps');
});

test('D-SHELL-001: core nav is not gated by runtime flag', () => {
  const coreNavFunction = navigationConfigSource.slice(
    navigationConfigSource.indexOf('export function getCoreNavItems'),
    navigationConfigSource.indexOf('export function getQuickNavItems'),
  );
  assert.doesNotMatch(coreNavFunction, /enableRuntimeTab/);
  assert.doesNotMatch(mainLayoutSource, /!flags\.enableRuntimeTab && activeTab === 'runtime'/);
  assert.doesNotMatch(mainLayoutViewSource, /props\.activeTab === 'runtime' && flags\.enableRuntimeTab/);
});

test('D-SHELL-001: ordinary primary rail does not inject mods as product nav', () => {
  assert.doesNotMatch(mainLayoutViewSource, /item=\{modsNavItem\}/);
  assert.doesNotMatch(mainLayoutViewSource, /E2E_IDS\.navTab\('mods'\)/);
});

// D-SHELL-008: Feature flags gate runtime shell behavior

test('D-SHELL-008: feature flags include enableRuntimeTab', () => {
  assert.match(shellModeSource, /enableRuntimeTab:\s*\w+/);
});

test('D-SHELL-008: feature flags exclude retired mod UI toggles', () => {
  assert.doesNotMatch(shellModeSource, /enableModUi|enableModWorkspaceTabs|VITE_NIMI_ENABLE_MOD_DEVELOPER_UI/);
});
