import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const settingsPanelBodySource = readWorkspaceFile('src/shell/renderer/features/settings/settings-panel-body.tsx');
const settingsLayoutSource = readWorkspaceFile('src/shell/renderer/features/settings/settings-layout-components.tsx');
const runtimePanelViewSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-panel-view.tsx');
const runtimePageShellSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-page-shell.tsx');
const runtimePrimitivesSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-primitives.tsx');

test('W4 dense surfaces: settings route uses a glass shell host and transparent page shell', () => {
  assert.match(settingsPanelBodySource, /<Surface[\s\S]*tone="panel"[\s\S]*material="glass-regular"[\s\S]*renderSettingsPage\(selectedId\)/);
  assert.doesNotMatch(settingsPanelBodySource, /className="flex min-h-0 flex-1 bg-white"/u);
  assert.match(settingsLayoutSource, /<KitSettingsPageShell[\s\S]*scrollClassName="bg-transparent"[\s\S]*viewportClassName="bg-transparent"/);
});

test('W4 dense surfaces: runtime route uses a glass shell host with solid-first cards', () => {
  assert.match(runtimePanelViewSource, /<Surface[\s\S]*as="main"[\s\S]*tone="panel"[\s\S]*material="glass-regular"/);
  assert.doesNotMatch(runtimePanelViewSource, /<main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">/u);
  assert.match(runtimePageShellSource, /mx-auto w-full space-y-6 px-5 py-5/);
  assert.match(runtimePrimitivesSource, /<Surface[\s\S]*tone="card"[\s\S]*material="solid"/);
});
