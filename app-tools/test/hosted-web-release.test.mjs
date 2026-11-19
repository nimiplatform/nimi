import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nimiWebViteConfig } from '../lib/web-development.mjs';
import { isAppId, isClientId, hostedWebIdentity } from '../lib/app-identifiers.mjs';
import { packHostedWeb } from '../lib/hosted-web-release.mjs';
import { readNimiAppArchive } from '../lib/app-pack.mjs';

test('hosted input pins product, official account and release asset paths together', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-hosted-app-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, 'nimi.app.yaml'),
    'app_id: 3d.studio\npublic_slug: studio\nversion: 1.0.0\napp_access: [runtime.consume]\n',
  );
  const options = { root, serve: false, release: true, env: {} },
    vite = nimiWebViteConfig(options);
  const config = JSON.parse(vite.define.__NIMI_APP_WEB_CONFIG__);
  assert.equal(config.officialWebBaseUrl, 'https://nimi.ai');
  assert.equal(config.realmEnvironmentId, 'production');
  assert.equal(config.redirectUri, 'https://studio.nimi.xyz/');
  assert.ok(isClientId(config.clientId));
  assert.ok(isAppId('3d.studio'));
  assert.ok(!isAppId('acme_draw'));
  assert.ok(!isAppId('a.' + 'x'.repeat(119)));
  assert.equal(hostedWebIdentity('nimi.shijing', 'shijing').clientId, 'nimi.shijing.web');
  assert.throws(
    () => nimiWebViteConfig({ ...options, env: { NIMI_WEB_OFFICIAL_WEB_URL: 'https://other.example' } }),
    /conflicts/,
  );
  assert.equal(vite.base, '/');
  assert.equal(vite.build.assetsDir, '_releases/1.0.0/assets');
  let info;
  vite.plugins[0].generateBundle.call({
    emitFile(file) {
      info = JSON.parse(file.source);
    },
  });
  assert.equal(info.client_id, config.clientId);
  assert.equal(info.official_web_url, config.officialWebBaseUrl);
  const dir = path.join(root, 'dist-web');
  await mkdir(dir);
  await writeFile(path.join(dir, 'index.html'), '<main>App</main>');
  await writeFile(path.join(dir, 'nimi-web-bundle.json'), JSON.stringify(info));
  await writeFile(path.join(dir, '_routes.json'), '{}');
  const archive = path.join(root, 'app.zip');
  await packHostedWeb(dir, archive);
  const entries = readNimiAppArchive(await readFile(archive));
  assert.deepEqual([...entries.keys()], ['index.html', 'nimi-web-bundle.json']);
});
