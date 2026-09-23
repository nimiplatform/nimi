import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { observeWindowsExecutableFacts } from '../lib/windows-powershell.mjs';
import { lifecycleSkillFiles } from '../lib/app-lifecycle-guidance.mjs';
import { buildAppScaffoldSnapshot, renderAppIdentityInput, SCAFFOLD_INTENT_PATH, SCAFFOLD_LOCK_PATH } from '../lib/app-scaffold.mjs';
import { initApp } from '../lib/app-doctor-update.mjs';
import { checkAppProject, syncAppProject } from '../lib/app-project-lifecycle.mjs';
import { rebaseLocalPackagePaths } from '../lib/app-scaffold-profiles.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appToolsRoot = path.join(testDir, '..');
const cliPath = path.join(appToolsRoot, 'bin', 'nimi-app.mjs');
const appToolsPackage = JSON.parse(readFileSync(path.join(appToolsRoot, 'package.json'), 'utf8'));
const versions = appToolsPackage.nimiScaffoldVersions;

function runCli(args, cwd, env) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  });
}

function jsonErrorMessage(result) {
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  return payload.error.message;
}

function fakeNimicodingEnv(tempRoot) {
  const binDir = path.join(tempRoot, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  const pnpm = path.join(binDir, 'pnpm');
  writeFileSync(pnpm, [
    '#!/bin/sh',
    'if [ "$1" = "--silent" ]; then shift; fi',
    'if [ "$1" = "exec" ] && [ "$2" = "nimicoding" ] && [ "$3" = "sync" ]; then',
    '  if [ "$4" = "--apply" ]; then',
    '    mkdir -p .nimi/methodology',
    '    printf "source: focused-lifecycle-test\\n" > .nimi/methodology/authority-authoring.yaml',
    '  fi',
    '  printf "{\\"ok\\":true,\\"summary\\":{\\"total\\":1,\\"created\\":0}}\\n"',
    '  exit 0',
    'fi',
    'exit 1',
    '',
  ].join('\n'));
  chmodSync(pnpm, 0o755);
  writeFileSync(path.join(binDir, 'pnpm.cmd'), [
    '@ECHO off',
    'IF "%~1"=="--silent" SHIFT',
    'IF "%~1"=="exec" IF "%~2"=="nimicoding" IF "%~3"=="sync" (',
    '  IF "%~4"=="--apply" (',
    '    MKDIR .nimi\\methodology 2>NUL',
    '    > .nimi\\methodology\\authority-authoring.yaml ECHO source: focused-lifecycle-test',
    '  )',
    '  ECHO {"ok":true,"summary":{"total":1,"created":0}}',
    '  EXIT /B 0',
    ')',
    'EXIT /B 1',
    '',
  ].join('\r\n'));
  const corepack = path.join(binDir, 'corepack');
  writeFileSync(corepack, [
    '#!/bin/sh',
    'if [ "$1" = "pnpm" ]; then shift; exec pnpm "$@"; fi',
    'exit 1',
    '',
  ].join('\n'));
  chmodSync(corepack, 0o755);
  writeFileSync(path.join(binDir, 'corepack.cmd'), [
    '@ECHO off',
    'IF "%~1"=="pnpm" (',
    `  CALL "${path.join(binDir, 'pnpm.cmd')}" %2 %3 %4 %5 %6 %7 %8 %9`,
    '  EXIT /B %ERRORLEVEL%',
    ')',
    'EXIT /B 1',
    '',
  ].join('\r\n'));
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
  };
}

function writeExistingSubmittedApp(tempRoot, options = {}) {
  const target = path.join(tempRoot, 'app');
  const codingPackage = path.join(target, 'node_modules/@nimiplatform/nimi-coding');
  mkdirSync(path.join(codingPackage, 'bin'), { recursive: true });
  writeFileSync(path.join(codingPackage, 'package.json'), JSON.stringify({ name: '@nimiplatform/nimi-coding', version: versions.nimicodingVersion, bin: { nimicoding: 'bin/nimicoding.mjs' } }));
  writeFileSync(path.join(codingPackage, 'bin/nimicoding.mjs'), [
    'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
    'if (process.argv.slice(2).join(" ") === "sync --apply --json") { mkdirSync(".nimi/methodology", { recursive: true }); writeFileSync(".nimi/methodology/authority-authoring.yaml", "source: focused-lifecycle-test\\n"); }',
    'const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));',
    'process.stdout.write(JSON.stringify({ ok: true, summary: { total: 1, created: 0, executedVersion: version } }) + "\\n");',
  ].join('\n'));
  mkdirSync(path.join(target, 'src', 'product'), { recursive: true });
  mkdirSync(path.join(target, 'src-tauri'), { recursive: true });
  mkdirSync(path.join(target, '.nimi', 'config'), { recursive: true });
  mkdirSync(path.join(target, 'scripts'), { recursive: true });
  const packageJson = {
    name: 'focused-existing-app',
    license: 'MIT',
    version: '0.1.0',
    private: true,
    type: 'module',
    packageManager: options.packageManager || 'pnpm@10.0.0',
    scripts: {
      dev: 'nimi-app dev --shell electron',
      'dev:shell': 'nimi-app dev',
      'dev:electron': 'nimi-app dev --shell electron',
      'dev:renderer': 'vite --host 127.0.0.1 --port 1430 --strictPort',
      'build:electron': 'tsc -p tsconfig.electron.json',
      doctor: 'nimi-app doctor',
      check: 'node scripts/product-check.mjs',
    },
    dependencies: {
      '@nimiplatform/sdk': 'link:../../../nimi/sdks/typescript',
      '@nimiplatform/kit': 'workspace:*',
      react: '^19.0.0',
    },
    devDependencies: {
      '@nimiplatform/app-tools': 'file:../../../nimi/app-tools',
      '@nimiplatform/nimi-coding': '../../../nimi-coding.tgz',
      '@nimiplatform/kit-protected-local-win32-x64': 'link:../../../nimi/kit/native',
      vite: '^7.0.0',
    },
  };
  writeFileSync(path.join(target, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(path.join(target, 'pnpm-workspace.yaml'), [
    'packages:',
    '  - .',
    '',
    'overrides:',
    "  '@nimiplatform/kit': link:../../../nimi/kit",
    "  '@nimiplatform/sdk': ^0.6.0",
    "  'unrelated-package': 1.2.3",
    '',
    'allowBuilds:',
    '  esbuild: true',
    '',
  ].join('\n'));
  writeFileSync(path.join(target, 'pnpm-lock.yaml'), [
    "lockfileVersion: '9.0'",
    '',
    'overrides:',
    "  '@nimiplatform/kit': link:../../../nimi/kit",
    "  '@nimiplatform/sdk': workspace:*",
    '',
    'importers:',
    '  .:',
    '    dependencies:',
    "      '@nimiplatform/kit':",
    '        specifier: link:../../../nimi/kit',
    '        version: link:../../../nimi/kit',
    "      '@nimiplatform/sdk':",
    '        specifier: workspace:*',
    '        version: link:../../../nimi/sdks/typescript',
    '',
  ].join('\n'));
  writeFileSync(path.join(target, 'icon.png'), PNG.sync.write({ width: 128, height: 128, data: Buffer.alloc(128 * 128 * 4, 255) }));
  writeFileSync(path.join(target, 'README.md'), 'Use this test App.\n');
  writeFileSync(path.join(target, 'RELEASE_NOTES.md'), 'Initial release.\n');
  writeFileSync(path.join(target, 'LICENSE'), 'MIT\n');
  writeFileSync(path.join(target, 'nimi.app.yaml'), [
    'app_id: focused.existing',
    'display_name: Focused Existing',
    'version: 0.1.0',
    'profile: standalone',
    'manifest_role: submitted-input',
    'app_access: []',
    'capability_contract_refs: []',
    'required_standardized_feature_refs: []',
    'storage_policy: { kind: nimi-mediated-default }',
    'metadata: { summary: A test application., icon: icon.png, readme: README.md, release_notes: RELEASE_NOTES.md }',
    'local_development:',
    '  electron:',
    '    renderer_origin: http://127.0.0.1:1430',
    '',
  ].join('\n'));
  writeFileSync(path.join(target, 'src-tauri', 'Cargo.toml'), [
    '[package]',
    'name = "focused-existing-shell"',
    'version = "0.1.0"',
    '',
    '[dependencies]',
    'tauri = "2"',
    'nimi-shell-tauri = { path = "../../../nimi/kit/shell/tauri" }',
    '',
  ].join('\n'));
  writeFileSync(path.join(target, 'src-tauri', 'Cargo.lock'), [
    'version = 4',
    '',
    '[[package]]',
    'name = "nimi-shell-tauri"',
    `version = "${versions.nimiShellTauriVersion}"`,
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    `checksum = "${'a'.repeat(64)}"`,
    '',
  ].join('\n'));
  writeFileSync(path.join(target, 'src-tauri', 'tauri.conf.json'), `${JSON.stringify({
    productName: 'Focused Existing',
    version: '0.1.0',
    identifier: 'focused.existing',
  }, null, 2)}\n`);
  writeFileSync(path.join(target, 'src', 'product', 'owned.ts'), 'export const productOwned = "untouched";\n');
  writeFileSync(path.join(target, 'vite.config.ts'), [
    "import path from 'node:path';",
    "const appRoot = 'D:/app';",
    "const nimiRepoRoot = path.resolve(appRoot, '../../nimi');",
    "const nimiSdkSourceRoot = path.resolve(nimiRepoRoot, 'sdks/typescript');",
    'export default {',
    '  resolve: { alias: [',
    "    { find: /^@nimiplatform\\/sdk$/, replacement: path.resolve(nimiSdkSourceRoot, 'index.ts') },",
    '  ] },',
    '  server: {',
    '    fs: {',
    '      allow: [',
    '        appRoot,',
    '        nimiRepoRoot,',
    '      ],',
    '    },',
    '  },',
    '};',
    '',
  ].join('\n'));
  writeFileSync(path.join(target, 'src', 'styles.css'), '@source "../../../nimi/kit/**/*.{ts,tsx}";\n');
  writeFileSync(path.join(target, 'scripts', 'owner-test.mjs'), 'process.stdout.write("owner test ran\\n");\n');
  writeFileSync(path.join(target, 'scripts', 'owner-build.mjs'), 'process.stdout.write("owner build ran\\n");\n');
  writeFileSync(path.join(target, '.nimi', 'config', 'build-profile.yaml'), [
    `build_profile_ref: ${options.buildProfileRef || 'tauri-pnpm-vite'}`,
    'test_command: node scripts/owner-test.mjs',
    'build_command: node scripts/owner-build.mjs',
    'targets:',
    '  windows-x86_64:',
    '    os: windows',
    '    arch: x86_64',
    '    build_command: node scripts/owner-build.mjs',
    '    payload_path: build/windows',
    '    runtime_entry: payload/focused-existing.exe',
    'profile_role: developer-workflow-input',
    '',
  ].join('\n'));
  return target;
}

function writePublicRegistryLock(target) {
  writeFileSync(path.join(target, 'pnpm-lock.yaml'), stringifyYaml({
    lockfileVersion: '9.0',
    importers: {
      '.': {
        dependencies: {
          '@nimiplatform/kit': {
            specifier: versions.kitVersion,
            version: versions.kitVersion,
          },
          '@nimiplatform/sdk': {
            specifier: versions.sdkVersion,
            version: versions.sdkVersion,
          },
        },
        devDependencies: {
          '@nimiplatform/app-tools': {
            specifier: versions.appToolsVersion,
            version: versions.appToolsVersion,
          },
          '@nimiplatform/nimi-coding': {
            specifier: versions.nimicodingVersion,
            version: versions.nimicodingVersion,
          },
        },
      },
    },
  }));
}

test('workspace importers resolve tarball specifiers locally and reject stale child installations', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-workspace-archives-'));
  const target = writeExistingSubmittedApp(tempRoot, { buildProfileRef: 'electron-pnpm' });
  const env = fakeNimicodingEnv(tempRoot);
  try {
    let result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writePublicRegistryLock(target);
    const name = '@nimiplatform/sdk';
    const selected = 'file:.nimi/local/packages/sdk.tgz';
    const archive = path.join(target, '.nimi/local/packages/sdk.tgz');
    mkdirSync(path.dirname(archive), { recursive: true });
    writeFileSync(archive, 'lock validation fixture; consumer performs real installation');
    const workspacePath = path.join(target, 'pnpm-workspace.yaml');
    const workspace = parseYaml(readFileSync(workspacePath, 'utf8'));
    workspace.packages = ['.', 'web', 'tools/css'];
    workspace.overrides[name] = selected;
    writeFileSync(workspacePath, stringifyYaml(workspace));
    const lockPath = path.join(target, 'pnpm-lock.yaml');
    const lock = parseYaml(readFileSync(lockPath, 'utf8'));
    lock.overrides = { [name]: selected };
    lock.importers['.'].dependencies[name] = { specifier: selected, version: selected + '(peer@root)' };
    for (const importer of ['web', 'tools/css']) {
      const directory = path.join(target, importer);
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: importer.replace('/', '-'), private: true, dependencies: { [name]: versions.sdkVersion } }));
      lock.importers[importer] = { dependencies: { [name]: {
        specifier: 'file:' + path.relative(directory, archive).split(path.sep).join('/'),
        version: selected + '(peer@child)',
      } } };
    }
    lock.packages = { [name + '@' + selected]: { version: versions.sdkVersion.slice(1), resolution: { tarball: selected, integrity: 'sha512-workspace-fixture' } } };
    const sdkDirectory = path.join(target, 'node_modules', ...name.split('/'));
    mkdirSync(sdkDirectory, { recursive: true });
    writeFileSync(path.join(sdkDirectory, 'package.json'), JSON.stringify({ name, version: versions.sdkVersion.slice(1) }));
    const virtualStore = path.join(target, 'node_modules', '.pnpm');
    mkdirSync(virtualStore, { recursive: true });
    writeFileSync(path.join(target, 'node_modules', '.modules.yaml'), stringifyYaml({ virtualStoreDir: '.pnpm' }));
    writeFileSync(lockPath, stringifyYaml(lock));
    writeFileSync(path.join(virtualStore, 'lock.yaml'), stringifyYaml(lock));
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    for (const specifier of ['file:../.nimi/local/packages/other-sdk.tgz', 'link:../source-sdk']) {
      const invalid = structuredClone(lock);
      invalid.importers.web.dependencies[name].specifier = specifier;
      writeFileSync(lockPath, stringifyYaml(invalid));
      result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
      assert.notEqual(result.status, 0);
      assert.match(jsonErrorMessage(result), /retains a local Nimi resolution at importers.web/);
    }
    writeFileSync(lockPath, stringifyYaml(lock));
    const stale = structuredClone(lock);
    stale.importers.web.dependencies[name].version = selected + '(peer@old)';
    writeFileSync(path.join(virtualStore, 'lock.yaml'), stringifyYaml(stale));
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /installation is stale.*importers.web/);
  } finally { rmSync(tempRoot, { recursive: true, force: true }); }
});

test('local Nimi tarball overrides survive sync and are checked without requiring publication', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-local-packages-'));
  const target = writeExistingSubmittedApp(tempRoot, { buildProfileRef: 'electron-packager-pnpm-vite' });
  const env = fakeNimicodingEnv(tempRoot);
  try {
    let result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    writePublicRegistryLock(target);
    const archive = path.join(tempRoot, 'sdk.tgz');
    // Package/lock inputs for lifecycle validation only; real pnpm installation is verified separately.
    writeFileSync(archive, 'archive fixture');
    const selected = 'file:' + archive.split(path.sep).join('/');
    const relative = 'file:' + path.relative(target, archive).split(path.sep).join('/');
    const workspacePath = path.join(target, 'pnpm-workspace.yaml');
    const workspace = parseYaml(readFileSync(workspacePath, 'utf8'));
    workspace.overrides['@nimiplatform/sdk'] = selected;
    writeFileSync(workspacePath, stringifyYaml(workspace));
    const lockPath = path.join(target, 'pnpm-lock.yaml');
    const lock = parseYaml(readFileSync(lockPath, 'utf8'));
    lock.overrides = { '@nimiplatform/sdk': selected };
    lock.importers['.'].dependencies['@nimiplatform/sdk'] = { specifier: selected, version: relative };
    lock.packages = { ['@nimiplatform/sdk@' + relative]: { resolution: { tarball: relative, integrity: 'sha512-sdk-fixture' }, version: versions.sdkVersion.replace(/^\^/u, '') } };
    writeFileSync(lockPath, stringifyYaml(lock));
    const installedPath = path.join(target, 'node_modules', '@nimiplatform', 'sdk');
    mkdirSync(installedPath, { recursive: true });
    writeFileSync(path.join(installedPath, 'package.json'), JSON.stringify({ name: '@nimiplatform/sdk', version: versions.sdkVersion.replace(/^\^/u, '') }));
    const installedLockDir = path.join(target, 'node_modules', '.pnpm');
    mkdirSync(installedLockDir, { recursive: true });
    writeFileSync(path.join(target, 'node_modules', '.modules.yaml'), stringifyYaml({ virtualStoreDir: '.pnpm' }));
    const recordInstalledLock = () => writeFileSync(path.join(installedLockDir, 'lock.yaml'), stringifyYaml(lock));
    recordInstalledLock();
    result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(parseYaml(readFileSync(workspacePath, 'utf8')).overrides['@nimiplatform/sdk'], selected);
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const sdkKey = '@nimiplatform/sdk@' + relative;
    const originalResolution = structuredClone(lock.packages[sdkKey]);
    const newerVersion = originalResolution.version.replace(/(\d+)$/u, (patch) => String(Number(patch) + 1));
    for (const change of [
      { version: newerVersion },
      { resolution: { ...originalResolution.resolution, integrity: 'sha512-rebuilt-sdk-fixture' } },
    ]) {
      lock.packages[sdkKey] = { ...originalResolution, ...change };
      writeFileSync(lockPath, stringifyYaml(lock));
      result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
      assert.notEqual(result.status, 0, 'stale installed tarball passed the lifecycle check');
      assert.match(jsonErrorMessage(result), /installation is stale/);
    }
    lock.packages[sdkKey] = originalResolution;
    const replacementArchive = path.join(tempRoot, 'sdk-replacement.tgz');
    writeFileSync(replacementArchive, 'same version, different local source');
    const replacement = 'file:' + replacementArchive.split(path.sep).join('/');
    const replacedLock = structuredClone(lock);
    replacedLock.overrides['@nimiplatform/sdk'] = replacement;
    replacedLock.importers['.'].dependencies['@nimiplatform/sdk'] = { specifier: replacement, version: replacement };
    replacedLock.packages = { ['@nimiplatform/sdk@' + replacement]: { ...originalResolution, resolution: { tarball: replacement, integrity: 'sha512-replacement-sdk-fixture' } } };
    writeFileSync(workspacePath, stringifyYaml({ ...workspace, overrides: { ...workspace.overrides, '@nimiplatform/sdk': replacement } }));
    writeFileSync(lockPath, stringifyYaml(replacedLock));
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.notEqual(result.status, 0, 'stale installed source passed the lifecycle check');
    assert.match(jsonErrorMessage(result), /installation is stale/);
    writeFileSync(workspacePath, stringifyYaml(workspace));
    lock.packages[sdkKey] = { ...originalResolution, version: newerVersion };
    writeFileSync(lockPath, stringifyYaml(lock));
    recordInstalledLock();
    writeFileSync(path.join(installedPath, 'package.json'), JSON.stringify({ name: '@nimiplatform/sdk', version: newerVersion }));
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = runCli(['check', '--dir', target, '--production', '--json'], tempRoot, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /Production release preflight requires registry dependencies/);
    const nativeName = '@nimiplatform/kit-protected-local-win32-x64';
    const nativeArchive = path.join(tempRoot, 'native.tgz');
    writeFileSync(nativeArchive, 'native archive fixture');
    const nativeSelected = 'file:' + nativeArchive.split(path.sep).join('/');
    workspace.overrides[nativeName] = nativeSelected;
    lock.overrides[nativeName] = nativeSelected;
    lock.packages[nativeName + '@' + nativeSelected] = { version: versions.kitVersion.replace(/^\^/u, ''), resolution: { tarball: nativeSelected, integrity: 'sha512-native-fixture' } };
    writeFileSync(workspacePath, stringifyYaml(workspace));
    writeFileSync(lockPath, stringifyYaml(lock));
    recordInstalledLock();
    const kitPath = path.join(target, 'node_modules', '@nimiplatform', 'kit');
    const nativePath = path.join(kitPath, 'node_modules', ...nativeName.split('/'));
    mkdirSync(nativePath, { recursive: true });
    writeFileSync(path.join(kitPath, 'package.json'), JSON.stringify({ name: '@nimiplatform/kit', version: versions.kitVersion.replace(/^\^/u, '') }));
    writeFileSync(path.join(nativePath, 'package.json'), JSON.stringify({ name: nativeName, version: versions.kitVersion.replace(/^\^/u, '') }));
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    writeFileSync(path.join(installedPath, 'package.json'), JSON.stringify({ name: '@nimiplatform/sdk', version: '0.0.0' }));
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.match(jsonErrorMessage(result), /Installed local Nimi package must be/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('production dependency staging rebases local archives in lock keys, peer suffixes and overrides', () => {
  const source = path.resolve('fixture/app');
  const staged = path.join(source, '.nimi/local/production');
  const original = { overrides: { '@nimiplatform/sdk': 'file:../sdk.tgz' },
    packages: { '@nimiplatform/sdk@file:../sdk.tgz(peer@1)': { resolution: { tarball: 'file:../sdk.tgz' }, version: '0.13.0' } } };
  const rebased = rebaseLocalPackagePaths(original, source, staged);
  const selected = rebased.overrides['@nimiplatform/sdk'];
  assert.equal(path.resolve(staged, selected.slice(5)), path.resolve(source, '../sdk.tgz'));
  assert.equal(rebased.packages['@nimiplatform/sdk@' + selected + '(peer@1)'].resolution.tarball, selected);
  assert.equal(original.overrides['@nimiplatform/sdk'], 'file:../sdk.tgz');
});

test('production staging preserves parentheses in archive paths and nested local peers', () => {
  const source = path.resolve('fixture/app');
  const staged = path.join(source, '.nimi/local/production/source');
  const sdk = 'file:../packages (dev)/sdk.tgz';
  const kit = 'file:../cache.tgz (dev)/kit.tar.gz';
  const peerKey = `@nimiplatform/kit@${kit}(@nimiplatform/sdk@${sdk})(react@19.2.8)`;
  const original = {
    overrides: { '@nimiplatform/sdk': sdk, '@nimiplatform/kit': kit },
    packages: { [`@nimiplatform/sdk@${sdk}`]: { resolution: { tarball: sdk } },
      [`@nimiplatform/kit@${kit}`]: { resolution: { tarball: kit } } },
    snapshots: { [peerKey]: { dependencies: { '@nimiplatform/sdk': sdk } } },
  };
  const before = structuredClone(original);
  const rebased = rebaseLocalPackagePaths(original, source, staged);
  const nextSDK = rebased.overrides['@nimiplatform/sdk'];
  const nextKit = rebased.overrides['@nimiplatform/kit'];
  for (const [prior, next] of [[sdk, nextSDK], [kit, nextKit]]) {
    assert.equal(path.resolve(staged, next.slice(5)), path.resolve(source, prior.slice(5)));
  }
  const nextPeerKey = `@nimiplatform/kit@${nextKit}(@nimiplatform/sdk@${nextSDK})(react@19.2.8)`;
  assert.equal(rebased.snapshots[nextPeerKey].dependencies['@nimiplatform/sdk'], nextSDK);
  assert.deepEqual(original, before);
  assert.equal(rebaseLocalPackagePaths(sdk, source, staged), nextSDK);
  const embeddedRebase = new Function('path', `return (${rebaseLocalPackagePaths.toString()})`)(path);
  assert.deepEqual(embeddedRebase(original, source, staged), rebased);
});

test('generated production staging uses the project work area and preserves archive identity through a project alias', async () => {
  const temp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'nimi-app-staging-alias-')));
  try {
    const physicalApp = path.join(temp, 'consumer');
    const appRoot = path.join(temp, 'consumer-alias');
    const archive = path.join(temp, 'packages', 'sdk.tgz');
    mkdirSync(physicalApp);
    symlinkSync(physicalApp, appRoot, process.platform === 'win32' ? 'junction' : 'dir');
    mkdirSync(path.dirname(archive));
    writeFileSync(archive, 'the selected archive');
    const snapshot = buildAppScaffoldSnapshot({
      profile: 'standalone', versions, targetDir: physicalApp,
      appId: 'example.staging', appTitle: 'Staging', packageName: 'example-staging', features: [],
    });
    const packager = snapshot.filesByPath.get('scripts/package-electron-production.mjs').content;
    assert.doesNotMatch(packager, /\btmpdir\(\)|from 'node:os'/u, 'packaging staging must not use OS temp');
    const start = packager.search(/^const stagingParent = /mu);
    const end = packager.indexOf('\n', packager.search(/^const stagingRoot = /mu));
    assert.ok(start >= 0 && end > start, 'generated packager must allocate its staging root');
    const stagingRoot = await new Function('path', 'mkdir', 'mkdtemp', 'realpath', 'appRoot',
      `return (async () => { ${packager.slice(start, end)} return stagingRoot; })();`)(path, mkdir, mkdtemp, realpath, appRoot);
    // The staging root is physical and inside the project's ignored work area.
    assert.equal(path.dirname(stagingRoot), path.join(physicalApp, '.nimi', 'local', 'build'));
    assert.match(path.basename(stagingRoot), /^electron-/u);
    const productionSourceRoot = path.join(stagingRoot, 'app');
    mkdirSync(productionSourceRoot);
    const selected = 'file:' + path.relative(appRoot, archive).split(path.sep).join('/');
    const rebased = rebaseLocalPackagePaths(selected, appRoot, productionSourceRoot);
    // pnpm executes with a physical cwd, even if mkdtemp returned an alias.
    const actualArchive = path.resolve(await realpath(productionSourceRoot), rebased.slice(5));
    assert.equal(readFileSync(actualArchive, 'utf8'), 'the selected archive');
    assert.equal(await realpath(actualArchive), await realpath(archive));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

function snapshotTree(rootDir) {
  const snapshot = {};
  const walk = (currentDir) => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        snapshot[path.relative(rootDir, fullPath).split(path.sep).join('/')] = readFileSync(fullPath).toString('base64');
      }
    }
  };
  walk(rootDir);
  return snapshot;
}

function rawAppInput(target) {
  const manifest = parseYaml(readFileSync(path.join(target, 'nimi.app.yaml'), 'utf8'));
  const buildProfile = parseYaml(readFileSync(path.join(target, '.nimi/config/build-profile.yaml'), 'utf8'));
  rmSync(path.join(target, '.nimi'), { recursive: true });
  rmSync(path.join(target, 'nimi.app.yaml'));
  const inputPath = path.join(target, 'adopt-input.json');
  writeFileSync(inputPath, JSON.stringify({ manifest, build_profile: buildProfile }));
  // The owner test executes real product logic; init never executes or replaces it.
  writeFileSync(path.join(target, 'src/product/title.mjs'), 'export const normalizeTitle = value => value.trim().replace(/\\s+/g, " ");\n');
  writeFileSync(path.join(target, 'scripts/owner-test.mjs'), 'import assert from "node:assert/strict"; import { normalizeTitle } from "../src/product/title.mjs"; assert.equal(normalizeTitle("  A   title  "), "A title");\n');
  writeFileSync(path.join(target, 'index.html'), '<!doctype html><title>Document title</title><input id="title"><output id="preview"></output><script type="module">import {normalizeTitle} from "./src/product/title.mjs"; document.querySelector("input").oninput = e => document.querySelector("output").textContent=normalizeTitle(e.target.value);</script>');
  return inputPath;
}

test('lifecycle projection includes the safety declaration guide and every linked scenario', () => {
  const files = new Map(lifecycleSkillFiles().map((file) => [file.path, file.content]));
  const root = '.agents/skills/nimi-app-lifecycle';
  assert.match(files.get(`${root}/references/safety-declaration.md`) ?? '', /nimi\.app\.yaml/);
  for (const match of files.get(`${root}/SKILL.md`).matchAll(/\]\((references\/[^)#]+\.md)\)/g)) {
    assert.ok(files.has(`${root}/${match[1]}`), `Missing projected guide: ${match[1]}`);
  }
});

test('raw adoption previews without writes, keeps product ownership and repeats without changes', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-raw-adopt-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-packager-pnpm-vite' });
    const input = rawAppInput(target);
    writeFileSync(path.join(target, 'AGENTS.md'), '# Original development instructions\n');
    const before = snapshotTree(target);
    const env = fakeNimicodingEnv(temp);
    let result = runCli(['init', '--adopt', '--input', input, '--dry-run', '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.ownerSteps[0].previewed, false);
    assert.ok(preview.changes.some((file) => file.path === 'nimi.app.yaml' && file.action === 'create'));
    assert.deepEqual(snapshotTree(target), before);
    result = runCli(['init', '--adopt', '--input', input, '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(path.join(target, SCAFFOLD_INTENT_PATH)), false);
    assert.equal(existsSync(path.join(target, SCAFFOLD_LOCK_PATH)), false);
    for (const file of ['README.md', 'LICENSE', 'src/product/title.mjs', 'scripts/owner-test.mjs', 'index.html']) {
      assert.equal(snapshotTree(target)[file], before[file]);
    }
    assert.match(readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), /Original development instructions/);
    assert.equal(existsSync(path.join(target, 'build/windows')), false, 'init does not require production output');
    result = runCli(['init', '--adopt', '--input', input, '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).changes, []);
    const retired = path.join(target, '.agents/skills/nimi-app-lifecycle/references/retired.md');
    writeFileSync(retired, 'Retired generated guidance');
    result = runCli(['sync', '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(retired), false);
    result = runCli(['test', '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('existing Next adoption and sync preserve the App renderer and production owners without Vite', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-next-adopt-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-pnpm' });
    const input = rawAppInput(target);
    const inputDocument = JSON.parse(readFileSync(input, 'utf8'));
    inputDocument.manifest.local_development.electron.host_source_directory = 'electron';
    writeFileSync(input, JSON.stringify(inputDocument));
    mkdirSync(path.join(target, 'electron'));
    writeFileSync(path.join(target, 'electron/main.ts'), 'export const host = "existing";\n');
    rmSync(path.join(target, 'vite.config.ts'));
    rmSync(path.join(target, 'index.html'));
    const packagePath = path.join(target, 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    pkg.scripts['dev:renderer'] = 'next dev --hostname 127.0.0.1 --port 1430';
    pkg.scripts.build = 'next build';
    delete pkg.devDependencies.vite;
    pkg.dependencies.next = '^16.0.7';
    writeFileSync(packagePath, JSON.stringify(pkg));
    mkdirSync(path.join(target, 'app/api/example'), { recursive: true });
    const source = 'export const GET = () => Response.json({ example: true });\n';
    writeFileSync(path.join(target, 'app/api/example/route.ts'), source);
    mkdirSync(path.join(target, 'public/editor'), { recursive: true });
    mkdirSync(path.join(target, 'packages/mcp/src'), { recursive: true });
    const vendor = 'export const endpoint = "https://api.openai.com/v1/chat/completions";\n';
    writeFileSync(path.join(target, 'public/editor/editor.js'), vendor);
    writeFileSync(path.join(target, 'packages/mcp/src/server.ts'), 'fetch("/api/state");\n');
    const env = fakeNimicodingEnv(temp);
    const before = snapshotTree(target);
    let result = runCli(['init', '--adopt', '--input', input, '--dry-run', '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(snapshotTree(target), before);
    result = runCli(['init', '--adopt', '--input', input, '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writePublicRegistryLock(target);
    result = runCli(['check', '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    result = runCli(['sync', '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).changes, []);
    const actual = JSON.parse(readFileSync(packagePath, 'utf8'));
    actual.dependencies = Object.fromEntries(Object.entries(actual.dependencies).reverse());
    const formattedPackage = `${JSON.stringify(actual, null, 4)}\n`;
    writeFileSync(packagePath, formattedPackage);
    result = runCli(['sync', '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).changes, []);
    assert.equal(readFileSync(packagePath, 'utf8'), formattedPackage);
    delete actual.scripts.pack;
    writeFileSync(packagePath, `${JSON.stringify(actual, null, 4)}\n`);
    result = runCli(['sync', '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(JSON.parse(result.stdout).changes.some((file) => file.path === 'package.json'));
    assert.equal(JSON.parse(readFileSync(packagePath, 'utf8')).scripts.pack, 'nimi-app pack');
    assert.equal(actual.scripts['dev:renderer'], pkg.scripts['dev:renderer']);
    assert.equal(actual.scripts.build, 'next build');
    assert.equal(parseYaml(readFileSync(path.join(target, 'nimi.app.yaml'), 'utf8')).local_development.electron.host_source_directory, 'electron');
    assert.equal(actual.devDependencies.vite, undefined);
    assert.equal(existsSync(path.join(target, 'vite.config.ts')), false);
    assert.equal(existsSync(path.join(target, SCAFFOLD_LOCK_PATH)), false);
    assert.equal(readFileSync(path.join(target, 'app/api/example/route.ts'), 'utf8'), source);
    assert.equal(readFileSync(path.join(target, 'public/editor/editor.js'), 'utf8'), vendor);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('existing Next sync excludes marked custom build outputs while retaining source checks', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-next-output-'));
  const target = writeExistingSubmittedApp(tempRoot, { buildProfileRef: 'electron-pnpm' });
  const env = fakeNimicodingEnv(tempRoot);
  try {
    let result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writePublicRegistryLock(target);
    for (const relative of ['web/.next-nimi/dev', 'web/.next-nimi-production']) {
      const output = path.join(target, relative);
      for (const subdir of ['server/chunks/ssr', 'static/chunks']) {
        mkdirSync(path.join(output, subdir), { recursive: true });
        writeFileSync(path.join(output, subdir, 'sdk-bundle.js'), 'export const message = { launchBinding: null };\n');
      }
      writeFileSync(path.join(output, 'build-manifest.json'), '{"pages":{}}\n');
      writeFileSync(path.join(output, 'routes-manifest.json'), '{"version":3}\n');
    }
    const before = snapshotTree(target);
    for (const args of [['sync', '--dry-run', '--json'], ['check', '--json']]) {
      result = runCli([...args, '--dir', target], tempRoot, env);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(snapshotTree(target), before);
    }
    // A similarly named source folder has no output markers and is still scanned.
    for (const relative of ['web/src/caller.ts', 'web/.next-business/caller.ts']) {
      const source = path.join(target, relative);
      mkdirSync(path.dirname(source), { recursive: true });
      writeFileSync(source, 'export const state = { launchBinding: value };\n');
      result = runCli(['sync', '--dir', target, '--dry-run', '--json'], tempRoot, env);
      assert.notEqual(result.status, 0);
      assert.ok(jsonErrorMessage(result).includes(`${relative}: renderer launch binding custody`));
      rmSync(source);
    }
  } finally { rmSync(tempRoot, { recursive: true, force: true }); }
});

test('adoption keeps App-owned login and refresh routes without claiming Realm authority', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-business-auth-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-pnpm' });
    const input = rawAppInput(target);
    const sources = {
      'web/lib/auth.ts': "export const login = body => fetch('/api/auth/login', { method: 'POST', body });\nexport const refresh = () => fetch('/api/auth/refresh', { method: 'POST' });\n",
      'web/contracts/generated/api.ts': 'export interface Paths { "/api/auth/login": unknown; "/api/auth/refresh": unknown; }\n',
    };
    for (const [relative, source] of Object.entries(sources)) {
      mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
      writeFileSync(path.join(target, relative), source);
    }
    const env = fakeNimicodingEnv(temp);
    for (const args of [
      ['init', '--adopt', '--input', input, '--dry-run', '--json'],
      ['init', '--adopt', '--input', input, '--json'],
      ['sync', '--dry-run', '--json'],
    ]) {
      const result = runCli(args, target, env);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      for (const [relative, source] of Object.entries(sources)) {
        assert.equal(readFileSync(path.join(target, relative), 'utf8'), source);
      }
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('adoption excludes Python virtual environments but still rejects protected App custody', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-python-env-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-pnpm' });
    const input = rawAppInput(target);
    for (const directory of ['.venv', 'python-tools']) {
      const environment = path.join(target, directory);
      const vendor = path.join(environment, 'lib/python3.14/site-packages/vendor/web');
      mkdirSync(vendor, { recursive: true });
      writeFileSync(path.join(environment, 'pyvenv.cfg'), 'include-system-site-packages = false\n');
      writeFileSync(path.join(vendor, 'bundle.js'), "localStorage.setItem('access_token', value);\n");
    }
    const env = fakeNimicodingEnv(temp);
    let result = runCli(['init', '--adopt', '--input', input, '--dry-run', '--json'], target, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const before = snapshotTree(target);
    writeFileSync(path.join(target, 'src/product/leak.ts'), "localStorage.setItem('nimi-access-token', value);\nimport { privateCall } from '../runtime/internal/client';\n");
    result = runCli(['init', '--adopt', '--input', input, '--dry-run', '--json'], target, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /src\/product\/leak\.ts: renderer or app storage of protected material/);
    assert.match(jsonErrorMessage(result), /src\/product\/leak\.ts: Runtime private import/);
    rmSync(path.join(target, 'src/product/leak.ts'));
    assert.deepEqual(snapshotTree(target), before);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('adoption rejects an invalid or missing declared Host source directory before writes', () => {
  for (const sourceDirectory of ['../outside', '/absolute', 'missing', 'electron\\main']) {
    const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-host-source-'));
    try {
      const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-pnpm' });
      const manifestPath = path.join(target, 'nimi.app.yaml');
      const manifest = parseYaml(readFileSync(manifestPath, 'utf8'));
      manifest.local_development.electron.host_source_directory = sourceDirectory;
      writeFileSync(manifestPath, stringifyYaml(manifest));
      const before = snapshotTree(target);
      const result = runCli(['init', '--adopt', '--json'], target, fakeNimicodingEnv(temp));
      assert.notEqual(result.status, 0);
      assert.match(jsonErrorMessage(result), /host_source_directory/);
      assert.deepEqual(snapshotTree(target), before);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
});

test('framework-neutral adoption needs a real non-recursive renderer command before any writes', () => {
  for (const command of [undefined, '', 'pnpm run dev:renderer', 'nimi-app dev']) {
    const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-renderer-adopt-'));
    try {
      const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-pnpm' });
      const packagePath = path.join(target, 'package.json');
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      pkg.scripts['dev:renderer'] = command;
      writeFileSync(packagePath, JSON.stringify(pkg));
      const before = snapshotTree(target);
      const result = runCli(['init', '--adopt', '--json'], target, fakeNimicodingEnv(temp));
      assert.notEqual(result.status, 0);
      assert.match(jsonErrorMessage(result), /dev:renderer/);
      assert.deepEqual(snapshotTree(target), before);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
});

test('adoption rejects conflicting input or unknown managed files before owner writes', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-adopt-conflicts-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-packager-pnpm-vite' });
    const input = rawAppInput(target);
    mkdirSync(path.join(target, '.github/workflows'), { recursive: true });
    writeFileSync(path.join(target, '.github/workflows/nimi-app-release.yml'), 'name: original workflow\n');
    const before = snapshotTree(target);
    const env = fakeNimicodingEnv(temp);
    let result = runCli(['init', '--adopt', '--input', input, '--json'], target, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /Unknown adoption file collision/);
    assert.deepEqual(snapshotTree(target), before);
    rmSync(path.join(target, '.github'), { recursive: true });
    writeFileSync(path.join(target, 'nimi.app.yaml'), stringifyYaml({ ...JSON.parse(readFileSync(input)).manifest, version: '99.0.0' }));
    const conflicting = snapshotTree(target);
    result = runCli(['init', '--adopt', '--input', input, '--json'], target, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /Adoption input conflicts/);
    assert.deepEqual(snapshotTree(target), conflicting);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('authoring input files do not establish ownership of an unknown adoption workflow', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-adopt-ownership-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-packager-pnpm-vite' });
    writeFileSync(path.join(target, '.nimi/config/app-identity.yaml'), renderAppIdentityInput({
      appId: 'focused.existing', appTitle: 'Focused Existing', version: '0.1.0', packageName: 'focused-existing-app',
      cargoPackageName: 'focused-existing-app-shell', tauriIdentifier: 'ai.nimi.apps.focused.existing',
    }));
    mkdirSync(path.join(target, '.github/workflows'), { recursive: true });
    writeFileSync(path.join(target, '.github/workflows/nimi-app-release.yml'), 'name: Original App workflow\n');
    const before = snapshotTree(target);
    for (const dryRun of [true, false]) {
      const result = runCli(['init', '--adopt', ...(dryRun ? ['--dry-run'] : []), '--json'], target, fakeNimicodingEnv(temp));
      assert.notEqual(result.status, 0);
      assert.match(jsonErrorMessage(result).replaceAll('\\', '/'), /Unknown adoption file collision: .github\/workflows\/nimi-app-release.yml/);
      assert.deepEqual(snapshotTree(target), before);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('adoption permits business session stores but rejects concrete Nimi session custody', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-business-session-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-packager-pnpm-vite' });
    const source = path.join(target, 'frontend/src/api/client.ts');
    mkdirSync(path.dirname(source), { recursive: true });
    writeFileSync(source, `let sessionStore: Storage = sessionStorage;\nexport function savePin(pin: string) { sessionStore.setItem('ov_pin', pin); }\n`);
    const env = fakeNimicodingEnv(temp);
    const before = snapshotTree(target);
    let result = runCli(['init', '--adopt', '--dry-run', '--json'], target, env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(snapshotTree(target), before);
    writeFileSync(source, `const custodyKey = 'NIMI_RUNTIME_SESSION';\nsessionStore.setItem(custodyKey, session);\n`);
    result = runCli(['init', '--adopt', '--dry-run', '--json'], target, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /environment custody of protected material/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('adoption scans a manifest supplied only by the plan before any owner writes', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-adopt-new-source-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-packager-pnpm-vite' });
    const previousInput = rawAppInput(target);
    const input = JSON.parse(readFileSync(previousInput));
    input.manifest.metadata.summary = 'NIMI_RUNTIME_TOKEN';
    rmSync(previousInput);
    mkdirSync(path.join(target, '.nimi/local'), { recursive: true });
    writeFileSync(path.join(target, '.nimi/local/adopt-input.json'), JSON.stringify(input));
    const before = snapshotTree(target);
    for (const dryRun of [true, false]) {
      const result = runCli(['init', '--adopt', '--input', '.nimi/local/adopt-input.json', ...(dryRun ? ['--dry-run'] : []), '--json'], target, fakeNimicodingEnv(temp));
      assert.notEqual(result.status, 0);
      assert.match(jsonErrorMessage(result), /Forbidden App source patterns: nimi.app.yaml: environment custody of protected material/);
      assert.deepEqual(snapshotTree(target), before);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('shared skill directory ancestors are rejected without modifying the shared directory', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-output-boundary-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-packager-pnpm-vite' });
    const shared = path.join(temp, 'shared');
    mkdirSync(shared);
    writeFileSync(path.join(shared, 'keep.md'), 'Shared user instructions');
    symlinkSync(shared, path.join(target, '.agents'), 'junction');
    const before = snapshotTree(shared);
    const result = runCli(['sync', '--json'], target, fakeNimicodingEnv(temp));
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /output path collision: .agents/);
    assert.deepEqual(snapshotTree(shared), before);
    assert.equal(existsSync(path.join(target, '.nimi/methodology')), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('a stale installed nimi-coding is a zero-write failure while dry-run remains usable', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-owner-version-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-packager-pnpm-vite' });
    writeFileSync(path.join(target, 'node_modules/@nimiplatform/nimi-coding/package.json'), JSON.stringify({ name: '@nimiplatform/nimi-coding', version: '0.0.1' }));
    const before = snapshotTree(target);
    const env = fakeNimicodingEnv(temp);
    const preview = runCli(['sync', '--dry-run', '--json'], target, env);
    assert.equal(preview.status, 0, preview.stdout + preview.stderr);
    const apply = runCli(['sync', '--json'], target, env);
    assert.notEqual(apply.status, 0);
    assert.match(jsonErrorMessage(apply), /found 0.0.1/);
    assert.deepEqual(snapshotTree(target), before);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('sync executes the verified project package entry despite a different owner on PATH', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-owner-entry-'));
  try {
    const target = writeExistingSubmittedApp(temp, { buildProfileRef: 'electron-packager-pnpm-vite' });
    const result = runCli(['sync', '--json'], target, fakeNimicodingEnv(temp));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.nimicodingSync.executedVersion, versions.nimicodingVersion);
    assert.equal(payload.ownerSteps[0].command, 'nimicoding sync --apply --json');
    assert.match(payload.ownerSteps[0].executor, /project-local package bin.nimicoding/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('fresh upgrade plans every owner before mutation and recomputes derived versions', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-derived-upgrade-'));
  let relocated;
  try {
    const oldVersions = { ...versions, appToolsVersion: '^0.5.1', nimicodingVersion: '0.6.2' };
    const old = buildAppScaffoldSnapshot({ profile: 'standalone', versions: oldVersions, appId: 'upgrade.example', appTitle: 'Upgrade', packageName: 'upgrade-example', targetDir: temp, features: [] });
    for (const file of old.createFiles) {
      const fullPath = path.join(temp, file.path); mkdirSync(path.dirname(fullPath), { recursive: true }); writeFileSync(fullPath, file.content);
    }
    let ownerCalls = 0;
    const runners = { runNimicodingSync(target, mode) {
      if (mode === 'apply') {
        ownerCalls += 1;
        mkdirSync(path.join(target, '.nimi/methodology'), { recursive: true });
        writeFileSync(path.join(target, '.nimi/methodology/authority-authoring.yaml'), 'test-owner: true\n');
        const agents = path.join(target, 'AGENTS.md');
        const text = readFileSync(agents, 'utf8');
        if (!text.includes('Owner projection preserved')) writeFileSync(agents, text + '\nOwner projection preserved\n');
      }
      return { ok: true };
    } };
    initApp(temp, {}, oldVersions, runners);
    const packagePath = path.join(temp, 'package.json');
    const packageSource = readFileSync(packagePath, 'utf8');
    for (const [field, value] of [['name', 'changed-package-name'], ['author', 'Changed Author']]) {
      writeFileSync(packagePath, `${JSON.stringify({ ...JSON.parse(packageSource), [field]: value }, null, 2)}\n`);
      const beforeIdentitySync = snapshotTree(temp);
      const beforeOwnerCalls = ownerCalls;
      for (const dryRun of [true, false]) {
        assert.throws(() => syncAppProject(temp, { dryRun }, versions, runners), /Managed scaffold drift detected: .nimi\/config\/app-identity.yaml/);
        assert.equal(ownerCalls, beforeOwnerCalls);
        assert.deepEqual(snapshotTree(temp), beforeIdentitySync);
      }
    }
    writeFileSync(packagePath, packageSource);
    const profilePath = path.join(temp, '.nimi/config/build-profile.yaml');
    const profile = readFileSync(profilePath, 'utf8');
    writeFileSync(profilePath, stringifyYaml({ ...parseYaml(profile), test_command: 'nimi-app test' }));
    const invalid = snapshotTree(temp);
    const previousCalls = ownerCalls;
    assert.throws(() => syncAppProject(temp, {}, versions, runners), /recursively invoke/);
    assert.equal(ownerCalls, previousCalls);
    assert.deepEqual(snapshotTree(temp), invalid);
    writeFileSync(profilePath, profile);
    const managedClient = path.join(temp, 'src/shell/auth/local-app-client.ts');
    writeFileSync(managedClient, 'import { obsolete } from "runtime/internal/private";\n');
    const product = path.join(temp, 'src/shell/routes/product-area.tsx');
    writeFileSync(product, 'export const appOwnedEdit = true;\n');
    const before = snapshotTree(temp);
    const preview = syncAppProject(temp, { dryRun: true, json: true }, versions, runners);
    assert.deepEqual(snapshotTree(temp), before);
    assert.ok(preview.changes.some((file) => file.path === 'package.json'));
    syncAppProject(temp, {}, versions, runners);
    let next = JSON.parse(readFileSync(path.join(temp, SCAFFOLD_INTENT_PATH), 'utf8'));
    // An existing managed project keeps its supported combination; only the tool dependencies move.
    assert.equal(next.dependencyMatrix.npm['@nimiplatform/sdk'], oldVersions.sdkVersion);
    assert.equal(next.dependencyMatrix.npm['@nimiplatform/kit'], oldVersions.kitVersion);
    assert.equal(next.dependencyMatrix.npm['@nimiplatform/app-tools'], versions.appToolsVersion);
    assert.equal(JSON.parse(readFileSync(packagePath, 'utf8')).dependencies['@nimiplatform/sdk'], oldVersions.sdkVersion);
    assert.equal(next.dependencyMatrix.npm['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(next.appId, 'upgrade.example');
    assert.deepEqual(next.directFeatures, []);
    assert.equal(readFileSync(product, 'utf8'), 'export const appOwnedEdit = true;\n');
    assert.match(readFileSync(path.join(temp, 'AGENTS.md'), 'utf8'), /Owner projection preserved/);
    assert.doesNotMatch(readFileSync(managedClient, 'utf8'), /runtime\/internal/);
    assert.equal(next.appIdentity.targetDir, null);
    relocated = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-relocated-'));
    cpSync(temp, relocated, { recursive: true });
    assert.deepEqual(syncAppProject(relocated, { dryRun: true, json: true }, versions, runners).changes, []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
    if (relocated) rmSync(relocated, { recursive: true, force: true });
  }
});

test('sync closes the former unknown-command path and only normalizes submitted App platform wiring', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-project-sync-'));
  const target = writeExistingSubmittedApp(tempRoot);
  const env = fakeNimicodingEnv(tempRoot);
  const productBefore = readFileSync(path.join(target, 'src', 'product', 'owned.ts'));
  try {
    const result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, 'sync');
    assert.equal(payload.managed, false);
    assert.deepEqual(payload.synchronizedFiles, [
      'package.json',
      'src-tauri/Cargo.toml',
      'src-tauri/tauri.conf.json',
      'vite.config.ts',
      'src/styles.css',
      '.nimi/config/app-identity.yaml',
      '.nimi/admission/submission.yaml',
      '.github/workflows/nimi-app-release.yml',
      'pnpm-workspace.yaml',
      'AGENTS.md',
      ...lifecycleSkillFiles().map((file) => file.path),
    ]);
    assert.deepEqual(payload.nextSteps, [
      'pnpm install',
      `cargo update -p nimi-shell-tauri --precise ${versions.nimiShellTauriVersion}`,
      'nimi-app sync',
      'nimi-app check',
    ]);

    const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    assert.equal(packageJson.packageManager, versions.packageManager);
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], versions.kitVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], versions.appToolsVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/nimi-coding'], versions.nimicodingVersion);
    assert.equal(Object.hasOwn(packageJson.devDependencies, '@nimiplatform/kit-protected-local-win32-x64'), false);
    assert.equal(packageJson.scripts.check, 'node scripts/product-check.mjs');
    assert.equal(packageJson.scripts.dev, 'nimi-app dev --shell electron');
    assert.equal(packageJson.scripts['dev:shell'], 'nimi-app dev');
    assert.equal(packageJson.scripts['dev:electron'], 'nimi-app dev --shell electron');
    assert.equal(Object.hasOwn(packageJson.scripts, 'doctor'), false);
    assert.equal(packageJson.scripts.pack, 'nimi-app pack');
    assert.equal(Object.hasOwn(packageJson.scripts, 'publish'), false);
    const managedReleaseWorkflow = readFileSync(
      path.join(target, '.github', 'workflows', 'nimi-app-release.yml'),
      'utf8',
    );
    assert.match(managedReleaseWorkflow, /name: nimi-app-release/u);
    assert.match(managedReleaseWorkflow, /Require tagged commit on canonical default branch/u);
    assert.match(managedReleaseWorkflow, /git merge-base --is-ancestor/u);
    assert.doesNotMatch(readFileSync(path.join(target, 'vite.config.ts'), 'utf8'), /nimiRepoRoot|nimiSdkSourceRoot|@nimiplatform\\\/sdk/u);
    assert.match(readFileSync(path.join(target, 'src', 'styles.css'), 'utf8'), /node_modules\/@nimiplatform\/kit/u);
    const workspace = parseYaml(readFileSync(path.join(target, 'pnpm-workspace.yaml'), 'utf8'));
    assert.deepEqual(workspace.packages, ['.']);
    assert.deepEqual(workspace.overrides, { 'unrelated-package': '1.2.3' });
    assert.deepEqual(workspace.allowBuilds, { esbuild: true });

    const cargo = readFileSync(path.join(target, 'src-tauri', 'Cargo.toml'), 'utf8');
    assert.match(cargo, new RegExp(`^nimi-shell-tauri = "${versions.nimiShellTauriVersion.replaceAll('.', '\\.')}"$`, 'm'));
    assert.doesNotMatch(cargo, /\bpath\s*=/u);
    const tauri = JSON.parse(readFileSync(path.join(target, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    assert.equal(tauri.identifier, 'ai.nimi.apps.focused.existing');
    assert.deepEqual(readFileSync(path.join(target, 'src', 'product', 'owned.ts')), productBefore);
    assert.deepEqual(parseYaml(readFileSync(path.join(target, '.nimi', 'methodology', 'authority-authoring.yaml'), 'utf8')), { source: 'focused-lifecycle-test' });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Electron lifecycle sync and check do not require or rewrite optional Tauri source and Cargo state', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-project-electron-lifecycle-'));
  const target = writeExistingSubmittedApp(tempRoot, {
    buildProfileRef: 'electron-packager-pnpm-vite',
  });
  const env = fakeNimicodingEnv(tempRoot);
  rmSync(path.join(target, 'src-tauri'), { recursive: true, force: true });
  try {
    let result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    const synced = JSON.parse(result.stdout);
    assert.equal(synced.managed, false);
    assert.equal(synced.synchronizedFiles.some((entry) => entry.startsWith('src-tauri/')), false);
    assert.deepEqual(synced.nextSteps, ['pnpm install', 'nimi-app sync', 'nimi-app check']);
    assert.equal(existsSync(path.join(target, 'src-tauri')), false);

    const identity = parseYaml(readFileSync(path.join(target, '.nimi', 'config', 'app-identity.yaml'), 'utf8'));
    const submission = parseYaml(readFileSync(path.join(target, '.nimi', 'admission', 'submission.yaml'), 'utf8'));
    assert.equal(identity.cargo_package_name, 'focused-existing-app-shell');
    assert.equal(identity.tauri_identifier, 'ai.nimi.apps.focused.existing');
    assert.equal(submission.cargo_package_name, identity.cargo_package_name);
    assert.equal(submission.tauri_identifier, identity.tauri_identifier);

    writePublicRegistryLock(target);
    result = runCli(['check', '--dir', target, '--production', '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).production, true);
    assert.equal(existsSync(path.join(target, 'src-tauri')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('check is read-only and rejects non-registry Nimi dependencies until sync normalizes them', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-project-check-'));
  const target = writeExistingSubmittedApp(tempRoot, { packageManager: versions.packageManager });
  const env = fakeNimicodingEnv(tempRoot);
  try {
    let result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /Nimi dependency must use a public registry version/);

    result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /pnpm-lock\.yaml retains a local Nimi resolution/);
    assert.match(jsonErrorMessage(result), /Run pnpm install, then rerun nimi-app sync and nimi-app check/);

    writePublicRegistryLock(target);
    const before = snapshotTree(target);
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, 'check');
    assert.equal(payload.production, false);
    assert.equal(payload.managed, false);
    assert.deepEqual(snapshotTree(target), before);

    result = runCli(['check', '--dir', target, '--production', '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    const productionPayload = JSON.parse(result.stdout);
    assert.equal(productionPayload.command, 'check');
    assert.equal(productionPayload.production, true);
    assert.deepEqual(snapshotTree(target), before);

    const parallelWorkflow = path.join(target, '.github', 'workflows', 'release.yml');
    writeFileSync(parallelWorkflow, 'jobs:\n  release:\n    steps:\n      - run: gh release create v0.1.0\n');
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /Parallel App production workflow is forbidden/u);
    rmSync(parallelWorkflow);

    writeFileSync(path.join(target, 'scripts', 'pack.mjs'), 'throw new Error("parallel pack");\n');
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /App-local scripts\/pack\.mjs is forbidden/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('check fails closed on the retired scaffold lock without changing the App', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-project-legacy-lock-'));
  const target = writeExistingSubmittedApp(tempRoot);
  const env = fakeNimicodingEnv(tempRoot);
  mkdirSync(path.join(target, '.nimi'), { recursive: true });
  writeFileSync(path.join(target, '.nimi', 'scaffold.lock.json'), '{}\n');
  const before = snapshotTree(target);
  try {
    const result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /Unsupported legacy scaffold lock/);
    assert.deepEqual(snapshotTree(target), before);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI exposes exactly the eight-command family and hard-cuts unavailable commands', () => {
  const help = runCli(['--help'], testDir, process.env);
  assert.equal(help.status, 0, help.stderr);
  const commands = [...help.stdout.matchAll(/^  nimi-app ([a-z]+)\b/gmu)].map((match) => match[1]);
  assert.deepEqual(commands, ['create', 'init', 'sync', 'check', 'dev', 'test', 'build', 'pack']);
  for (const retired of ['doctor', 'update', 'publish']) {
    const result = runCli([retired], testDir, process.env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`Unknown command: ${retired}`, 'u'));
  }
});

test('test and build dispatch only the App-declared owner commands', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-owner-command-'));
  const target = writeExistingSubmittedApp(tempRoot);
  try {
    const testResult = runCli(['test', '--dir', target, '--json'], tempRoot, process.env);
    assert.equal(testResult.status, 0, testResult.stderr);
    const testPayload = JSON.parse(testResult.stdout);
    assert.equal(testPayload.command, 'test');
    assert.match(testPayload.stdout, /owner test ran/u);

    const missing = runCli(['build', '--dir', target, '--target', 'windows-x86_64', '--json'], tempRoot, process.env);
    assert.notEqual(missing.status, 0);
    assert.match(jsonErrorMessage(missing), /Build payload is missing/);
    mkdirSync(path.join(target, 'build/windows'), { recursive: true });
    writeFileSync(path.join(target, 'build/windows/focused-existing.exe'), 'declared owner output');
    const buildResult = runCli(['build', '--dir', target, '--target', 'windows-x86_64', '--json'], tempRoot, process.env);
    assert.equal(buildResult.status, 0, buildResult.stderr);
    const buildPayload = JSON.parse(buildResult.stdout);
    assert.equal(buildPayload.command, 'build');
    assert.equal(buildPayload.target, 'windows-x86_64');
    assert.match(buildPayload.stdout, /owner build ran/u);

    rmSync(path.join(target, 'build/windows'), { recursive: true });
    const productionResult = runCli(['build', '--dir', target, '--target', 'windows-x86_64', '--production', '--json'], tempRoot, process.env);
    assert.notEqual(productionResult.status, 0);
    assert.match(jsonErrorMessage(productionResult), /Build payload is missing or noncanonical/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('production build validates the exact Runtime entry without signing or certificate credentials', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-owner-production-target-'));
  const target = writeExistingSubmittedApp(tempRoot, {
    buildProfileRef: 'electron-packager-pnpm-vite',
  });
  mkdirSync(path.join(target, 'build', 'windows'), { recursive: true });
  const runtimeEntry = path.join(target, 'build', 'windows', 'focused-existing.exe');
  const publisherOutput = Buffer.from('publisher-owned production target');
  writeFileSync(runtimeEntry, publisherOutput);
  const env = { ...process.env };
  delete env.WINDOWS_CERTIFICATE_BASE64;
  delete env.WINDOWS_CERTIFICATE_PASSWORD;
  try {
    const result = runCli([
      'build', '--dir', target, '--target', 'windows-x86_64', '--production', '--json',
    ], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, 'build');
    assert.equal(payload.target, 'windows-x86_64');
    assert.match(payload.stdout, /owner build ran/u);
    assert.deepEqual(readFileSync(runtimeEntry), publisherOutput);

    rmSync(runtimeEntry);
    writeFileSync(path.join(target, 'build', 'windows', 'different.exe'), publisherOutput);
    const missingExactEntry = runCli([
      'build', '--dir', target, '--target', 'windows-x86_64', '--production', '--json',
    ], tempRoot, env);
    assert.notEqual(missingExactEntry.status, 0);
    assert.match(jsonErrorMessage(missingExactEntry), /Build Runtime entry is missing or noncanonical/u);

    const signingOwnerSources = [
      readFileSync(path.join(appToolsRoot, 'lib', 'app-project-lifecycle.mjs'), 'utf8'),
      readFileSync(path.join(appToolsRoot, 'lib', 'index.mjs'), 'utf8'),
      readFileSync(path.join(appToolsRoot, 'lib', 'windows-powershell.mjs'), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(signingOwnerSources, /WINDOWS_CERTIFICATE_BASE64|WINDOWS_CERTIFICATE_PASSWORD|NIMI_APP_SIGN_TARGET|Import-PfxCertificate|signtool(?:\.exe)?|signWindowsTarget/iu);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('lifecycle commands reject unknown build profile refs before dispatching an owner command', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-owner-profile-ref-'));
  const target = writeExistingSubmittedApp(tempRoot, { buildProfileRef: 'unknown-packager' });
  try {
    const result = runCli(['build', '--dir', target, '--target', 'windows-x86_64', '--json'], tempRoot, process.env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /build_profile_ref is unsupported: unknown-packager/u);
    assert.doesNotMatch(result.stdout, /owner build ran/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Windows executable observer reads the exact embedded asInvoker profile and signature facts', {
  skip: process.platform !== 'win32' || process.arch !== 'x64',
}, () => {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
  assert.ok(windowsRoot, 'Windows root is unavailable');
  const executablePath = path.join(windowsRoot, 'System32', 'cmd.exe');
  const observed = observeWindowsExecutableFacts(executablePath);
  assert.deepEqual(observed.execution_profile, {
    requested_execution_level: 'asInvoker',
    ui_access: false,
  });
  assert.equal(observed.authenticode.status, 'Valid');
  assert.equal(observed.authenticode.signature_type, 'Catalog');
  assert.equal(typeof observed.authenticode.certificate_subject, 'string');
  assert.ok(observed.authenticode.certificate_subject.length > 0);
});

test('Windows executable observer rejects an elevation-capable embedded manifest', {
  skip: process.platform !== 'win32' || process.arch !== 'x64',
}, () => {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
  assert.ok(windowsRoot, 'Windows root is unavailable');
  assert.throws(
    () => observeWindowsExecutableFacts(path.join(windowsRoot, 'regedit.exe')),
    /requestedExecutionLevel=asInvoker and uiAccess=false/u,
  );
});

// Low-cost declaration check: adding only `safety_profile` to nimi.app.yaml must
// leave business code, the dependency combination, the owner commands and the
// dev/test/build/check steps unchanged, with every other copy generated by sync.
test('an existing App on a supported SDK/Kit combination keeps it through sync and check while tool dependencies follow the tool', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-existing-combination-'));
  const target = writeExistingSubmittedApp(tempRoot, { buildProfileRef: 'electron-packager-pnpm-vite', packageManager: versions.packageManager });
  const env = fakeNimicodingEnv(tempRoot);
  rmSync(path.join(target, 'src-tauri'), { recursive: true, force: true });
  const packagePath = path.join(target, 'package.json');
  const shipped = JSON.parse(readFileSync(packagePath, 'utf8'));
  // An App has explicitly selected the current Host contract; tool dependencies are older.
  shipped.dependencies['@nimiplatform/sdk'] = versions.sdkVersion;
  shipped.dependencies['@nimiplatform/kit'] = versions.kitVersion;
  shipped.devDependencies['@nimiplatform/app-tools'] = '^0.5.1';
  shipped.devDependencies['@nimiplatform/nimi-coding'] = '0.6.2';
  delete shipped.devDependencies['@nimiplatform/kit-protected-local-win32-x64'];
  writeFileSync(packagePath, `${JSON.stringify(shipped, null, 2)}\n`);
  rmSync(path.join(target, 'pnpm-workspace.yaml'));
  try {
    let result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    let payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.dependencyCombination, { sdk: versions.sdkVersion, kit: versions.kitVersion, source: 'default' });
    const synced = JSON.parse(readFileSync(packagePath, 'utf8'));
    assert.equal(synced.dependencies['@nimiplatform/sdk'], versions.sdkVersion, 'business SDK dependency is preserved');
    assert.equal(synced.dependencies['@nimiplatform/kit'], versions.kitVersion, 'business Kit dependency is preserved');
    assert.equal(synced.devDependencies['@nimiplatform/app-tools'], versions.appToolsVersion, 'tool dependency follows the tool');
    assert.equal(synced.devDependencies['@nimiplatform/nimi-coding'], versions.nimicodingVersion);

    // Lock check uses the same combination judgment.
    writeFileSync(path.join(target, 'pnpm-lock.yaml'), stringifyYaml({
      lockfileVersion: '9.0',
      importers: { '.': {
        dependencies: { '@nimiplatform/kit': { specifier: versions.kitVersion, version: versions.kitVersion.slice(1) }, '@nimiplatform/sdk': { specifier: versions.sdkVersion, version: versions.sdkVersion.slice(1) } },
        devDependencies: { '@nimiplatform/app-tools': { specifier: versions.appToolsVersion, version: versions.appToolsVersion }, '@nimiplatform/nimi-coding': { specifier: versions.nimicodingVersion, version: versions.nimicodingVersion } },
      } },
    }));
    result = runCli(['check', '--dir', target, '--production', '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.dependencyCombination, { sdk: versions.sdkVersion, kit: versions.kitVersion, source: 'default' });
    assert.equal(payload.safetyProfile, 'undeclared');

    // Only the declaration changes: no business file, dependency or owner command moves.
    const productBefore = readFileSync(path.join(target, 'src', 'product', 'owned.ts'));
    const packageBefore = readFileSync(packagePath, 'utf8');
    const buildProfileBefore = readFileSync(path.join(target, '.nimi', 'config', 'build-profile.yaml'), 'utf8');
    const manifestPath = path.join(target, 'nimi.app.yaml');
    writeFileSync(manifestPath, `${readFileSync(manifestPath, 'utf8')}${[
      'safety_profile:',
      '  intended_audience: general',
      '  content_descriptors: []',
      '  ai:',
      '    direct_interaction: true',
      '    interaction_notice: absent',
      '    risk_features: []',
      '    subject_notice: not-applicable',
      '    outputs:',
      '      - modality: text',
      '        exposure: exportable',
      '        publication_control: not-applicable',
      '        in_product_notice: absent',
      '        export_visible_marking: absent',
      '        machine_readable_marking: absent',
      '  data_practices:',
      '    publisher_direct_external_network: false',
      '    telemetry: []',
      '    third_party_account: none',
      '    user_content_sharing: none',
      '    commercial_features: []',
      '    sensitive_data_categories: []',
      '  high_impact_decision_uses: []',
      '',
    ].join('\n')}`);
    // Stale submission copy is detected until sync projects the declaration.
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /submission\.yaml safety_profile must match the nimi\.app\.yaml declaration; run nimi-app sync/u);
    result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.synchronizedFiles, ['.nimi/admission/submission.yaml'], 'only the generated submission copy changes');
    assert.deepEqual(payload.dependencyCombination, { sdk: versions.sdkVersion, kit: versions.kitVersion, source: 'default' });
    assert.equal(readFileSync(packagePath, 'utf8'), packageBefore);
    assert.deepEqual(readFileSync(path.join(target, 'src', 'product', 'owned.ts')), productBefore);
    assert.equal(readFileSync(path.join(target, '.nimi', 'config', 'build-profile.yaml'), 'utf8'), buildProfileBefore);
    const submission = parseYaml(readFileSync(path.join(target, '.nimi', 'admission', 'submission.yaml'), 'utf8'));
    assert.equal(submission.safety_profile.intended_audience, 'general');
    assert.deepEqual(submission.safety_profile.ai.outputs[0].modality, 'text');
    result = runCli(['check', '--dir', target, '--production', '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    payload = JSON.parse(result.stdout);
    assert.equal(payload.safetyProfile, 'declared');
    assert.deepEqual(payload.nextSteps, undefined);

    // A hand-edited submission copy is not a second author source.
    const submissionPath = path.join(target, '.nimi', 'admission', 'submission.yaml');
    writeFileSync(submissionPath, readFileSync(submissionPath, 'utf8').replace('intended_audience: general', 'intended_audience: adult'));
    result = runCli(['check', '--dir', target, '--json'], tempRoot, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /submission\.yaml safety_profile must match the nimi\.app\.yaml declaration/u);
    result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(submissionPath, 'utf8'), /intended_audience: general/u);

    // An invalid declaration names its field; the App remains editable.
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace('third_party_account: none', 'third_party_account: sometimes'));
    result = runCli(['sync', '--dir', target, '--json'], tempRoot, env);
    assert.notEqual(result.status, 0);
    assert.match(jsonErrorMessage(result), /nimi\.app\.yaml safety_profile\.data_practices\.third_party_account must be one of none, optional, required/u);

    // An unlisted SDK x Kit pairing is rejected everywhere, not normalized.
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace('third_party_account: sometimes', 'third_party_account: none'));
    const crossed = JSON.parse(readFileSync(packagePath, 'utf8'));
    crossed.dependencies['@nimiplatform/sdk'] = '^0.11.0';
    writeFileSync(packagePath, `${JSON.stringify(crossed, null, 2)}\n`);
    for (const command of [['sync'], ['check'], ['check', '--production']]) {
      result = runCli([...command, '--dir', target, '--json'], tempRoot, env);
      assert.notEqual(result.status, 0, command.join(' '));
      assert.match(jsonErrorMessage(result), /Unsupported SDK\/Kit combination: @nimiplatform\/sdk@\^0\.11\.0 with @nimiplatform\/kit@/u);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('an older Tauri combination is rejected before changing Host or Cargo inputs', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-old-tauri-combination-'));
  const target = writeExistingSubmittedApp(tempRoot, { packageManager: versions.packageManager });
  const env = fakeNimicodingEnv(tempRoot);
  const packagePath = path.join(target, 'package.json');
  const old = JSON.parse(readFileSync(packagePath, 'utf8'));
  old.dependencies['@nimiplatform/sdk'] = '^0.13.0';
  old.dependencies['@nimiplatform/kit'] = '^0.9.0';
  writeFileSync(packagePath, `${JSON.stringify(old, null, 2)}\n`);
  try {
    const before = snapshotTree(target);
    for (const command of [['sync', '--dry-run'], ['sync'], ['check']]) {
      const result = runCli([...command, '--dir', target, '--json'], tempRoot, env);
      assert.notEqual(result.status, 0, command.join(' '));
      assert.match(jsonErrorMessage(result), /Required combination:/u);
      assert.deepEqual(snapshotTree(target), before, 'unsupported pair must not rewrite files');
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('an old managed scaffold requires explicit dependency selection before sync or owner mutation', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-managed-combination-'));
  try {
    const oldVersions = { ...versions, sdkVersion: '^0.12.0', kitVersion: '^0.8.0', appToolsVersion: '^0.5.3', nimicodingVersion: '0.6.3', nimiShellTauriVersion: '0.4.0' };
    const old = buildAppScaffoldSnapshot({ profile: 'standalone', versions: oldVersions, appId: 'retain.example', appTitle: 'Retain', packageName: 'retain-example', targetDir: temp, features: [] });
    for (const file of old.createFiles) {
      const fullPath = path.join(temp, file.path); mkdirSync(path.dirname(fullPath), { recursive: true }); writeFileSync(fullPath, file.content);
    }
    let ownerCalls = 0;
    const runners = { runNimicodingSync(target, mode) {
      ownerCalls += 1;
      if (mode === 'apply') {
        mkdirSync(path.join(target, '.nimi/methodology'), { recursive: true });
        writeFileSync(path.join(target, '.nimi/methodology/authority-authoring.yaml'), 'test-owner: true\n');
      }
      return { ok: true };
    } };
    initApp(temp, {}, oldVersions, runners);
    const packagePath = path.join(temp, 'package.json');
    const before = snapshotTree(temp);
    const beforeOwnerCalls = ownerCalls;
    for (const operation of [
      () => syncAppProject(temp, { dryRun: true, json: true }, versions, runners),
      () => syncAppProject(temp, { json: true }, versions, runners),
      () => checkAppProject(temp, { json: true }, versions, runners),
    ]) {
      assert.throws(operation, /Required combination:/u);
      assert.equal(ownerCalls, beforeOwnerCalls, 'no owner command before a valid selection');
      assert.deepEqual(snapshotTree(temp), before, 'no partial new Host glue or package rewrite');
    }
    const selected = JSON.parse(readFileSync(packagePath, 'utf8'));
    selected.dependencies['@nimiplatform/sdk'] = versions.sdkVersion;
    selected.dependencies['@nimiplatform/kit'] = versions.kitVersion;
    writeFileSync(packagePath, `${JSON.stringify(selected, null, 2)}\n`);
    const synced = syncAppProject(temp, { json: true }, versions, runners);
    assert.deepEqual(synced.dependencyCombination, { sdk: versions.sdkVersion, kit: versions.kitVersion, source: 'default' });
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], versions.kitVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], versions.appToolsVersion, 'tool dependency follows the tool');
    const lock = JSON.parse(readFileSync(path.join(temp, SCAFFOLD_LOCK_PATH), 'utf8'));
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/kit'], versions.kitVersion);
    assert.equal(lock.dependencyMatrix.cargo['nimi-shell-tauri'], versions.nimiShellTauriVersion, 'the shell crate matches the selected combination');
    writeFileSync(path.join(temp, 'pnpm-lock.yaml'), stringifyYaml({ lockfileVersion: '9.0', importers: { '.': {
      dependencies: { '@nimiplatform/kit': { specifier: versions.kitVersion, version: versions.kitVersion.slice(1) }, '@nimiplatform/sdk': { specifier: versions.sdkVersion, version: versions.sdkVersion.slice(1) } },
      devDependencies: { '@nimiplatform/app-tools': { specifier: versions.appToolsVersion, version: versions.appToolsVersion }, '@nimiplatform/nimi-coding': { specifier: versions.nimicodingVersion, version: versions.nimicodingVersion } },
    } } }));
    const checked = checkAppProject(temp, { json: true }, versions, runners);
    assert.equal(checked.managed, true);
    assert.deepEqual(checked.dependencyCombination, { sdk: versions.sdkVersion, kit: versions.kitVersion, source: 'default' });
    assert.deepEqual(syncAppProject(temp, { dryRun: true, json: true }, versions, runners).changes, [], 'the explicitly selected combination is stable across repeated sync');

    const crossed = JSON.parse(readFileSync(packagePath, 'utf8'));
    crossed.dependencies['@nimiplatform/kit'] = '^0.12.0';
    writeFileSync(packagePath, `${JSON.stringify(crossed, null, 2)}\n`);
    assert.throws(() => syncAppProject(temp, { dryRun: true, json: true }, versions, runners), /Unsupported SDK\/Kit combination/u);
    assert.throws(() => checkAppProject(temp, { json: true }, versions, runners), /Unsupported SDK\/Kit combination/u);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
