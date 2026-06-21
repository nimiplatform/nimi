import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const profileLibraryPanelSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-profile-library-panel.tsx'),
  'utf8',
);
const runtimeConfigEnLocale = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/locales/en/46-runtimeConfig.json'),
  'utf8',
);
const runtimeConfigZhLocale = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/locales/zh/46-runtimeConfig.json'),
  'utf8',
);

function snippetFrom(source: string, startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern);
  assert.notEqual(start, -1, `missing ${startPattern}`);
  const end = source.indexOf(endPattern, start);
  assert.notEqual(end, -1, `missing ${endPattern}`);
  return source.slice(start, end + endPattern.length);
}

test('Runtime Profiles toolbar exposes compact refresh and no unused view or favorites-only controls', () => {
  const refreshButtonSource = snippetFrom(
    profileLibraryPanelSource,
    'data-testid="runtime-profiles-refresh"',
    '</button>',
  );

  assert.match(profileLibraryPanelSource, /data-testid="runtime-profiles-refresh"/);
  assert.match(profileLibraryPanelSource, /onClick=\{props\.onRefresh\}/);
  assert.match(refreshButtonSource, /h-8 w-8/);
  assert.match(refreshButtonSource, /rounded-full/);
  assert.match(refreshButtonSource, /<RefreshIcon className="h-3\.5 w-3\.5" \/>/);
  assert.doesNotMatch(refreshButtonSource, /border border-\[var\(--nimi-border-subtle\)\]/);
  assert.doesNotMatch(profileLibraryPanelSource, /data-testid="runtime-profiles-favorites-toggle"/);
  assert.doesNotMatch(profileLibraryPanelSource, /favoritesOnly/);
  assert.doesNotMatch(profileLibraryPanelSource, /Toggle/);
  assert.doesNotMatch(profileLibraryPanelSource, /h-8 w-8 items-center justify-center rounded-lg/);
  assert.doesNotMatch(profileLibraryPanelSource, /data-testid="runtime-profiles-view-toggle"/);
  assert.doesNotMatch(profileLibraryPanelSource, /runtimeConfig\.profiles\.gridView/);
  assert.doesNotMatch(runtimeConfigEnLocale, /"favoritesOnly"\s*:/);
  assert.doesNotMatch(runtimeConfigEnLocale, /"gridView"\s*:/);
  assert.doesNotMatch(runtimeConfigZhLocale, /"favoritesOnly"\s*:/);
  assert.doesNotMatch(runtimeConfigZhLocale, /"gridView"\s*:/);
});
