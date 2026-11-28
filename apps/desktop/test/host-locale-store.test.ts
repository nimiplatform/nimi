import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createDesktopHostLocaleStore,
  DESKTOP_HOST_LOCALE_SCHEMA_VERSION,
  normalizeDesktopHostLocale,
  parseDesktopHostLocale,
  parseDesktopHostLocaleRecord,
  readDesktopHostLocale,
  resolveDesktopHostLocalePath,
  writeDesktopHostLocale,
} from '../src-electron/host-locale-store.js';

async function createRealTempHome(): Promise<string> {
  return await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-host-locale-store-')));
}

test('resolveDesktopHostLocalePath points to ~/.nimi/run/desktop/host-locale.v1.json and fails closed on empty home', () => {
  const home = path.resolve('/tmp/nimi-user-home');
  assert.equal(
    resolveDesktopHostLocalePath(home),
    path.join(home, '.nimi', 'run', 'desktop', 'host-locale.v1.json'),
  );
  assert.throws(
    () => resolveDesktopHostLocalePath('   '),
    /desktop-host-locale-home-directory-required/u,
  );
});

test('normalizeDesktopHostLocale and strict parsers enforce the v1 schema', () => {
  assert.equal(normalizeDesktopHostLocale('zh-CN'), 'zh');
  assert.equal(normalizeDesktopHostLocale('ZH_Hans'), 'zh');
  assert.equal(normalizeDesktopHostLocale('en-US'), 'en');
  assert.equal(normalizeDesktopHostLocale('ja-JP'), 'en');
  assert.equal(normalizeDesktopHostLocale(undefined), 'en');

  assert.equal(parseDesktopHostLocale('en'), 'en');
  assert.equal(parseDesktopHostLocale('zh'), 'zh');
  assert.throws(() => parseDesktopHostLocale('zh-CN'), /desktop-host-locale-invalid/u);
  assert.throws(() => parseDesktopHostLocale('fr'), /desktop-host-locale-invalid/u);

  assert.deepEqual(parseDesktopHostLocaleRecord({ schemaVersion: 1, locale: 'en' }), {
    schemaVersion: DESKTOP_HOST_LOCALE_SCHEMA_VERSION,
    locale: 'en',
  });
  assert.throws(
    () => parseDesktopHostLocaleRecord({ schemaVersion: 2, locale: 'en' }),
    /desktop-host-locale-invalid/u,
  );
  assert.throws(
    () => parseDesktopHostLocaleRecord({ schemaVersion: 1, locale: 'en', extra: true }),
    /desktop-host-locale-invalid/u,
  );
  assert.throws(() => parseDesktopHostLocaleRecord(['en']), /desktop-host-locale-invalid/u);
});

test('writeDesktopHostLocale and readDesktopHostLocale persist atomically with owner-private permissions', async (context) => {
  const home = await createRealTempHome();
  context.after(() => rm(home, { recursive: true, force: true }));
  const filePath = resolveDesktopHostLocalePath(home);

  assert.equal(await readDesktopHostLocale(filePath), null);

  await writeDesktopHostLocale(filePath, 'en');
  assert.equal(await readDesktopHostLocale(filePath), 'en');
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), {
    schemaVersion: 1,
    locale: 'en',
  });
  assert.deepEqual(await readdir(path.dirname(filePath)), ['host-locale.v1.json']);

  if (process.platform !== 'win32') {
    assert.equal((await stat(path.dirname(filePath))).mode & 0o777, 0o700);
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  }

  await writeDesktopHostLocale(filePath, 'zh');
  assert.equal(await readDesktopHostLocale(filePath), 'zh');
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), {
    schemaVersion: 1,
    locale: 'zh',
  });
  assert.deepEqual(await readdir(path.dirname(filePath)), ['host-locale.v1.json']);

  await assert.rejects(
    writeDesktopHostLocale(filePath, 'fr' as never),
    /desktop-host-locale-invalid/u,
  );
  assert.equal(await readDesktopHostLocale(filePath), 'zh');
});

test('readDesktopHostLocale rejects malformed JSON, invalid schema, and non-regular files', async (context) => {
  const home = await createRealTempHome();
  context.after(() => rm(home, { recursive: true, force: true }));
  const filePath = resolveDesktopHostLocalePath(home);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });

  await writeFile(filePath, '{not-json', 'utf8');
  await assert.rejects(readDesktopHostLocale(filePath), /desktop-host-locale-invalid/u);

  await writeFile(filePath, JSON.stringify({ schemaVersion: 1, locale: 'de' }), 'utf8');
  await assert.rejects(readDesktopHostLocale(filePath), /desktop-host-locale-invalid/u);

  await rm(filePath, { force: true });
  await mkdir(filePath, { mode: 0o700 });
  await assert.rejects(readDesktopHostLocale(filePath), /desktop-host-locale-must-be-file/u);
});

test('readDesktopHostLocale and writeDesktopHostLocale refuse file and ancestor symlinks', async (context) => {
  const home = await createRealTempHome();
  context.after(() => rm(home, { recursive: true, force: true }));

  const targetDir = path.join(home, '.nimi', 'run', 'desktop');
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const realTarget = path.join(home, 'external-locale.json');
  await writeFile(realTarget, JSON.stringify({ schemaVersion: 1, locale: 'en' }), 'utf8');
  const filePath = resolveDesktopHostLocalePath(home);
  await symlink(realTarget, filePath);

  await assert.rejects(
    readDesktopHostLocale(filePath),
    /desktop-host-locale-must-not-be-symlink/u,
  );
  await assert.rejects(
    writeDesktopHostLocale(filePath, 'zh'),
    /desktop-host-locale-must-not-be-symlink/u,
  );
  assert.deepEqual(JSON.parse(await readFile(realTarget, 'utf8')), {
    schemaVersion: 1,
    locale: 'en',
  });

  const linkedHome = await createRealTempHome();
  context.after(() => rm(linkedHome, { recursive: true, force: true }));
  const externalDir = path.join(linkedHome, 'external-dir');
  await mkdir(externalDir, { recursive: true, mode: 0o700 });
  await mkdir(path.join(linkedHome, '.nimi', 'run'), { recursive: true, mode: 0o700 });
  await symlink(
    externalDir,
    path.join(linkedHome, '.nimi', 'run', 'desktop'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const linkedFilePath = resolveDesktopHostLocalePath(linkedHome);

  await assert.rejects(
    readDesktopHostLocale(linkedFilePath),
    /desktop-host-locale-parent-must-not-be-symlink/u,
  );
  await assert.rejects(
    writeDesktopHostLocale(linkedFilePath, 'en'),
    /desktop-host-locale-parent-must-not-be-symlink/u,
  );
});

test('createDesktopHostLocaleStore preserves persisted en across zh-CN OS startup and syncs locale switches atomically', async (context) => {
  const home = await createRealTempHome();
  context.after(() => rm(home, { recursive: true, force: true }));
  const errors: Array<{ operation: 'read' | 'write'; message: string }> = [];

  const firstStore = createDesktopHostLocaleStore({
    homeDirectory: home,
    reportError: (operation, error) => {
      errors.push({ operation, message: error instanceof Error ? error.message : String(error) });
    },
  });

  // First boot with no file initializes from OS locale.
  assert.equal(await firstStore.initialize('zh-CN'), 'zh');
  assert.equal(firstStore.persistedLocale(), 'zh');
  assert.equal(await readDesktopHostLocale(firstStore.filePath), 'zh');

  // Renderer publishes English preference -> atomically persisted.
  await firstStore.sync('en');
  assert.equal(firstStore.persistedLocale(), 'en');
  assert.equal(await readDesktopHostLocale(firstStore.filePath), 'en');

  // Subsequent startup on macOS zh-CN preserves persisted 'en' without clobbering.
  const secondStore = createDesktopHostLocaleStore({
    homeDirectory: home,
    reportError: (operation, error) => {
      errors.push({ operation, message: error instanceof Error ? error.message : String(error) });
    },
  });
  assert.equal(await secondStore.initialize('zh-CN'), 'en');
  assert.equal(secondStore.persistedLocale(), 'en');
  assert.equal(await readDesktopHostLocale(secondStore.filePath), 'en');

  // Rapid concurrent sync transitions settle deterministically on the final locale.
  await Promise.all([secondStore.sync('zh'), secondStore.sync('en'), secondStore.sync('zh')]);
  assert.equal(secondStore.persistedLocale(), 'zh');
  assert.equal(await readDesktopHostLocale(secondStore.filePath), 'zh');
  assert.deepEqual(errors, []);
});

test('createDesktopHostLocaleStore repairs corrupt non-symlink files and refuses symlink targets without crashing', async (context) => {
  const corruptHome = await createRealTempHome();
  context.after(() => rm(corruptHome, { recursive: true, force: true }));
  const corruptPath = resolveDesktopHostLocalePath(corruptHome);
  await mkdir(path.dirname(corruptPath), { recursive: true, mode: 0o700 });
  await writeFile(corruptPath, '{"broken":true}', 'utf8');

  const corruptErrors: string[] = [];
  const corruptStore = createDesktopHostLocaleStore({
    homeDirectory: corruptHome,
    reportError: (operation, error) => {
      corruptErrors.push(`${operation}:${error instanceof Error ? error.message : String(error)}`);
    },
  });
  assert.equal(await corruptStore.initialize('en-US'), 'en');
  assert.equal(await readDesktopHostLocale(corruptPath), 'en');
  assert.deepEqual(corruptErrors, ['read:desktop-host-locale-invalid']);

  const symlinkHome = await createRealTempHome();
  context.after(() => rm(symlinkHome, { recursive: true, force: true }));
  const symlinkPath = resolveDesktopHostLocalePath(symlinkHome);
  await mkdir(path.dirname(symlinkPath), { recursive: true, mode: 0o700 });
  const externalFile = path.join(symlinkHome, 'outside.json');
  await writeFile(externalFile, JSON.stringify({ schemaVersion: 1, locale: 'en' }), 'utf8');
  await symlink(externalFile, symlinkPath);

  const symlinkErrors: string[] = [];
  const symlinkStore = createDesktopHostLocaleStore({
    homeDirectory: symlinkHome,
    reportError: (operation, error) => {
      symlinkErrors.push(`${operation}:${error instanceof Error ? error.message : String(error)}`);
    },
  });
  assert.equal(await symlinkStore.initialize('zh-CN'), 'zh');
  assert.equal(symlinkStore.persistedLocale(), null);
  assert.deepEqual(symlinkErrors, ['read:desktop-host-locale-must-not-be-symlink']);
  // External symlink target remains untouched.
  assert.deepEqual(JSON.parse(await readFile(externalFile, 'utf8')), {
    schemaVersion: 1,
    locale: 'en',
  });
});
