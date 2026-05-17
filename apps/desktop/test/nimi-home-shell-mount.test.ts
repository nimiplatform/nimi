import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const mainLayoutViewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout-view.tsx'),
  'utf8',
);
const uiSliceSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/providers/ui-slice.ts'),
  'utf8',
);
const nimiHomePanelSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/nimi-home/nimi-home-panel.tsx'),
  'utf8',
);

test('Nimi Home shell mounts the dedicated Nimi Home panel on the home tab', () => {
  assert.match(mainLayoutViewSource, /features\/nimi-home\/nimi-home-panel/);
  assert.doesNotMatch(mainLayoutViewSource, /features\/home\/home-panel/);
  assert.match(mainLayoutViewSource, /default:\s*mod\.NimiHomePanel/);
});

test('Nimi Home is the initial desktop shell tab', () => {
  assert.match(uiSliceSource, /activeTab:\s*'home'/);
  assert.doesNotMatch(uiSliceSource, /activeTab:\s*'chat'/);
});

test('Nimi Home panel reaches readiness, Library, Discovery, and Agent Chat reference surfaces', () => {
  for (const expected of [
    'FirstRunReadinessView',
    'LibraryView',
    'DiscoveryView',
    'AgentChatReference',
  ]) {
    assert.ok(nimiHomePanelSource.includes(expected), `missing ${expected}`);
  }
});

test('Nimi Home panel uses fail-closed unavailable states for missing live bridges', () => {
  assert.match(nimiHomePanelSource, /appRegistry:\s*'unavailable'/);
  assert.match(nimiHomePanelSource, /cognitionMemory:\s*'unavailable'/);
  assert.match(nimiHomePanelSource, /Nimi App registry bridge is not mounted yet/);
});

test('Nimi Home panel carries explicit AIScopeRef posture through Agent Chat binding', () => {
  assert.match(nimiHomePanelSource, /scopeRef:\s*\{\s*kind:\s*'first-run'/);
  assert.match(nimiHomePanelSource, /scopeId:\s*'nimi-home-agent-chat'/);
});
