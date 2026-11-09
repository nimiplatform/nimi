import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stringify as yaml } from 'yaml';
import { readMobileDevelopment } from '../lib/mobile-development.mjs';
import { runAppDevelopment } from '../lib/index.mjs';
import { hashScaffoldManagedContent } from '../lib/app-scaffold.mjs';

const manifest = () => ({ app_id: 'unit.mobile', local_development: { mobile: { command: 'pnpm run native-dev' } } });
const pkg = () => ({ scripts: { 'native-dev': 'node native.mjs' } });

test('mobile entry validates the declared script and rejects recursive or undeclared execution', () => {
  assert.equal(readMobileDevelopment(manifest(), pkg()).script, 'native-dev');
  assert.throws(() => readMobileDevelopment(manifest(), { scripts: {} }), /real, non-recursive/);
  assert.throws(() => readMobileDevelopment(manifest(), { scripts: { 'native-dev': 'nimi-app dev --platform mobile' } }), /non-recursive/);
  const unsafe = manifest(); unsafe.local_development.mobile.command = 'pnpm run native-dev && something-else';
  assert.throws(() => readMobileDevelopment(unsafe, pkg()), /App-owned pnpm script/);
});

test('mobile dev delegates a real child script and rejects Desktop selectors before launch', async t => {
  // Dispatcher regression only. The child marker is not an Android/App acceptance result.
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-mobile-command-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'nimi.app.yaml'), yaml(manifest()));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg()));
  writeFileSync(path.join(root, 'native.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('ran.txt', 'child executed');");
  await assert.rejects(runAppDevelopment(root, { platform: 'mobile', resume: 'dev-project-test' }), /Desktop shell/);
  await runAppDevelopment(root, { platform: 'mobile' });
  assert.equal(readFileSync(path.join(root, 'ran.txt'), 'utf8'), 'child executed');
  writeFileSync(path.join(root, 'native.mjs'), 'process.exit(7);');
  await assert.rejects(runAppDevelopment(root, { platform: 'mobile' }), /exited with 7/);
});

test('the extra mobile entry remains App-owned without weakening managed App identity', () => {
  const source = { app_id: 'unit.mobile', platform: 'web', local_development: { web: { command: 'pnpm run web' } } };
  const before = hashScaffoldManagedContent('nimi.app.yaml', yaml(source));
  source.local_development.mobile = { command: 'pnpm run android' };
  assert.equal(hashScaffoldManagedContent('nimi.app.yaml', yaml(source)), before);
  source.app_id = 'another.app';
  assert.notEqual(hashScaffoldManagedContent('nimi.app.yaml', yaml(source)), before);
});
