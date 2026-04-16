import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const appRoutesSource = readWorkspaceFile('src/shell/renderer/app-shell/routes/app-routes.tsx');
const mainLayoutViewSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
const mainLayoutTopbarSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-topbar.tsx');
const navConfigSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/navigation-config.tsx');
const sidebarTooltipSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-sidebar-tooltip-button.tsx');

test('W2 shell redesign: shared status shell adopts AmbientBackground and glass host', () => {
  assert.match(appRoutesSource, /import \{ AmbientBackground, Surface \} from '@nimiplatform\/nimi-kit\/ui';/);
  assert.match(appRoutesSource, /<AmbientBackground[\s\S]*variant="mesh"/);
  assert.match(appRoutesSource, /<Surface[\s\S]*material="glass-thick"/);
  assert.doesNotMatch(appRoutesSource, /function SharedScreenBackdrop/u);
});

test('W2 shell redesign: main layout owns ambient root and glass shell hosts', () => {
  assert.match(mainLayoutViewSource, /import \{ AmbientBackground, ScrollArea, Surface \} from '@nimiplatform\/nimi-kit\/ui';/);
  assert.match(mainLayoutViewSource, /<AmbientBackground[\s\S]*data-testid=\{E2E_IDS\.mainShell\}[\s\S]*variant="mesh"/);
  assert.match(mainLayoutViewSource, /<aside[\s\S]*data-testid=\{E2E_IDS\.shellSidebarRail\}/);
  assert.match(mainLayoutViewSource, /<Surface[\s\S]*tone="overlay"[\s\S]*material="glass-thick"/);
});

test('W2 shell redesign: shell chrome tooltips and topbar use shared material language', () => {
  assert.match(mainLayoutTopbarSource, /import \{ Tooltip \} from '@nimiplatform\/nimi-kit\/ui';/);
  assert.match(mainLayoutTopbarSource, /SHELL_CHROME_ACTION_CELL_CLASS/);
  assert.match(mainLayoutTopbarSource, /SHELL_CHROME_METRIC_CELL_CLASS/);
  assert.match(navConfigSource, /import \{ Surface \} from '@nimiplatform\/nimi-kit\/ui';/);
  assert.match(navConfigSource, /<Surface[\s\S]*tone="overlay"[\s\S]*material="glass-thick"/);
  assert.match(sidebarTooltipSource, /import \{ Surface \} from '@nimiplatform\/nimi-kit\/ui';/);
  assert.match(sidebarTooltipSource, /<Surface[\s\S]*tone="overlay"[\s\S]*material="glass-thick"/);
});
