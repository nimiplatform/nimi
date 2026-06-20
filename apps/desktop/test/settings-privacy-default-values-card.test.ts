import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktop(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('privacy defaults info card uses a deliberate soft token border', () => {
  const source = readDesktop('src/shell/renderer/features/settings/settings-privacy-page.tsx');
  const cardStart = source.indexOf('Defaults Info Card');
  assert.notEqual(cardStart, -1, 'privacy page must keep the defaults info card marker');

  const cardEnd = source.indexOf('</section>', cardStart);
  assert.notEqual(cardEnd, -1, 'defaults info card source slice must end at its section');

  const cardSource = source.slice(cardStart, cardEnd);
  assert.match(cardSource, /border-\[color-mix\(in_srgb,var\(--nimi-action-primary-bg\)_18%,transparent\)\]/);
  assert.match(cardSource, /bg-\[color-mix\(in_srgb,var\(--nimi-action-primary-bg\)_6%,var\(--nimi-surface-card\)\)\]/);
  assert.doesNotMatch(cardSource, /border-mint-100/);
});
