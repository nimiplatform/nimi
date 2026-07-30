import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('signed Electron account-profile native package runs the ordinary CRUD lifecycle', async () => {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('WINDOWS_X64_REQUIRED: product-control native acceptance requires a Windows x64 release runner');
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-product-control-native-'));
  const dataRoot = path.join(root, 'nimi-data');
  try {
    const binding = require('@nimiplatform/desktop-product-control-win32-x64');
    const context = {
      dataRoot,
      accountId: 'account-native-smoke',
    };
    const profile = (title) => ({
      profileId: 'native-smoke',
      version: 'v1',
      title,
      description: 'ordinary native profile CRUD',
      tags: ['smoke'],
      capabilities: {
        'text.generate': {
          readinessPolicy: 'required',
          contractState: 'proposed',
        },
      },
    });

    const listed = binding.listAccountProfileLibrary(context);
    assert.equal(listed.status, 'ok');
    assert.deepEqual(listed.value.profiles, []);

    const created = binding.createAccountProfileLibraryProfile({
      ...context,
      profile: profile('Created'),
    });
    assert.equal(created.status, 'ok');
    assert.equal(created.value.profiles[0].profile.title, 'Created');

    const edited = binding.editAccountProfileLibraryProfile({
      ...context,
      profile: profile('Edited'),
    });
    assert.equal(edited.status, 'ok');
    assert.equal(edited.value.profiles[0].profile.title, 'Edited');

    const exported = binding.exportAccountProfileLibraryProfiles({
      ...context,
      profileIds: ['native-smoke'],
    });
    assert.equal(exported.status, 'ok');
    assert.equal(exported.value[0].title, 'Edited');

    const deleted = binding.deleteAccountProfileLibraryProfile({
      ...context,
      profileId: 'native-smoke',
    });
    assert.equal(deleted.status, 'ok');
    assert.deepEqual(deleted.value.profiles, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
