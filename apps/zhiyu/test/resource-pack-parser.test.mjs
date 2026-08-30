import assert from 'node:assert/strict';
import test from 'node:test';

import { strToU8, zipSync } from 'fflate';

import {
  ZHIYU_RESOURCE_PACK_TARGET_ID,
  ZHIYU_RESOURCE_PACK_TARGET_VERSION,
  ZhiyuResourcePackError,
} from '../src/resource-pack/contract.ts';
import {
  materializeZhiyuResourcePackStyle,
  parseZhiyuResourcePack,
} from '../src/resource-pack/parse.ts';

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

test('parses and scopes a real style-only .nimipack ZIP', async () => {
  const bytes = packBytes({
    css: '[data-nimi-pack-zone="surface"] { background-color: #182032; padding: 24px; }',
  });

  const parsed = await parseZhiyuResourcePack(bytes);

  assert.equal(parsed.manifest.target.id, ZHIYU_RESOURCE_PACK_TARGET_ID);
  assert.equal(parsed.manifest.target.version, ZHIYU_RESOURCE_PACK_TARGET_VERSION);
  assert.deepEqual(parsed.referencedResources, []);
  assert.match(parsed.scopedCssText, /data-zhiyu-resource-pack-surface="true"/u);
  assert.match(parsed.scopedCssText, /data-nimi-pack-zone="surface"/u);
});

test('materializes only a declared signature-matched Pack image', async () => {
  const bytes = packBytes({
    css: '[data-nimi-pack-zone="surface"] { background-image: linear-gradient(#0008, #0008), url("assets/room.png"); }',
    resources: { 'assets/room.png': pngBytes },
  });
  const parsed = await parseZhiyuResourcePack(bytes);

  assert.deepEqual(parsed.referencedResources, ['assets/room.png']);
  const css = materializeZhiyuResourcePackStyle(parsed, (resource) => `blob:zhiyu/${resource.path}`);
  assert.match(css, /url\("blob:zhiyu\/assets\/room\.png"\)/u);
});

test('rejects unsupported manifest fields and executable archive entries', async () => {
  const manifest = manifestFor([]);
  await assert.rejects(
    parseZhiyuResourcePack(zipSync({
      'manifest.json': strToU8(JSON.stringify({ ...manifest, main: 'main.js' })),
      'style.css': strToU8('[data-nimi-pack-zone="surface"] { color: #fff; }'),
      'main.js': strToU8('throw new Error("not admitted")'),
    })),
    (error) => resourcePackFailure(error, 'manifest'),
  );
});

test('rejects target mismatch without a compatibility branch', async () => {
  await assert.rejects(
    parseZhiyuResourcePack(packBytes({ targetVersion: 2 })),
    (error) => resourcePackFailure(error, 'manifest') && /different experience surface/u.test(error.reason),
  );
});

test('rejects a non-CSS style entry instead of creating an executable lane', async () => {
  await assert.rejects(
    parseZhiyuResourcePack(zipSync({
      'manifest.json': strToU8(JSON.stringify({
        ...manifestFor([]),
        styleEntry: 'main.js',
      })),
      'main.js': strToU8('[data-nimi-pack-zone="surface"] { color: #fff; }'),
    })),
    (error) => resourcePackFailure(error, 'manifest'),
  );
});

test('rejects remote CSS, descendant selectors, and guarded-control interception', async () => {
  const denied = [
    '@import url("https://example.com/theme.css");',
    '[data-nimi-pack-zone="surface"] button { color: red; }',
    '[data-nimi-pack-zone="surface"] { position: fixed; }',
    '[data-nimi-pack-zone="surface"] { pointer-events: none; }',
    '[data-nimi-pack-zone="surface"]::before { content: "online"; }',
    '[data-nimi-pack-zone="surface"] { display: none; }',
    '[data-nimi-pack-zone="surface"] { color: URL("assets/mark.png"); }',
    '[data-nimi-pack-zone="surface"] { background-image: \\75 \\72 \\6c ("https://example.com/x.png"); }',
  ];
  for (const css of denied) {
    await assert.rejects(
      parseZhiyuResourcePack(packBytes({ css })),
      (error) => resourcePackFailure(error, 'style'),
      css,
    );
  }
});

test('rejects undeclared, missing, unused, traversing, and unsupported resources', async () => {
  await assert.rejects(
    parseZhiyuResourcePack(packBytes({ extraEntries: { 'extra.txt': strToU8('extra') } })),
    (error) => resourcePackFailure(error, 'archive'),
  );
  await assert.rejects(
    parseZhiyuResourcePack(packBytes({ declaredResources: ['assets/missing.png'] })),
    (error) => resourcePackFailure(error, 'archive'),
  );
  await assert.rejects(
    parseZhiyuResourcePack(packBytes({ resources: { 'assets/unused.png': pngBytes } })),
    (error) => resourcePackFailure(error, 'manifest'),
  );
  await assert.rejects(
    parseZhiyuResourcePack(packBytes({ extraEntries: { '../escape.png': pngBytes } })),
    (error) => resourcePackFailure(error, 'archive'),
  );
  await assert.rejects(
    parseZhiyuResourcePack(packBytes({
      css: '[data-nimi-pack-zone="surface"] { background-image: url("assets/vector.svg"); }',
      resources: { 'assets/vector.svg': strToU8('<svg/>') },
    })),
    (error) => resourcePackFailure(error, 'resource'),
  );
});

test('rejects animated raster assets that cannot honor reduced-motion', async () => {
  const animatedPng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c,
    0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const animatedWebp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 18, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  for (const [path, bytes] of [['assets/animated.png', animatedPng], ['assets/animated.webp', animatedWebp]]) {
    await assert.rejects(parseZhiyuResourcePack(packBytes({
      css: `[data-nimi-pack-zone="surface"] { background-image: url("${path}"); }`,
      resources: { [path]: bytes },
    })), (error) => resourcePackFailure(error, 'resource'));
  }
});

test('static raster metadata containing animation-like text is not a false positive', async () => {
  const staticPng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 4, 0x74, 0x45, 0x58, 0x74, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 0,
  ]);
  const staticWebp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 16, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x45, 0x58, 0x49, 0x46, 4, 0, 0, 0, 0x41, 0x4e, 0x49, 0x4d,
  ]);
  for (const [path, bytes] of [['assets/static.png', staticPng], ['assets/static.webp', staticWebp]]) {
    const parsed = await parseZhiyuResourcePack(packBytes({
      css: `[data-nimi-pack-zone="surface"] { background-image: url("${path}"); }`,
      resources: { [path]: bytes },
    }));
    assert.deepEqual(parsed.referencedResources, [path]);
  }
});

function packBytes({
  css = '[data-nimi-pack-zone="surface"] { color: #102030; }',
  targetVersion = ZHIYU_RESOURCE_PACK_TARGET_VERSION,
  resources = {},
  declaredResources = Object.keys(resources),
  extraEntries = {},
} = {}) {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify({
      ...manifestFor(declaredResources),
      target: { id: ZHIYU_RESOURCE_PACK_TARGET_ID, version: targetVersion },
    })),
    'style.css': strToU8(css),
    ...resources,
    ...extraEntries,
  });
}

function manifestFor(resources) {
  return {
    schemaVersion: 1,
    target: { id: ZHIYU_RESOURCE_PACK_TARGET_ID, version: ZHIYU_RESOURCE_PACK_TARGET_VERSION },
    styleEntry: 'style.css',
    resources,
  };
}

function resourcePackFailure(error, category) {
  assert.ok(error instanceof ZhiyuResourcePackError);
  assert.equal(error.category, category);
  assert.ok(error.source);
  assert.ok(error.reason);
  assert.ok(error.repair);
  assert.match(error.message, new RegExp(error.repair.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  return true;
}
