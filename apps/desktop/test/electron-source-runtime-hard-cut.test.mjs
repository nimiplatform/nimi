import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Electron source dev passes expected Runtime inputs without building Runtime', async () => {
  const launcher = await readFile(
    path.join(desktopRoot, 'scripts', 'run-electron-dev.mjs'),
    'utf8',
  );

  assert.doesNotMatch(launcher, /go['"],\s*\[\s*['"]build|go build/iu);
  assert.doesNotMatch(launcher, /build(?:Windows|MacOS)SourceLocalDevelopmentRuntime/u);
  assert.match(launcher, /NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE/u);
  assert.match(launcher, /NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_DESKTOP_EXECUTABLE/u);
  assert.match(launcher, /NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_NATIVE_ENTRY/u);
  assert.match(launcher, /NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE/u);
  assert.match(launcher, /NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_HOST_EXECUTABLE/u);
  assert.match(launcher, /NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_NATIVE_ENTRY/u);
});

test('Electron main consumes source Runtime without owning its process lifecycle', async () => {
  const main = await readFile(path.join(desktopRoot, 'src-electron', 'main.ts'), 'utf8');

  assert.match(main, /createNimiElectronDeveloperModeStatusProbe/u);
  assert.match(main, /createNimiElectronRuntimeLifecycleHost/u);
  assert.match(main, /SOURCE_PER_USER_RUNTIME_D2\s*\?\s*['"]source['"]\s*:\s*['"]fixed['"]/u);
  assert.match(main, /runtimeLifecycleProfile,/u);
  assert.doesNotMatch(main, /startDesktopLocalDevelopmentRuntime|localDevelopmentRuntime|runtimeD2\?\.stop/u);
});
