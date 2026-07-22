import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const mainLayoutViewSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
const mainLayoutSettingsMenuSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-settings-menu.tsx');
const mainLayoutTopbarSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-topbar.tsx');
const navConfigSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/navigation-config.tsx');
const shellChromeClassesSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/shell-chrome-classes.ts');

test('shell chrome retune: rail and topbar shells stay transparent chrome without shell dividers', () => {
  assert.match(mainLayoutViewSource, /<aside[\s\S]*data-testid=\{E2E_IDS\.shellSidebarRail\}/);
  assert.doesNotMatch(mainLayoutViewSource, /<Surface[\s\S]*data-testid=\{E2E_IDS\.shellSidebarRail\}[\s\S]*material="glass-regular"/u);
  assert.doesNotMatch(mainLayoutViewSource, /data-testid=\{E2E_IDS\.shellSidebarRail\}[\s\S]*border-r/u);
  assert.match(mainLayoutTopbarSource, /<div className="flex h-full w-full min-w-0 items-center overflow-hidden border-b border-\[color-mix\(in_srgb,var\(--nimi-border-subtle\)_78%,white\)\] px-1">/);
  assert.match(mainLayoutTopbarSource, /className="min-w-0 flex-1 overflow-hidden" data-titlebar-region="content"/u);
  assert.match(mainLayoutTopbarSource, /className="ml-2 flex shrink-0 items-center gap-2 sm:ml-auto sm:gap-7" data-titlebar-region="actions"/u);
  assert.doesNotMatch(mainLayoutTopbarSource, /import logoImage from '\.\.\/\.\.\/assets\/logo\.svg';/u);
  assert.doesNotMatch(mainLayoutTopbarSource, /<img\s+src=\{logoImage\}\s+alt="Nimi"[\s\S]*\/>/u);
  assert.doesNotMatch(mainLayoutTopbarSource, /<Surface[\s\S]*material="glass-thick"/u);
});

test('shell chrome retune: shell chrome classes tighten radius scale', () => {
  assert.match(shellChromeClassesSource, /SHELL_CHROME_MAIN_HOST_CLASS[\s\S]*rounded-3xl/);
  assert.match(shellChromeClassesSource, /SHELL_CHROME_OVERLAY_CLASS[\s\S]*rounded-2xl/);
  assert.match(shellChromeClassesSource, /SHELL_CHROME_INTERACTIVE_RADIUS_CLASS[\s\S]*rounded-xl/);
  assert.match(shellChromeClassesSource, /SHELL_CHROME_TOOLTIP_CLASS[\s\S]*rounded-xl/);
  assert.doesNotMatch(shellChromeClassesSource, /rounded-\[[0-9]+px\]/u);
});

test('shell chrome retune: nav, home launcher, account menu, and tooltips consume the tighter shell scale', () => {
  assert.match(mainLayoutViewSource, /<Tooltip[\s\S]*placement="right"[\s\S]*SHELL_CHROME_TOOLTIP_CLASS/);
  assert.match(mainLayoutViewSource, /<(?:motion\.)?button[\s\S]*SHELL_CHROME_INTERACTIVE_RADIUS_CLASS/);
  assert.match(mainLayoutSettingsMenuSource, /<Surface[\s\S]*tone="overlay"[\s\S]*material="glass-thick"[\s\S]*SHELL_CHROME_OVERLAY_CLASS/);
  assert.match(mainLayoutViewSource, /avatarNode[\s\S]*sizeClassName="h-9 w-9"/u);
  assert.match(mainLayoutSettingsMenuSource, /SHELL_CHROME_MENU_ITEM_BASE_CLASS/);
  assert.match(mainLayoutTopbarSource, /SHELL_CHROME_ACTION_CELL_CLASS/);
  assert.match(mainLayoutTopbarSource, /SHELL_TOPBAR_GHOST_ICON_CLASS/);
  assert.doesNotMatch(mainLayoutTopbarSource, /openAccountMenu[\s\S]*SHELL_CHROME_ACTION_CELL_CLASS/u);
  assert.match(mainLayoutTopbarSource, /openAccountMenu[\s\S]*className="flex h-9 items-center"/u);
  assert.match(mainLayoutTopbarSource, /openAccountMenu[\s\S]*className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-black\/5 bg-white p-0 text-\[var\(--nimi-text-primary\)\] shadow-\[0_2px_8px_rgba\(0,0,0,0\.04\)\] transition-transform duration-150 hover:scale-\[1\.03\]"/u);
  assert.match(navConfigSource, /SHELL_CHROME_INTERACTIVE_RADIUS_CLASS/);
  assert.match(navConfigSource, /<Tooltip[\s\S]*placement="right"[\s\S]*SHELL_CHROME_TOOLTIP_CLASS/);
  assert.doesNotMatch(navConfigSource, /useRef|useState|getBoundingClientRect|setTooltipPos/u);
  assert.doesNotMatch(mainLayoutViewSource, /rounded-\[32px\]|rounded-\[24px\]|rounded-\[18px\]/u);
  assert.doesNotMatch(mainLayoutSettingsMenuSource, /rounded-\[32px\]|rounded-\[24px\]|rounded-\[18px\]/u);
  assert.doesNotMatch(mainLayoutTopbarSource, /rounded-\[24px\]|rounded-\[14px\]/u);
  assert.doesNotMatch(navConfigSource, /rounded-\[18px\]|rounded-\[16px\]|rounded-xl/u);
});

test('shell chrome retune: account menu is anchored to the titlebar avatar trigger', () => {
  assert.match(mainLayoutViewSource, /settingsTriggerRef\.current\?\.getBoundingClientRect\(\)/u);
  assert.match(mainLayoutViewSource, /anchorPosition=\{settingsMenuPosition\}/u);
  assert.match(mainLayoutSettingsMenuSource, /style=\{anchorStyle\}/u);
  assert.doesNotMatch(mainLayoutSettingsMenuSource, /bottom-4|left-\[72px\]/u);
});

test('shell chrome retune: mac titlebar safe area moves ordinary shell below traffic lights', () => {
  assert.match(mainLayoutViewSource, /MACOS_TITLEBAR_TOP_INSET_CLASS = 'top-7'/u);
  assert.match(mainLayoutViewSource, /MACOS_SHELL_CONTENT_TOP_PADDING_CLASS = 'pt-\[calc\(3\.5rem\+1\.75rem\)\]'/u);
  assert.match(mainLayoutViewSource, /const usesMacTrafficLightTitlebar = bindings\.app\.projection\.menuBarShellEnabled\(\)/u);
  assert.doesNotMatch(mainLayoutViewSource, /getShellFeatureFlags/u);
  assert.match(mainLayoutViewSource, /titlebarTopInsetClass=\{titlebarTopInsetClass\}/u);
  assert.match(mainLayoutViewSource, /className=\{`relative z-10 flex min-h-0 flex-1 gap-3 px-3 pb-3 \$\{shellContentTopPaddingClass\}`\}/u);
  assert.match(mainLayoutTopbarSource, /titlebarTopInsetClass: string/u);
  assert.match(mainLayoutTopbarSource, /\$\{props\.titlebarTopInsetClass\}/u);
  assert.doesNotMatch(mainLayoutViewSource, /className="relative z-10 flex min-h-0 flex-1 gap-3 px-3 pb-3 pt-14"/u);
});

test('shell chrome retune: account menu Support uses a help glyph, not the old lifebuoy glyph', () => {
  const supportIconBlock = navConfigSource.slice(
    navConfigSource.indexOf('const ICON_SUPPORT'),
    navConfigSource.indexOf('const ICON_DEVELOPER_TOOLS'),
  );

  assert.match(mainLayoutSettingsMenuSource, /id:\s*'support',\s*label:\s*'Support',\s*icon:\s*'support'/u);
  assert.match(supportIconBlock, /M9\.09 9a3 3 0 0 1 5\.83 1c0 2-3 3-3 3/u);
  assert.match(supportIconBlock, /M12 17h\.01/u);
  assert.doesNotMatch(supportIconBlock, /<circle cx="12" cy="12" r="4"/u);
  assert.doesNotMatch(supportIconBlock, /x1="4\.93" y1="4\.93" x2="9\.17" y2="9\.17"/u);
  assert.doesNotMatch(navConfigSource, /normalized === 'support' \|\| normalized === 'lifebuoy'/u);
});
