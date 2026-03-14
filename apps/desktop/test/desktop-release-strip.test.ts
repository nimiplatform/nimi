import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const layoutPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/app-shell/layouts/main-layout-view.tsx',
);

test('main layout keeps persistent desktop release strip mounted near shell top', () => {
  const source = fs.readFileSync(layoutPath, 'utf8');
  assert.match(source, /import\s+\{\s*DesktopReleaseStrip\s*\}\s+from\s+'\.\/desktop-release-strip'/);
  assert.match(source, /<OfflineShellStrip\s*\/>\s*[\r\n\s]*<DesktopReleaseStrip\s*\/>\s*[\r\n\s]*<StatusBanner\s*\/>/);
});
