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
import { reconcilePolicies, publishProduct } from '../publish.mjs';

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
