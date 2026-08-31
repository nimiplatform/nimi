import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

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
  mkdirSync(path.join(target, 'src', 'product'), { recursive: true });
  mkdirSync(path.join(target, 'src-tauri'), { recursive: true });
  mkdirSync(path.join(target, '.nimi', 'config'), { recursive: true });
  mkdirSync(path.join(target, 'scripts'), { recursive: true });
  const packageJson = {
    name: 'focused-existing-app',
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
  writeFileSync(path.join(target, 'nimi.app.yaml'), [
    'app_id: focused.existing',
    'display_name: Focused Existing',
    'version: 0.1.0',
    'profile: standalone',
    'manifest_role: submitted-input',
    'app_access: []',
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
    'build_profile_ref: focused-test',
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
    assert.equal(packageJson.scripts.publish, 'nimi-app publish');
    assert.equal(readFileSync(path.join(target, '.github', 'workflows', 'nimi-app-release.yml'), 'utf8').includes('name: nimi-app-release'), true);
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
    assert.equal(readFileSync(path.join(target, '.nimi', 'methodology', 'authority-authoring.yaml'), 'utf8'), 'source: focused-lifecycle-test\r\n'.replace('\r\n', os.EOL));
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
    assert.equal(payload.managed, false);
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

test('CLI exposes exactly the nine-command family and hard-cuts retired commands', () => {
  const help = runCli(['--help'], testDir, process.env);
  assert.equal(help.status, 0, help.stderr);
  const commands = [...help.stdout.matchAll(/^  nimi-app ([a-z]+)\b/gmu)].map((match) => match[1]);
  assert.deepEqual(commands, ['create', 'init', 'sync', 'check', 'dev', 'test', 'build', 'pack', 'publish']);
  for (const retired of ['doctor', 'update']) {
    const result = runCli([retired], testDir, process.env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`Unknown command: ${retired}`, 'u'));
  }
});

test('publish has no local artifact or Account-auth path while GitHub orchestration is absent', () => {
  let result = runCli(['publish', '--artifact', 'local.nimiapp'], testDir, process.env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option: --artifact/u);

  for (const args of [['publish'], ['publish', '--dry-run']]) {
    result = runCli(args, testDir, process.env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /github_publish_not_implemented/u);
  }
});

test('production preflight fails closed until the shared installed carrier exists', () => {
  const result = runCli(['check', '--production'], testDir, process.env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /installed_app_carrier_not_implemented/u);
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

    const buildResult = runCli(['build', '--dir', target, '--target', 'windows-x86_64', '--json'], tempRoot, process.env);
    assert.equal(buildResult.status, 0, buildResult.stderr);
    const buildPayload = JSON.parse(buildResult.stdout);
    assert.equal(buildPayload.command, 'build');
    assert.equal(buildPayload.target, 'windows-x86_64');
    assert.match(buildPayload.stdout, /owner build ran/u);

    const productionResult = runCli(['build', '--dir', target, '--target', 'windows-x86_64', '--production', '--json'], tempRoot, process.env);
    assert.notEqual(productionResult.status, 0);
    assert.match(jsonErrorMessage(productionResult), /Windows production signing target is missing/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
