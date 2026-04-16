import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const mainLayoutViewSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
const mainLayoutTopbarSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-topbar.tsx');
const navConfigSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/navigation-config.tsx');
const sidebarTooltipSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-sidebar-tooltip-button.tsx');
const shellChromeClassesSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/shell-chrome-classes.ts');

test('shell chrome retune: rail and topbar shells stay transparent chrome without shell dividers', () => {
  assert.match(mainLayoutViewSource, /<aside[\s\S]*data-testid=\{E2E_IDS\.shellSidebarRail\}/);
  assert.doesNotMatch(mainLayoutViewSource, /<Surface[\s\S]*data-testid=\{E2E_IDS\.shellSidebarRail\}[\s\S]*material="glass-regular"/u);
  assert.doesNotMatch(mainLayoutViewSource, /data-testid=\{E2E_IDS\.shellSidebarRail\}[\s\S]*border-r/u);
  assert.match(mainLayoutTopbarSource, /<div className="flex h-full w-full items-center border-b border-\[color-mix\(in_srgb,var\(--nimi-border-subtle\)_78%,white\)\] px-1">/);
  assert.doesNotMatch(mainLayoutTopbarSource, /<Surface[\s\S]*material="glass-thick"/u);
});

test('shell chrome retune: shell chrome classes tighten radius scale', () => {
  assert.match(shellChromeClassesSource, /SHELL_CHROME_MAIN_HOST_CLASS[\s\S]*rounded-\[20px\]/);
  assert.match(shellChromeClassesSource, /SHELL_CHROME_OVERLAY_CLASS[\s\S]*rounded-\[16px\]/);
  assert.match(shellChromeClassesSource, /SHELL_CHROME_INTERACTIVE_RADIUS_CLASS[\s\S]*rounded-\[12px\]/);
  assert.match(shellChromeClassesSource, /SHELL_CHROME_TOOLTIP_CLASS[\s\S]*rounded-\[12px\]/);
  assert.doesNotMatch(shellChromeClassesSource, /rounded-\[24px\]|rounded-\[18px\]|rounded-\[16px\].*ACTION_CELL|rounded-\[14px\]/u);
});

test('shell chrome retune: nav, home launcher, account menu, and tooltips consume the tighter shell scale', () => {
  assert.match(mainLayoutViewSource, /SidebarTooltipButton[\s\S]*SHELL_CHROME_INTERACTIVE_RADIUS_CLASS/);
  assert.match(mainLayoutViewSource, /<Surface[\s\S]*tone="overlay"[\s\S]*material="glass-thick"[\s\S]*SHELL_CHROME_OVERLAY_CLASS/);
  assert.match(mainLayoutViewSource, /avatarNode[\s\S]*sizeClassName="h-10 w-10"/u);
  assert.match(mainLayoutViewSource, /SHELL_CHROME_MENU_ITEM_BASE_CLASS/);
  assert.match(mainLayoutTopbarSource, /SHELL_CHROME_ACTION_CELL_CLASS/);
  assert.match(mainLayoutTopbarSource, /SHELL_CHROME_METRIC_CELL_CLASS/);
  assert.doesNotMatch(mainLayoutTopbarSource, /openAccountMenu[\s\S]*SHELL_CHROME_ACTION_CELL_CLASS/u);
  assert.match(mainLayoutTopbarSource, /openAccountMenu[\s\S]*className="mr-2 flex h-10 items-center"/u);
  assert.match(mainLayoutTopbarSource, /openAccountMenu[\s\S]*className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-transparent p-0 text-\[var\(--nimi-text-primary\)\] transition-transform duration-150 hover:scale-\[1\.03\]"/u);
  assert.match(navConfigSource, /SHELL_CHROME_INTERACTIVE_RADIUS_CLASS/);
  assert.match(navConfigSource, /SHELL_CHROME_TOOLTIP_CLASS/);
  assert.match(sidebarTooltipSource, /SHELL_CHROME_TOOLTIP_CLASS/);
  assert.doesNotMatch(mainLayoutViewSource, /rounded-\[32px\]|rounded-\[24px\]|rounded-\[18px\]/u);
  assert.doesNotMatch(mainLayoutTopbarSource, /rounded-\[24px\]|rounded-\[14px\]/u);
  assert.doesNotMatch(navConfigSource, /rounded-\[18px\]|rounded-\[16px\]|rounded-xl/u);
  assert.doesNotMatch(sidebarTooltipSource, /rounded-xl/u);
});
