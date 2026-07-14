import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const webAuthMenu = readFileSync(
  new URL('../../desktop/src/shell/renderer/features/auth/web-auth-menu.tsx', import.meta.url),
  'utf8',
);

test('Web replaces the exact Desktop auth adapter import with the Web owner', () => {
  assert.match(
    webAuthMenu,
    /from '@renderer\/features\/auth\/desktop-auth-adapter\.js'/,
  );
  assert.match(
    viteConfig,
    /find: '@renderer\/features\/auth\/desktop-auth-adapter\.js',[\s\S]*replacement: path\.resolve\(__dirname, 'src\/desktop-adapter\/web-auth-adapter\.ts'\)/,
  );
  assert.doesNotMatch(viteConfig, /platform-auth-adapter\.js/);
});
