import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('settings navigation keeps preferences separate from the Support update host', () => {
  const assetsSource = readDesktopFile('src/shell/renderer/features/settings/settings-assets.tsx');
  const panelSource = readDesktopFile('src/shell/renderer/features/settings/settings-panel-body.tsx');

  assert.match(assetsSource, /id:\s*'performance'/);
  assert.match(assetsSource, /ICON_ZAP/);
  assert.match(panelSource, /performance:\s*'Settings\.menuPerformance'/);
});

test('release strip routes update recovery to Support Updates, not Settings Performance', () => {
  const releaseStripSource = readDesktopFile('src/shell/renderer/app-shell/layouts/desktop-release-strip.tsx');
  assert.match(releaseStripSource, /persistStoredSupportSection\('updates'\)/);
  assert.match(releaseStripSource, /setActiveTab\('support'\)/);
  assert.doesNotMatch(releaseStripSource, /setActiveTab\('settings'\)/);
});

test('settings page router keeps PerformancePage as ordinary preferences only', () => {
  const pagesSource = readDesktopFile('src/shell/renderer/features/settings/settings-pages.tsx');
  const performanceSource = readDesktopFile('src/shell/renderer/features/settings/settings-performance-page.tsx');

  assert.match(pagesSource, /import\s+\{\s*PerformancePage\s*\}\s+from\s+'\.\/settings-performance-page\.js'/);
  assert.match(pagesSource, /case\s+'performance':\s+return\s+<PerformancePage\s+\/>/);
  assert.match(performanceSource, /collectDesktopUpdatePanelAlerts/);
  assert.match(performanceSource, /desktopReleaseInfo\?\.desktopVersion/);
  assert.match(performanceSource, /desktopUpdateState\?\.targetVersion/);
  assert.match(performanceSource, /runDesktopUpdateCheck/);
});
