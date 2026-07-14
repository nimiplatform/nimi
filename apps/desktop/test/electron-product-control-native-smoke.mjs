import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('signed Electron product-control native package materializes, reads, and rejects tampered evidence', async () => {
  if (process.platform !== 'win32' || process.arch !== 'x64') return;
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-product-control-native-'));
  const home = path.join(root, 'home');
  const dataRoot = path.join(root, 'nimi-data');
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const binding = require('@nimiplatform/desktop-product-control-win32-x64');
    const input = {
      dataRoot,
      accountId: 'account-native-smoke',
      aiProfileAlias: 'local-speech-ready',
      installLevel: 'minimal',
      accountDefaultProfileRef: '',
    };
    const ensured = binding.ensureAccountDefaultProfile(input);
    assert.equal(ensured.status, 'ok');
    assert.match(ensured.value.accountDefaultProfileRef, /^account-default-profile:v1:/u);

    const read = binding.readAccountDefaultProfile(input);
    assert.equal(read.status, 'ok');
    assert.equal(read.value.profileId, 'default');
    assert.equal(read.value.title, 'Default Local Speech Ready');

    const profilePath = path.join(home, '.nimi', 'accounts', 'account-native-smoke', 'profiles', 'default.json');
    const record = JSON.parse(await readFile(profilePath, 'utf8'));
    record.contentHash = `sha256:${'0'.repeat(64)}`;
    await writeFile(profilePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    const rejected = binding.verifyAccountDefaultProfile({
      ...input,
      accountDefaultProfileRef: ensured.value.accountDefaultProfileRef,
    });
    assert.equal(rejected.status, 'error');
    assert.equal(rejected.reasonCode, 'desktop-first-run-evidence-invalid');
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
    await rm(root, { recursive: true, force: true });
  }
});
