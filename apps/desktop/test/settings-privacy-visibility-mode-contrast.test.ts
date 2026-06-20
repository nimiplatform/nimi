import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktop(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('privacy visibility mode selected option keeps text visible on the light segmented surface', () => {
  const source = readDesktop('src/shell/renderer/features/settings/settings-privacy-page.tsx');
  const controlStart = source.indexOf('Visibility Mode Master Control');
  assert.notEqual(controlStart, -1, 'privacy page must keep the visibility mode control marker');

  const controlEnd = source.indexOf('{currentMode === \'CUSTOM\'', controlStart);
  assert.notEqual(controlEnd, -1, 'visibility mode source slice must end before custom mode hint');

  const controlSource = source.slice(controlStart, controlEnd);
  assert.match(controlSource, /bg-white text-gray-900 shadow-sm/);
  assert.doesNotMatch(controlSource, /bg-mint-500 text-white/);
});
