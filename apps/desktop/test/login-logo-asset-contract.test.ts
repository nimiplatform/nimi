import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

test('desktop login and boot shells consume the current PNG Nimi logo asset', () => {
  const entrySource = readWorkspaceFile('src/shell/renderer/main.tsx');
  const routesSource = readWorkspaceFile('src/shell/renderer/app-shell/routes/app-routes.tsx');
  const webAuthMenuSource = readWorkspaceFile('src/shell/renderer/features/auth/web-auth-menu.tsx');

  assert.match(entrySource, /import entryLogoImage from '\.\/assets\/logo\.png';/u);
  assert.doesNotMatch(entrySource, /import entryLogoImage from '\.\/assets\/logo\.svg';/u);

  assert.match(routesSource, /import bootstrapLogoImage from '\.\.\/\.\.\/assets\/logo\.png';/u);
  assert.doesNotMatch(routesSource, /import bootstrapLogoImage from '\.\.\/\.\.\/assets\/logo\.svg';/u);

  assert.match(webAuthMenuSource, /import authLogoImage from '\.\.\/\.\.\/assets\/logo\.png';/u);
  assert.match(webAuthMenuSource, /logo=\{authLogoImage\}/u);
});
