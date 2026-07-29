import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAccountProfileLibraryProfile,
  deleteAccountProfileLibraryProfile,
  editAccountProfileLibraryProfile,
  exportAccountProfileLibraryProfiles,
  importAccountProfileLibraryProfiles,
  listAccountProfileLibrary,
} from '../src/shell/renderer/bridge/runtime-bridge/account-profile-library.js';

type ElectronBridgeGlobal = {
  window?: {
    __NIMI_HTML_BOOT_ID__?: string;
  };
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: () => () => void;
  };
};

async function withElectronInvoke<T>(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  const root = globalThis as unknown as ElectronBridgeGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  const previousWindow = root.window;
  root.__NIMI_ELECTRON_TEST__ = { invoke, listen: () => () => undefined };
  root.window = {
    ...(previousWindow ?? {}),
    __NIMI_HTML_BOOT_ID__: 'account-profile-library-bridge-test',
  };
  try {
    return await operation();
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
    root.window = previousWindow;
  }
}

const profile = {
  profileId: 'profile-a',
  title: 'Profile A',
  description: 'Account profile library test',
  tags: ['test'],
  capabilities: {
    'text.generate': {
      readinessPolicy: 'required' as const,
      contractState: 'proposed' as const,
    },
  },
};

const projection = {
  accountId: 'account-a',
  libraryRef: 'account-profile-library:account-a',
  index: {
    schemaVersion: 1,
    accountId: 'account-a',
    updatedAt: '2026-07-29T00:00:00.000Z',
    entries: [{
      profileId: 'profile-a',
      title: 'Profile A',
      origin: 'user',
      relativePath: 'user/profile-a.json',
      editable: true,
      removable: true,
      updatedAt: '2026-07-29T00:00:00.000Z',
    }],
  },
  profiles: [{
    profileId: 'profile-a',
    origin: 'user',
    editable: true,
    removable: true,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    profile,
  }],
};

test('Account Profile Library renderer bridge uses the standard Electron host for every operation', async () => {
  const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
  await withElectronInvoke(async (command, payload) => {
    calls.push({ command, payload });
    return command === 'account_profile_library_export' ? [profile] : projection;
  }, async () => {
    assert.equal((await listAccountProfileLibrary()).libraryRef, projection.libraryRef);
    assert.equal((await createAccountProfileLibraryProfile(profile)).profiles.length, 1);
    assert.equal((await editAccountProfileLibraryProfile(profile)).profiles.length, 1);
    assert.equal((await importAccountProfileLibraryProfiles([profile])).profiles.length, 1);
    assert.equal((await exportAccountProfileLibraryProfiles()).length, 1);
    assert.equal((await deleteAccountProfileLibraryProfile('profile-a')).profiles.length, 1);
  });

  assert.deepEqual(calls, [
    { command: 'account_profile_library_list', payload: {} },
    { command: 'account_profile_library_create', payload: { payload: { profile } } },
    { command: 'account_profile_library_edit', payload: { payload: { profile } } },
    { command: 'account_profile_library_import', payload: { payload: { profiles: [profile] } } },
    { command: 'account_profile_library_export', payload: { payload: { profileIds: [] } } },
    { command: 'account_profile_library_delete', payload: { payload: { profileId: 'profile-a' } } },
  ]);
});

test('Account Profile Library renderer bridge rejects malformed host success payloads', async () => {
  await withElectronInvoke(
    async () => ({ accountId: 'account-a', profiles: 'not-an-array' }),
    async () => {
      await assert.rejects(
        listAccountProfileLibrary(),
        /account profile library index/u,
      );
    },
  );
  await withElectronInvoke(
    async () => ({ profileId: 'not-an-array' }),
    async () => {
      await assert.rejects(
        exportAccountProfileLibraryProfiles(),
        /export must be an array/u,
      );
    },
  );
});
