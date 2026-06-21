import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('web login uses the current Nimi logo supplied by the shared auth shell host', () => {
  const webAuthMenuSource = readRepoFile('apps/desktop/src/shell/renderer/features/auth/web-auth-menu.tsx');

  assert.match(webAuthMenuSource, /import authLogoImage from '\.\.\/\.\.\/assets\/logo\.png';/u);
  assert.match(webAuthMenuSource, /<DesktopShellAuthPage[\s\S]*logo=\{authLogoImage\}/u);
  assert.doesNotMatch(webAuthMenuSource, /logo\.svg/u);
});
