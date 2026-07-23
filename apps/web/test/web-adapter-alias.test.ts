import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const productionBindings = readFileSync(
  new URL('../../desktop/src/shell/renderer/renderer/production-bindings.ts', import.meta.url),
  'utf8',
);
const productionBootstrap = readFileSync(
  new URL('../../desktop/src/shell/renderer/renderer/production-bootstrap.ts', import.meta.url),
  'utf8',
);

test('Web replaces the canonical Desktop production adapter seams with Web owners', () => {
  assert.match(
    productionBindings,
    /from '@renderer\/features\/auth\/desktop-auth-adapter\.js'/,
  );
  assert.match(productionBindings, /from '@renderer\/bridge'/);
  assert.match(
    productionBootstrap,
    /from '@renderer\/infra\/bootstrap\/runtime-bootstrap'/,
  );
  assert.match(
    viteConfig,
    /find: '@renderer\/features\/auth\/desktop-auth-adapter\.js',[\s\S]*replacement: path\.resolve\(__dirname, 'src\/desktop-adapter\/web-auth-adapter\.ts'\)/,
  );
  assert.ok(viteConfig.includes('find: /^@renderer\\/bridge$/,'));
  assert.ok(viteConfig.includes(
    "replacement: path.resolve(__dirname, 'src/desktop-adapter/bridge.web.ts')",
  ));
  assert.match(
    viteConfig,
    /find: '@renderer\/infra\/bootstrap\/runtime-bootstrap',[\s\S]*replacement: path\.resolve\(__dirname, 'src\/desktop-adapter\/runtime-bootstrap\.web\.ts'\)/,
  );
  assert.doesNotMatch(viteConfig, /platform-auth-adapter\.js/);
});
