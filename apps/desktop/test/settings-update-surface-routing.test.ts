import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('settings navigation exposes the existing Application Update surface', () => {
  const assetsSource = readDesktopFile('src/shell/renderer/features/settings/settings-assets.tsx');
  const panelSource = readDesktopFile('src/shell/renderer/features/settings/settings-panel-body.tsx');

  assert.match(assetsSource, /id:\s*'performance'/);
  assert.match(assetsSource, /ICON_ZAP/);
  assert.match(panelSource, /performance:\s*'Settings\.menuPerformance'/);
});

test('settings page router renders PerformancePage for performance selection', () => {
  const pagesSource = readDesktopFile('src/shell/renderer/features/settings/settings-pages.tsx');
  const performanceSource = readDesktopFile('src/shell/renderer/features/settings/settings-performance-page.tsx');

  assert.match(pagesSource, /import\s+\{\s*PerformancePage\s*\}\s+from\s+'\.\/settings-performance-page\.js'/);
  assert.match(pagesSource, /case\s+'performance':\s+return\s+<PerformancePage\s+\/>/);
  assert.match(performanceSource, /collectDesktopUpdatePanelAlerts/);
  assert.match(performanceSource, /desktopReleaseInfo\?\.desktopVersion/);
  assert.match(performanceSource, /desktopUpdateState\?\.targetVersion/);
  assert.match(performanceSource, /runDesktopUpdateCheck/);
});
