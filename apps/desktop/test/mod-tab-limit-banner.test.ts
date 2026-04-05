import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('showModTabLimitBanner writes the expected warning through app store state', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/host/mod-tab-limit-banner.ts'),
    'utf8',
  );

  assert.match(source, /useAppStore\.getState\(\)\.setStatusBanner\(\{/);
  assert.match(source, /kind:\s*'warning'/);
  assert.match(source, /message:\s*'最多同时打开 5 个 Mod，请先关闭一个再继续。'/);
  assert.match(source, /actionLabel:\s*'前往 Mods'/);
  assert.match(source, /input\.setActiveTab\('mods'\)/);
});
