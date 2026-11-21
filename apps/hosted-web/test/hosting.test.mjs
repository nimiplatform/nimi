import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { writeNimiAppArchive } from '../../../app-tools/lib/app-pack.mjs';
import { deflateSync } from 'node:zlib';
import { compareSemverDesc, migrateStorefrontSchema, reconcilePolicies, publishProduct, syncStorefronts } from '../publish.mjs';

const here = fileURLToPath(new URL('../', import.meta.url));
test('one gateway stages immutable assets, switches and rolls back versions, and preserves suspension and tenant isolation', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'nimi-hosted-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = await build({
    entryPoints: [path.join(here, 'worker.mjs')],
    bundle: true,
    format: 'esm',
    write: false,
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'hosted-web',
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: '2026-08-01',
          d1Databases: ['DB'],
          r2Buckets: ['ASSETS_BUCKET'],
          bindings: { NIMI_REALM_URL: 'https://realm.example' },
          outboundService(request) {
            assert.equal(request.headers.get('cookie'), null);
            return Response.json({ test: 'realm' });
          },
        },
        {
          name: 'portal',
          modules: true,
          script: await readFile(path.join(here, '../web/public/_worker.js'), 'utf8'),
          compatibilityDate: '2026-08-01',
          serviceBindings: { APP_HOST: 'hosted-web' },
        },
      ],
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB'),
    bucket = await mf.getR2Bucket('ASSETS_BUCKET');
  for (const stmt of (await readFile(path.join(here, 'schema.sql'), 'utf8')).split(/\n(?=CREATE )/u))
    await db.prepare(stmt).run();
  const store = {
    query: (sql, ...params) =>
      db
        .prepare(sql)
        .bind(...params)
        .all(),
    put: (key, bytes) => bucket.put(key, bytes),
  };
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  const write = async (name, data) => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data));
  };
  const bodies = new Map();
  async function product(slug, version, paused = false, blocked = false) {
    const id = 'test.' + slug,
      stem = 'products/' + id;
    const info = { app_id: id, client_id: id + '.web', version };
    const zip = writeNimiAppArchive([
      { name: 'index.html', bytes: 'entry-' + slug + '-' + version },
      { name: 'nimi-web-bundle.json', bytes: JSON.stringify(info) },
      { name: '_releases/' + version + '/assets/lazy.js', bytes: slug + '-' + version },
    ]);
    const digest = createHash('sha256').update(zip).digest('hex');
    bodies.set(slug + '/' + version, zip);
    await write(stem + '/product.json', {
      app_id: id,
      slug,
      display_name: slug,
      publisher: 'test',
      repository: 'https://github.com/test/' + slug,
      license: 'MIT',
      summary: { en: slug, zh: slug },
      visibility: 'public',
      kill_switch: { active: blocked },
    });
    await write(stem + '/sources/' + id + '.web.json', {
      client_id: id + '.web',
      kind: 'hosted-web',
      source_revision: 1,
      status: paused ? 'paused' : 'active',
      stable_version: version,
    });
    await write(stem + '/web/releases/' + version + '.json', {
      ...info,
      source_revision: 1,
      sha256: digest,
      size: zip.length,
    });
  }
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  await write('index.json', { apps: {} });
  await product('alpha', '1.0.0');
  await product('beta', '1.0.0');
  let head;
  const apply = async () => {
    git('add', '.');
    git('commit', '-qm', 'selection');
    head = git('rev-parse', 'HEAD');
    await reconcilePolicies(root, head, store, async () => head);
  };
  const get = (url, opts) => mf.dispatchFetch(url, opts);
  const row = async (slug) => (await store.query('SELECT * FROM products WHERE slug=?', slug)).results[0];
  const io = {
    head: async () => head,
    download: async (url) => {
      const parts = new URL(url).pathname.split('/');
      return bodies.get(parts[2] + '/' + parts[5].slice(5));
    },
    probe: async (url, opts) => {
      if (url.startsWith('https://realm.nimi.ai/')) {
        const clientId = url.split('/').at(-1),
          appId = clientId.slice(0, -4),
          origin = 'https://' + appId.slice(5) + '.nimi.xyz';
        return Response.json({
          appId,
          clientId,
          role: 'app',
          sourceRevision: 1,
          origin,
          redirectUri: origin + '/',
        });
      }
      return get(url, opts);
    },
  };
  await apply();
  for (const slug of ['alpha', 'beta']) await publishProduct(root, head, store, await row(slug), io);
  const portal = await mf.getWorker('portal');
  const directory = await portal.fetch('https://nimi.ai/.well-known/nimi-apps/alpha');
  assert.equal(directory.status, 200);
  assert.equal((await directory.json()).web.version, '1.0.0');
  assert.equal(
    (await (await get('https://catalog.internal/.well-known/nimi-apps/alpha')).json()).web.version,
    '1.0.0',
  );
  assert.equal(
    await (await get('https://alpha.nimi.xyz/deep/link', { headers: { Accept: 'text/html' } })).text(),
    'entry-alpha-1.0.0',
  );
  const lazy = '/_releases/1.0.0/assets/lazy.js';
  assert.equal(await (await get('https://alpha.nimi.xyz' + lazy)).text(), 'alpha-1.0.0');
  assert.equal(await (await get('https://beta.nimi.xyz' + lazy)).text(), 'beta-1.0.0');
  assert.equal((await get('https://unknown.nimi.xyz/')).status, 404);
  assert.equal(
    (
      await get('https://alpha.nimi.xyz/_releases/1.0.0/assets/missing.js', {
        headers: { Accept: 'text/html' },
      })
    ).status,
    404,
  );
  const betaPolicy = (await row('beta')).policy_commit;
  const nativeIndex = { apps: { 'test.alpha': {
    visibility: 'public', latest_admitted_release_by_target: { 'windows-x86_64': { version: '1.0.0' } },
  } } };
  await write('index.json', nativeIndex);
  await apply();
  assert.deepEqual(JSON.parse((await row('alpha')).pc_targets), ['windows-x86_64']);
  const alphaPolicy = (await row('alpha')).policy_commit;
  nativeIndex.apps['test.alpha'].latest_admitted_release_by_target['windows-x86_64'].version = '1.0.1';
  await write('index.json', nativeIndex);
  await apply();
  assert.equal((await row('alpha')).policy_commit, alphaPolicy);
  assert.equal((await row('beta')).policy_commit, betaPolicy);
  await product('alpha', '1.0.1');
  await apply();
  await assert.rejects(
    publishProduct(root, head, store, await row('alpha'), {
      ...io,
      download: async () => Buffer.from('wrong'),
    }),
    /digest mismatch/,
  );
  assert.equal((await row('alpha')).active_version, '1.0.0');
  await publishProduct(root, head, store, await row('alpha'), io);
  assert.equal(await (await get('https://alpha.nimi.xyz' + lazy)).text(), 'alpha-1.0.0');
  assert.equal((await get('https://alpha.nimi.xyz/')).headers.get('X-Nimi-Web-Version'), '1.0.1');
  await product('alpha', '1.0.0');
  await apply();
  await publishProduct(root, head, store, await row('alpha'), {
    ...io,
    download: async () => {
      throw Error('rollback must use retained assets');
    },
  });
  assert.equal((await get('https://alpha.nimi.xyz/')).headers.get('X-Nimi-Web-Version'), '1.0.0');
  await product('alpha', '1.0.2');
  await apply();
  const staleHead = head,
    staleRow = await row('alpha');
  await assert.rejects(
    publishProduct(root, staleHead, store, staleRow, {
      ...io,
      download: async (url) => {
        const bytes = await io.download(url);
        await product('alpha', '1.0.2', true);
        await apply();
        return bytes;
      },
    }),
    /Superseded/,
  );
  assert.equal((await row('alpha')).active_version, '1.0.0');
  assert.equal((await get('https://alpha.nimi.xyz' + lazy)).status, 403);
  assert.equal(
    (await get('https://alpha.nimi.xyz/api/runtime-access/token', { method: 'POST' })).status,
    403,
  );
  assert.equal(
    (await (await get('https://alpha.nimi.xyz/api/runtime-access/context')).json()).reasonCode,
    'RUNTIME_CLIENT_SOURCE_PAUSED',
  );
  assert.equal(
    (
      await get('https://alpha.nimi.xyz/api/runtime-access/context/end', {
        method: 'POST',
        headers: { Cookie: 'probe=1' },
      })
    ).status,
    200,
  );
  assert.equal((await get('https://beta.nimi.xyz/')).status, 200);
  assert.equal((await (await get('https://catalog.internal/.well-known/nimi-apps/alpha')).json()).web, null);
  await product('alpha', '1.0.2', false, true);
  await apply();
  const blocked = await (await get('https://catalog.internal/.well-known/nimi-apps/alpha')).json();
  assert.equal(blocked.blocked, true);
  assert.deepEqual(blocked.pc_targets, []);
  assert.equal(blocked.web, null);
  assert.equal((await get('https://alpha.nimi.xyz/')).status, 403);
  assert.equal((await get('https://alpha.nimi.xyz/api/runtime-access/context/end', { method: 'POST' })).status, 200);
  assert.equal((await get('https://beta.nimi.xyz/')).status, 200);
});

function pngCrc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makeTestPng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 4] = 32;
    row[1 + x * 4 + 1] = 140;
    row[1 + x * 4 + 2] = 210;
    row[1 + x * 4 + 3] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeTestWebp(width, height) {
  const payload = Buffer.alloc(6);
  payload[0] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  payload.writeUInt32LE(bits >>> 0, 1);
  const chunk = Buffer.alloc(8);
  chunk.write('VP8L', 0, 'ascii');
  chunk.writeUInt32LE(payload.length, 4);
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), chunk, payload]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

test('storefront sync projects immutable version docs, handles heterogeneous targets, product_only, blocked, and media D1 gate', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'nimi-hosted-storefront-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = await build({
    entryPoints: [path.join(here, 'worker.mjs')],
    bundle: true,
    format: 'esm',
    write: false,
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'hosted-web',
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: '2026-08-01',
          d1Databases: ['DB'],
          r2Buckets: ['ASSETS_BUCKET'],
          bindings: { NIMI_REALM_URL: 'https://realm.example' },
        },
        {
          name: 'portal',
          modules: true,
          script: await readFile(path.join(here, '../web/public/_worker.js'), 'utf8'),
          compatibilityDate: '2026-08-01',
          serviceBindings: { APP_HOST: 'hosted-web' },
        },
      ],
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const bucket = await mf.getR2Bucket('ASSETS_BUCKET');
  for (const stmt of (await readFile(path.join(here, 'schema.sql'), 'utf8')).split(/\n(?=CREATE )/u)) {
    await db.prepare(stmt).run();
  }
  const store = {
    query: (sql, ...params) => db.prepare(sql).bind(...params).all(),
    put: (key, bytes) => bucket.put(key, bytes),
  };

  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  const write = async (name, data) => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data));
  };

  const iconBytes = makeTestPng(128, 128);
  const coverBytes = makeTestWebp(1280, 720);
  const coverSha = createHash('sha256').update(coverBytes).digest('hex');
  const mediaZip = writeNimiAppArchive([{ name: `${coverSha}.webp`, bytes: coverBytes, mode: 0o644 }]);
  const mediaZipSha = createHash('sha256').update(mediaZip).digest('hex');

  const appInfoV2 = Buffer.from(JSON.stringify({
    format: 'nimi.app-info/v1',
    app_id: 'nimi.shijing',
    version: '0.2.0',
    target_id: 'windows-x86_64',
    display_name: '时镜',
    summary: '新版本内置中文摘要。',
    icon: { media_type: 'image/png', data_base64: iconBytes.toString('base64') },
    readme_markdown: '# 时镜 0.2.0\n\n中文详情。',
    release_notes_markdown: 'Added storefront.',
    license: { identifier: 'MIT', text: 'MIT License' },
    app_access: ['runtime.consume'],
    capability_contract_refs: ['text.generate'],
    required_standardized_feature_refs: [],
    storage_policy: { kind: 'nimi-mediated-default', os_storage_disclosure: null },
    author: 'Nimi Team',
    homepage_url: 'https://nimi.ai/apps/shijing',
    support_url: 'https://github.com/nimiplatform/nimiapp-shijing/issues',
    storefront: {
      category: 'companions-worlds',
      default_locale: 'zh',
      locales: {
        zh: { tags: ['节律观察'], highlights: [{ title: '排盘', description: '确定性排盘。' }] },
        en: {
          display_name: 'ShiJing',
          summary: 'New version English summary.',
          tags: ['Rhythm'],
          introduction_markdown: '# ShiJing 0.2.0\n\nEnglish detail.',
          highlights: [{ title: 'Charting', description: 'Deterministic charting.' }],
        },
      },
      media: {
        cover: { default: { media_type: 'image/webp', width: 1280, height: 720, size: coverBytes.length, sha256: coverSha } },
      },
    },
  }));
  const appInfoV2Sha = createHash('sha256').update(appInfoV2).digest('hex');

  const appInfoV1 = Buffer.from(JSON.stringify({
    format: 'nimi.app-info/v1',
    app_id: 'nimi.shijing',
    version: '0.1.0',
    target_id: 'macos-aarch64',
    display_name: '时镜',
    summary: 'Legacy 0.1.0 summary.',
    icon: { media_type: 'image/png', data_base64: iconBytes.toString('base64') },
    readme_markdown: '# 时镜 0.1.0',
    release_notes_markdown: 'Legacy release.',
    license: { identifier: 'MIT', text: 'MIT License' },
    app_access: ['runtime.consume'],
    capability_contract_refs: ['text.generate'],
    required_standardized_feature_refs: [],
    storage_policy: { kind: 'nimi-mediated-default', os_storage_disclosure: null },
    author: 'Nimi Team',
    homepage_url: '',
    support_url: '',
  }));
  const appInfoV1Sha = createHash('sha256').update(appInfoV1).digest('hex');

  const downloads = new Map([
    ['https://example.invalid/v0.2.0.app-info.json', appInfoV2],
    ['https://example.invalid/v0.2.0-storefront-media.zip', mediaZip],
    ['https://example.invalid/v0.1.0.app-info.json', appInfoV1],
  ]);

  git('init', '-qb', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');

  await write('products/nimi.shijing/product.json', {
    app_id: 'nimi.shijing',
    slug: 'shijing',
    display_name: '时镜',
    publisher: 'nimiplatform',
    repository: 'https://github.com/nimiplatform/nimiapp-shijing',
    license: 'MIT',
    summary: { en: 'OLD PRODUCT SUMMARY EN', zh: '旧产品摘要中文' },
    visibility: 'public',
    origin: 'nimi-official',
    kill_switch: { active: false, reason: null, revision: 0 },
  });
  await write('products/nimi.zhiyu/product.json', {
    app_id: 'nimi.zhiyu',
    slug: 'zhiyu',
    display_name: '织羽',
    publisher: 'nimiplatform',
    repository: 'https://github.com/nimiplatform/nimi',
    license: 'MIT',
    summary: { en: 'Bundled companion', zh: '随桌面端内置' },
    visibility: 'public',
    origin: 'nimi-official',
    kill_switch: { active: false, reason: null, revision: 0 },
  });
  await write('descriptors/nimi.shijing/0.2.0.json', {
    admission: { trust_tier: 'community' },
    candidate: {
      app_id: 'nimi.shijing',
      version: '0.2.0',
      storefront_media: {
        asset_name: 'nimi.shijing-0.2.0-storefront-media.zip',
        asset_url: 'https://example.invalid/v0.2.0-storefront-media.zip',
        size: mediaZip.length,
        sha256: mediaZipSha,
      },
      targets: [{
        target_id: 'windows-x86_64',
        os: 'windows',
        arch: 'x86_64',
        size: 123456789,
        app_info: { asset_url: 'https://example.invalid/v0.2.0.app-info.json', size: appInfoV2.length, sha256: appInfoV2Sha },
      }],
    },
  });
  await write('descriptors/nimi.shijing/0.1.0.json', {
    admission: { trust_tier: 'community' },
    candidate: {
      app_id: 'nimi.shijing',
      version: '0.1.0',
      targets: [{
        target_id: 'macos-aarch64',
        os: 'macos',
        arch: 'arm64',
        size: 98765432,
        app_info: { asset_url: 'https://example.invalid/v0.1.0.app-info.json', size: appInfoV1.length, sha256: appInfoV1Sha },
      }],
    },
  });
  await write('index.json', {
    schema_version: 1,
    apps: {
      'nimi.shijing': {
        visibility: 'public',
        origin: 'nimi-official',
        latest_admitted_release_by_target: {
          'windows-x86_64': { descriptor_id: 'nimi.shijing@0.2.0', path: 'descriptors/nimi.shijing/0.2.0.json' },
          'macos-aarch64': { descriptor_id: 'nimi.shijing@0.1.0', path: 'descriptors/nimi.shijing/0.1.0.json' },
        },
      },
    },
  });

  git('add', '.');
  git('commit', '-qm', 'initial');
  let head = git('rev-parse', 'HEAD');
  await reconcilePolicies(root, head, store, async () => head);

  let downloadCalls = 0;
  await syncStorefronts(root, head, store, {
    head: async () => head,
    download: async (url) => {
      downloadCalls += 1;
      return downloads.get(url);
    },
  });
  assert.equal(downloadCalls, 3);

  // Repeat sync at same commit skips all downloads.
  await syncStorefronts(root, head, store, {
    head: async () => head,
    download: async () => { throw new Error('must skip already-synced versions'); },
  });

  const portal = await mf.getWorker('portal');
  // Preview origin with APP_HOST binding works and supports HEAD.
  const previewList = await portal.fetch('https://preview-branch.nimi-web.pages.dev/.well-known/nimi-apps');
  assert.equal(previewList.status, 200);
  const listBody = await previewList.json();
  assert.equal(listBody.products.length, 2);
  const shijingCard = listBody.products.find((p) => p.slug === 'shijing');
  // Storefront version overrides product.json.summary!
  assert.equal(shijingCard.summary.zh, '新版本内置中文摘要。');
  assert.equal(shijingCard.summary.en, 'New version English summary.');
  assert.equal(shijingCard.displayed_version, '0.2.0');
  assert.equal(shijingCard.origin, 'nimi-official');
  assert.deepEqual(shijingCard.capabilities, ['text.generate']);
  assert.equal(shijingCard.cover_urls.default, `/.well-known/nimi-apps/media/nimi.shijing/${coverSha}.webp`);

  // Detail for primary version (0.2.0) and heterogeneous Mac version (0.1.0).
  const detailV2 = await (await portal.fetch('https://nimi.ai/.well-known/nimi-apps/shijing')).json();
  assert.equal(detailV2.detail_status, 'published');
  assert.equal(detailV2.displayed_version, '0.2.0');
  assert.equal(detailV2.has_storefront, true);
  assert.equal(detailV2.pc_target_releases['windows-x86_64'].size, 123456789);
  assert.equal(detailV2.pc_target_releases['macos-aarch64'].version, '0.1.0');
  assert.equal(detailV2.detail.storefront.media.cover.default.url, `/.well-known/nimi-apps/media/nimi.shijing/${coverSha}.webp`);

  const detailV1 = await (await portal.fetch('https://nimi.ai/.well-known/nimi-apps/shijing?version=0.1.0')).json();
  assert.equal(detailV1.detail_status, 'published');
  assert.equal(detailV1.displayed_version, '0.1.0');
  assert.equal(detailV1.has_storefront, false);
  assert.equal(detailV1.category, null);
  assert.equal(detailV1.cover_urls, null);
  assert.deepEqual(detailV1.tags, {});
  assert.deepEqual(detailV1.summary, { en: 'OLD PRODUCT SUMMARY EN', zh: '旧产品摘要中文' });
  assert.equal(detailV1.detail.summary, 'Legacy 0.1.0 summary.');
  assert.equal(detailV1.detail.storefront, null);

  assert.equal((await portal.fetch('https://nimi.ai/.well-known/nimi-apps/shijing?version=9.9.9')).status, 404);

  // product_only state (nimi.zhiyu).
  const zhiyuDetail = await (await portal.fetch('https://nimi.ai/.well-known/nimi-apps/zhiyu')).json();
  assert.equal(zhiyuDetail.detail_status, 'product_only');
  assert.equal(zhiyuDetail.summary.zh, '随桌面端内置');

  // Media route GET/HEAD, cache header, CORP, If-None-Match 304, and path traversal rejection.
  const mediaHead = await portal.fetch(`https://nimi.ai/.well-known/nimi-apps/media/nimi.shijing/${coverSha}.webp`, { method: 'HEAD' });
  assert.equal(mediaHead.status, 200);
  assert.equal(mediaHead.headers.get('Content-Type'), 'image/webp');
  assert.equal(mediaHead.headers.get('Cache-Control'), 'public, max-age=3600, must-revalidate');
  assert.equal(mediaHead.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
  const mediaEtag = mediaHead.headers.get('ETag');
  assert.ok(mediaEtag);
  const media304 = await portal.fetch(`https://nimi.ai/.well-known/nimi-apps/media/nimi.shijing/${coverSha}.webp`, {
    headers: { 'If-None-Match': mediaEtag },
  });
  assert.equal(media304.status, 304);
  assert.equal((await portal.fetch('https://nimi.ai/.well-known/nimi-apps/media/nimi.shijing/../../secret.png')).status, 404);

  // Mid-upload kill switch: start a slow storefront sync on a second app while reconciling an emergency suspension.
  await write('products/nimi.slowapp/product.json', {
    app_id: 'nimi.slowapp',
    slug: 'slowapp',
    display_name: 'Slow App',
    publisher: 'nimiplatform',
    repository: 'https://github.com/nimiplatform/slowapp',
    license: 'MIT',
    summary: { en: 'Slow', zh: '慢应用' },
    visibility: 'public',
    origin: 'nimi-official',
    kill_switch: { active: false, reason: null, revision: 0 },
  });
  const slowInfoBytes = Buffer.from(JSON.stringify({
    ...JSON.parse(appInfoV1.toString('utf8')),
    app_id: 'nimi.slowapp',
    display_name: 'Slow App',
    summary: 'Single-language slowapp summary.',
  }));
  const slowInfoSha = createHash('sha256').update(slowInfoBytes).digest('hex');
  await write('descriptors/nimi.slowapp/0.1.0.json', {
    admission: { trust_tier: 'community' },
    candidate: {
      app_id: 'nimi.slowapp',
      version: '0.1.0',
      targets: [{
        target_id: 'windows-x86_64',
        os: 'windows',
        arch: 'x86_64',
        size: 1000,
        app_info: { asset_url: 'https://example.invalid/slow.app-info.json', size: slowInfoBytes.length, sha256: slowInfoSha },
      }],
    },
  });
  await write('index.json', {
    schema_version: 1,
    apps: {
      'nimi.shijing': {
        visibility: 'public',
        origin: 'nimi-official',
        latest_admitted_release_by_target: {
          'windows-x86_64': { descriptor_id: 'nimi.shijing@0.2.0', path: 'descriptors/nimi.shijing/0.2.0.json' },
          'macos-aarch64': { descriptor_id: 'nimi.shijing@0.1.0', path: 'descriptors/nimi.shijing/0.1.0.json' },
        },
      },
      'nimi.slowapp': {
        visibility: 'public',
        origin: 'nimi-official',
        latest_admitted_release_by_target: {
          'windows-x86_64': { descriptor_id: 'nimi.slowapp@0.1.0', path: 'descriptors/nimi.slowapp/0.1.0.json' },
        },
      },
    },
  });
  git('add', '.');
  git('commit', '-qm', 'add slowapp');
  const slowRev = git('rev-parse', 'HEAD');
  await reconcilePolicies(root, slowRev, store, async () => slowRev);

  let currentHead = slowRev;
  let downloadStarted;
  const startedPromise = new Promise((resolve) => { downloadStarted = resolve; });
  let releaseDownload;
  const downloadGate = new Promise((resolve) => { releaseDownload = resolve; });
  const inFlightSync = syncStorefronts(root, slowRev, store, {
    head: async () => currentHead,
    download: async () => {
      downloadStarted();
      await downloadGate;
      throw new Error('simulated slowapp failure');
    },
  }).catch((err) => err);

  await startedPromise;

  // Kill switch runs independently WHILE syncStorefronts is blocked mid-download!
  await write('products/nimi.shijing/product.json', {
    app_id: 'nimi.shijing',
    slug: 'shijing',
    display_name: '时镜',
    publisher: 'nimiplatform',
    repository: 'https://github.com/nimiplatform/nimiapp-shijing',
    license: 'MIT',
    summary: { en: 'OLD PRODUCT SUMMARY EN', zh: '旧产品摘要中文' },
    visibility: 'public',
    origin: 'nimi-official',
    kill_switch: { active: true, reason: 'emergency stop', revision: 1 },
  });
  git('add', '.');
  git('commit', '-qm', 'suspend');
  head = git('rev-parse', 'HEAD');
  currentHead = head;
  await reconcilePolicies(root, head, store, async () => head);

  const blockedRes = await portal.fetch('https://nimi.ai/.well-known/nimi-apps/shijing');
  assert.equal(blockedRes.status, 200);
  assert.equal(blockedRes.headers.get('Cache-Control'), 'no-store');
  const blockedJson = await blockedRes.json();
  assert.equal(blockedJson.detail_status, 'blocked');
  assert.equal(blockedJson.blocked, true);
  assert.equal(blockedJson.publisher, 'nimiplatform');
  assert.deepEqual(blockedJson.pc_targets, []);
  assert.equal(blockedJson.web, null);
  assert.equal((await portal.fetch(`https://nimi.ai/.well-known/nimi-apps/media/nimi.shijing/${coverSha}.webp`)).status, 404);

  releaseDownload();
  const syncError = await inFlightSync;
  assert.ok(syncError instanceof Error);
  assert.match(syncError.message, /nimi\.slowapp/);

  // Now sync slowapp cleanly (unmigrated app without storefront) and verify detail keeps frozen bilingual product summary.
  await syncStorefronts(root, head, store, {
    head: async () => head,
    download: async (url) => {
      if (url === 'https://example.invalid/slow.app-info.json') return slowInfoBytes;
      throw new Error('unexpected download: ' + url);
    },
  });
  const slowDetail = await (await portal.fetch('https://nimi.ai/.well-known/nimi-apps/slowapp')).json();
  assert.equal(slowDetail.detail_status, 'published');
  assert.equal(slowDetail.has_storefront, false);
  assert.deepEqual(slowDetail.summary, { en: 'Slow', zh: '慢应用' });
  assert.equal(slowDetail.detail.summary, 'Single-language slowapp summary.');

  // Version bump with failed storefront sync must report pending for the new version instead of serving retired 0.1.0 as current.
  await write('descriptors/nimi.slowapp/0.2.0.json', {
    admission: { trust_tier: 'community' },
    candidate: {
      app_id: 'nimi.slowapp',
      version: '0.2.0',
      targets: [{
        target_id: 'windows-x86_64',
        os: 'windows',
        arch: 'x86_64',
        size: 2000,
        app_info: { asset_url: 'https://example.invalid/slow-v2.app-info.json', size: appInfoV1.length, sha256: appInfoV1Sha },
      }],
    },
  });
  await write('index.json', {
    schema_version: 1,
    apps: {
      'nimi.shijing': {
        visibility: 'public',
        origin: 'nimi-official',
        latest_admitted_release_by_target: {
          'windows-x86_64': { descriptor_id: 'nimi.shijing@0.2.0', path: 'descriptors/nimi.shijing/0.2.0.json' },
          'macos-aarch64': { descriptor_id: 'nimi.shijing@0.1.0', path: 'descriptors/nimi.shijing/0.1.0.json' },
        },
      },
      'nimi.slowapp': {
        visibility: 'public',
        origin: 'nimi-official',
        latest_admitted_release_by_target: {
          'windows-x86_64': { descriptor_id: 'nimi.slowapp@0.2.0', path: 'descriptors/nimi.slowapp/0.2.0.json' },
        },
      },
    },
  });
  git('add', '.');
  git('commit', '-qm', 'bump slowapp to 0.2.0');
  head = git('rev-parse', 'HEAD');
  await reconcilePolicies(root, head, store, async () => head);
  await assert.rejects(
    syncStorefronts(root, head, store, {
      head: async () => head,
      download: async () => {
        throw new Error('simulated v2 outage');
      },
    }),
    /nimi\.slowapp/,
  );

  const pendingDefault = await (await portal.fetch('https://nimi.ai/.well-known/nimi-apps/slowapp')).json();
  assert.equal(pendingDefault.detail_status, 'pending');
  assert.equal(pendingDefault.displayed_version, '0.2.0');
  assert.deepEqual(pendingDefault.pc_target_releases, { 'windows-x86_64': { version: '0.2.0' } });
  const pendingExplicit = await portal.fetch('https://nimi.ai/.well-known/nimi-apps/slowapp?version=0.2.0');
  assert.equal(pendingExplicit.status, 200);
  assert.equal((await pendingExplicit.json()).detail_status, 'pending');
  const retiredExplicit = await portal.fetch('https://nimi.ai/.well-known/nimi-apps/slowapp?version=0.1.0');
  assert.equal(retiredExplicit.status, 404);

  const indexAfterWithdrawal = JSON.parse(await readFile(path.join(root, 'index.json'), 'utf8'));
  delete indexAfterWithdrawal.apps['nimi.slowapp'];
  await write('index.json', indexAfterWithdrawal);
  git('add', 'index.json');
  git('commit', '-qm', 'withdraw the last native target');
  head = git('rev-parse', 'HEAD');
  await reconcilePolicies(root, head, store, async () => head);
  const withdrawn = await (await portal.fetch('https://nimi.ai/.well-known/nimi-apps/slowapp')).json();
  assert.deepEqual(withdrawn.pc_target_releases, {});
  assert.equal(withdrawn.displayed_version, null);
  assert.equal(withdrawn.detail_status, 'product_only');
  assert.equal(withdrawn.icon_url, null);
  assert.equal((await portal.fetch('https://nimi.ai/.well-known/nimi-apps/slowapp?version=0.1.0')).status, 404);
});

test('reconcilePolicies requires migrateStorefrontSchema on pre-migration D1 tables', async (t) => {
  const preMigrationMf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [{ name: 'db-only', modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: '2026-08-01', d1Databases: ['DB'] }],
    }),
  );
  t.after(() => preMigrationMf.dispose());
  const db = await preMigrationMf.getD1Database('DB');
  const store = {
    query: (sql, ...params) => db.prepare(sql).bind(...params).all(),
    put: async () => {},
  };
  await db.prepare('CREATE TABLE registry_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision TEXT NOT NULL, checked_at INTEGER NOT NULL)').run();
  await db.prepare(
    'CREATE TABLE products (slug TEXT PRIMARY KEY, app_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, publisher TEXT NOT NULL, repository TEXT NOT NULL, license TEXT NOT NULL, summary_en TEXT NOT NULL, summary_zh TEXT NOT NULL, pc_targets TEXT NOT NULL, capabilities TEXT NOT NULL, visible INTEGER NOT NULL, blocked INTEGER NOT NULL, client_id TEXT, source_revision INTEGER, source_active INTEGER NOT NULL, policy_commit TEXT NOT NULL, active_version TEXT, active_digest TEXT, pending INTEGER NOT NULL DEFAULT 0, ready INTEGER NOT NULL DEFAULT 0)',
  ).run();
  const root = await mkdtemp(path.join(tmpdir(), 'nimi-migrate-order-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  await mkdir(path.join(root, 'products/nimi.one'), { recursive: true });
  await writeFile(path.join(root, 'products/nimi.one/product.json'), JSON.stringify({
    app_id: 'nimi.one',
    slug: 'one',
    display_name: 'One',
    publisher: 'nimiplatform',
    repository: 'https://github.com/nimiplatform/one',
    license: 'MIT',
    summary: { en: 'One', zh: '一' },
    visibility: 'public',
    origin: 'nimi-official',
    kill_switch: { active: false, reason: null, revision: 0 },
  }));
  await writeFile(path.join(root, 'index.json'), JSON.stringify({
    schema_version: 1,
    apps: { 'nimi.one': { visibility: 'public', latest_admitted_release_by_target: {
      'windows-x86_64': { descriptor_id: 'nimi.one@1.0.0', path: 'descriptors/nimi.one/1.0.0.json' },
    } } },
  }));
  git('add', '.');
  git('commit', '-qm', 'init');
  const rev = git('rev-parse', 'HEAD');

  await assert.rejects(reconcilePolicies(root, rev, store, async () => rev), /no column named/i);
  await db.prepare('INSERT INTO registry_state VALUES(1,?,?)').bind(rev, Date.now()).run();
  await db.prepare(
    'INSERT INTO products(slug,app_id,display_name,publisher,repository,license,summary_en,summary_zh,pc_targets,capabilities,visible,blocked,source_active,policy_commit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).bind('one', 'nimi.one', 'One', 'nimiplatform', 'https://github.com/nimiplatform/one', 'MIT', 'One', '一',
    '["windows-x86_64"]', '[]', 1, 0, 0, rev).run();
  await migrateStorefrontSchema(root, rev, store, async () => rev);
  await migrateStorefrontSchema(root, rev, store, async () => rev); // same checkpoint
  await reconcilePolicies(root, rev, store, async () => rev);
  const row = await db.prepare('SELECT origin, pc_target_versions_json FROM products WHERE app_id = ?').bind('nimi.one').first();
  assert.equal(row.origin, 'nimi-official');
  assert.deepEqual(JSON.parse(row.pc_target_versions_json), { 'windows-x86_64': '1.0.0' });
});

test('compareSemverDesc orders release and numeric prerelease identifiers per SemVer 2.0', () => {
  const ordered = ['0.2.0-rc.2', '0.2.0-rc.10', '0.2.0', '0.2.0-alpha.1', '0.1.9'].sort(compareSemverDesc);
  assert.deepEqual(ordered, ['0.2.0', '0.2.0-rc.10', '0.2.0-rc.2', '0.2.0-alpha.1', '0.1.9']);
});
