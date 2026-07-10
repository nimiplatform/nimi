import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const panelSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-panel-view.tsx');
const pageShellSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-page-shell.tsx');
const overviewSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-page-overview.tsx');
const loadUsageSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-overview-load-usage.tsx');

test('Runtime compact density keeps the approved title scale while tightening the shell and sidebar', () => {
  assert.match(pageShellSource, /space-y-4 px-4 py-4/);
  assert.match(panelSource, /flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-3 pb-3 pt-2 xl:flex-row/);
  assert.match(panelSource, /SidebarHeader[\s\S]*text-xl[\s\S]*className="px-4"/);
  assert.match(panelSource, /contentClassName="px-2 pb-2 pt-1"/);
  assert.match(panelSource, /<SidebarItem[\s\S]*className="text-\[length:var\(--nimi-type-body-sm-size\)\]"/);
  assert.match(panelSource, /<h2 className="text-xl/);
  assert.doesNotMatch(panelSource, /text-(?:3xl|4xl|5xl)/);
});

test('Runtime compact density uses admitted overview card and section spacing', () => {
  assert.match(overviewSource, /mt-1 text-2xl font-bold/);
  assert.match(overviewSource, /w-full min-w-0 p-4 text-center/);
  assert.match(overviewSource, /mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3/);
  assert.doesNotMatch(overviewSource, /<section className="mt-/);
  assert.match(overviewSource, /TOKEN_PANEL_CARD, 'mt-2 p-4'/);
  assert.match(overviewSource, /grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3/);
  assert.doesNotMatch(overviewSource, /text-(?:3xl|4xl|5xl)/);
});

test('Runtime load and usage cards follow compact-density spacing', () => {
  assert.match(loadUsageSource, /<section>/);
  assert.match(loadUsageSource, /mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2/);
  assert.equal((loadUsageSource.match(/TOKEN_PANEL_CARD, 'p-4'/g) || []).length, 2);
  assert.equal((loadUsageSource.match(/<div className="mb-3">/g) || []).length, 2);
  assert.match(loadUsageSource, /<div className="space-y-2">/);
});
