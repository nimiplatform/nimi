import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const storeTypesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/app-shell/providers/store-types.ts'),
  'utf8',
);
const shellModeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../_libs/shell-core/src/shell-mode.ts'),
  'utf8',
);

// D-SHELL-001: AppTab type includes all required navigation tabs

test('D-SHELL-001: AppTab type includes home', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'home'/);
});

test('D-SHELL-001: AppTab type includes chat', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'chat'/);
});

test('D-SHELL-001: AppTab type includes contacts', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'contacts'/);
});

test('D-SHELL-001: AppTab type includes world', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'world'/);
});

test('D-SHELL-001: AppTab type includes runtime', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'runtime'/);
});

test('D-SHELL-001: AppTab type includes settings', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'settings'/);
});

test('D-SHELL-001: AppTab type includes marketplace', () => {
  assert.match(storeTypesSource, /\bAppTab\b[\s\S]*?\|\s*'marketplace'/);
});

// D-SHELL-008: Feature flags gate runtime and marketplace tabs

test('D-SHELL-008: feature flags include enableRuntimeTab', () => {
  assert.match(shellModeSource, /enableRuntimeTab:\s*\w+/);
});

test('D-SHELL-008: feature flags include enableMarketplaceTab', () => {
  assert.match(shellModeSource, /enableMarketplaceTab:\s*\w+/);
});
