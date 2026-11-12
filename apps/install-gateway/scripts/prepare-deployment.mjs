import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The artifact is data, not build instructions for the credentialed runner.
// Admit this Worker's current configuration and reject executable extensions.
export function deploymentConfig(source) {
  assert.deepEqual(Object.keys(source).sort(), ['assets', 'compatibility_date', 'main', 'name', 'routes']);
  assert.equal(source.name, 'nimi-install-gateway');
  assert.equal(source.main, 'src/index.mjs');
  assert.match(source.compatibility_date, /^\d{4}-\d{2}-\d{2}$/u);
  assert.ok(Array.isArray(source.routes) && source.routes.length > 0);
  for (const route of source.routes) {
    assert.deepEqual(Object.keys(route).sort(), ['custom_domain', 'pattern']);
    assert.equal(typeof route.pattern, 'string');
    assert.ok(route.pattern.length > 0);
    assert.equal(route.custom_domain, true);
  }
  assert.deepEqual(Object.keys(source.assets).sort(), ['binding', 'directory', 'run_worker_first']);
  assert.equal(source.assets.binding, 'ASSETS');
  assert.equal(source.assets.directory, 'dist/assets');
  assert.equal(source.assets.run_worker_first, true);
  return {
    name: source.name,
    main: 'worker/index.js',
    no_bundle: true,
    compatibility_date: source.compatibility_date,
    // Version publication retains the existing Route/Custom Domain connection.
    // That connection is intentionally absent from the upload configuration.
    assets: { binding: 'ASSETS', directory: 'assets', run_worker_first: true },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = path.resolve(process.argv[2]);
  const source = JSON.parse(await readFile(path.join(directory, 'source-config.json'), 'utf8'));
  const config = deploymentConfig(source);
  await access(path.join(directory, config.main));
  await access(path.join(directory, 'assets/install.sh'));
  await writeFile(path.join(directory, 'wrangler.json'), `${JSON.stringify(config, null, 2)}\n`);
}
