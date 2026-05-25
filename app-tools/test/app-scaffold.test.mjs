import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAppScaffold } from '../lib/app-scaffold.mjs';
import { initApp } from '../lib/app-doctor-update.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const nimiAppBinPath = path.join(testDir, '..', 'bin', 'nimi-app.mjs');

const versions = {
  sdkVersion: '0.0.0-sdk',
  appToolsVersion: '0.0.0-app-tools',
  nimicodingVersion: '0.0.0-nimicoding',
  kitVersion: '0.0.0-kit',
  reactVersion: '19.0.0',
  reactDomVersion: '19.0.0',
  i18nextVersion: '25.0.0',
  reactI18nextVersion: '16.0.0',
  nodeTypesVersion: '24.0.0',
  reactTypesVersion: '19.0.0',
  reactDomTypesVersion: '19.0.0',
  threeTypesVersion: '0.184.0',
  viteVersion: '7.0.0',
  viteReactPluginVersion: '5.0.0',
  tailwindcssVersion: '4.0.0',
  tailwindcssViteVersion: '4.0.0',
  tauriApiVersion: '2.0.0',
  tauriCliVersion: '2.0.0-cli',
  nimiShellTauriVersion: '0.1.0',
  typescriptVersion: '5.0.0',
};

function createFileTree(baseDir, files) {
  for (const file of files) {
    const targetPath = path.join(baseDir, file.path);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content);
  }
}

function ensureDirEmptyOrMissing(targetDir) {
  try {
    const entries = readFileSync(targetDir, 'utf8');
    if (entries) throw new Error('target exists as file');
  } catch {
    // Directory emptiness is not under test here; each case uses a fresh temp root.
  }
}

function scaffold(profile) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-test-'));
  const target = path.join(tempRoot, profile);
  createAppScaffold({
    cwd: tempRoot,
    options: {
      dir: profile,
      profile,
      name: 'Tester App',
    },
    versions,
    createFileTree,
    ensureDirEmptyOrMissing: () => {},
    mkdirSync,
  });
  initApp(tempRoot, { dir: target }, versions, fakeNimicodingRunners());
  return {
    tempRoot,
    target,
    read(relativePath) {
      return readFileSync(path.join(target, relativePath), 'utf8');
    },
    readBytes(relativePath) {
      return readFileSync(path.join(target, relativePath));
    },
    cleanup() {
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

function fakeNimicodingRunners() {
  return {
    runNimicodingSync(targetDir, mode) {
      mkdirSync(path.join(targetDir, '.nimi', 'config'), { recursive: true });
      mkdirSync(path.join(targetDir, '.nimi', 'contracts'), { recursive: true });
      mkdirSync(path.join(targetDir, '.nimi', 'methodology'), { recursive: true });
      writeFileSync(path.join(targetDir, '.nimi', 'config', 'bootstrap.yaml'), 'source: fake-nimicoding-sync\n');
      writeFileSync(path.join(targetDir, '.nimi', 'contracts', 'result.schema.yaml'), 'source: fake-nimicoding-sync\n');
      writeFileSync(path.join(targetDir, '.nimi', 'methodology', 'core.yaml'), 'source: fake-nimicoding-sync\n');
      return {
        ok: true,
        mode,
        summary: {
          total: 3,
          created: mode === 'apply' ? 3 : 0,
        },
      };
    },
  };
}

function fakePnpmEnv(tempRoot) {
  const binDir = path.join(tempRoot, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  const fakePnpm = path.join(binDir, 'pnpm');
  writeFileSync(
    fakePnpm,
    [
      '#!/bin/sh',
      'if [ "$1" = "exec" ] && [ "$2" = "nimicoding" ] && [ "$3" = "sync" ]; then',
      '  mkdir -p .nimi/config .nimi/contracts .nimi/methodology',
      '  printf "source: fake-nimicoding-sync\\n" > .nimi/config/bootstrap.yaml',
      '  printf "source: fake-nimicoding-sync\\n" > .nimi/contracts/result.schema.yaml',
      '  printf "source: fake-nimicoding-sync\\n" > .nimi/methodology/core.yaml',
      '  printf "{\\"ok\\":true,\\"summary\\":{\\"total\\":3,\\"created\\":3}}\\n"',
      '  exit 0',
      'fi',
      'printf "unexpected fake pnpm command: %s\\n" "$*" >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(fakePnpm, 0o755);
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
  };
}

function cliScaffold(profile) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-cli-'));
  const target = path.join(tempRoot, profile);
  const env = fakePnpmEnv(tempRoot);
  const result = runNimiApp(['create', '--dir', target, '--profile', profile], tempRoot, { env });
  assert.equal(result.status, 0, result.stderr);
  const init = runNimiApp(['init', '--dir', target], tempRoot, { env });
  assert.equal(init.status, 0, init.stderr);
  return {
    tempRoot,
    target,
    env,
    read(relativePath) {
      return readFileSync(path.join(target, relativePath), 'utf8');
    },
    cleanup() {
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

function assertTauriIconSupport(generated) {
  const tauriConfig = JSON.parse(generated.read('src-tauri/tauri.conf.json'));
  assert.deepEqual(tauriConfig.bundle?.icon, ['icons/icon.png']);
  const icon = generated.readBytes('src-tauri/icons/icon.png');
  assert.equal(icon.length, 68);
  assert.deepEqual([...icon.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function devPortFromScript(script) {
  const match = script.match(/--port\s+(\d+)\s+--strictPort/);
  assert.ok(match, `dev renderer script must declare a strict port: ${script}`);
  return Number(match[1]);
}

function runNimiApp(args, cwd, options = {}) {
  const env = options.env || process.env;
  return spawnSync(process.execPath, [nimiAppBinPath, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  });
}

test('standalone scaffold generates industrial Nimi App Tauri profile', () => {
  const generated = scaffold('standalone');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    assert.equal(packageJson.private, false);
    assert.equal(packageJson.publishConfig.access, 'public');
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], versions.kitVersion);
    assert.equal(packageJson.dependencies.i18next, versions.i18nextVersion);
    assert.equal(packageJson.dependencies['react-i18next'], versions.reactI18nextVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], versions.appToolsVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/nimi-coding'], versions.nimicodingVersion);
    assert.equal(packageJson.devDependencies['@tailwindcss/vite'], versions.tailwindcssViteVersion);
    assert.equal(packageJson.devDependencies['@tauri-apps/cli'], versions.tauriCliVersion);
    assert.equal(packageJson.devDependencies['@types/three'], versions.threeTypesVersion);
    assert.equal(packageJson.devDependencies.tailwindcss, versions.tailwindcssVersion);
    assert.equal(packageJson.scripts.dev, 'pnpm run dev:renderer');
    assert.match(packageJson.scripts['dev:renderer'], /^vite --host 127\.0\.0\.1 --port \d+ --strictPort$/);
    const devPort = devPortFromScript(packageJson.scripts['dev:renderer']);
    assert.ok(devPort >= 1430 && devPort < 1530);
    assert.equal(packageJson.scripts['dev:shell'], 'node scripts/dev-shell.mjs');
    assert.equal(packageJson.scripts.init, 'nimi-app init');
    assert.equal(packageJson.scripts.typecheck, 'tsc --noEmit');
    assert.equal(packageJson.scripts.pack, 'pnpm run build && node scripts/pack.mjs');
    assert.equal(packageJson.scripts.doctor, 'nimi-app doctor');
    assert.equal(packageJson.scripts.update, 'nimi-app update');
    assert.equal(Object.hasOwn(packageJson, 'author'), false);
    const lock = JSON.parse(generated.read('.nimi/app-scaffold/lock.json'));
    assert.equal(lock.profile, 'standalone');
    assert.equal(lock.appId, 'tester-app');
    assert.equal(lock.managedFileTaxonomy.appOwnedProductCode[0], 'src/shell/routes/product-area.tsx');
    assert.equal(lock.managedFileHashes['src/shell/auth/auth-gate.tsx'].class, 'scaffold-managed glue');
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(lock.dependencyMatrix.npm['@tauri-apps/cli'], versions.tauriCliVersion);
    assert.equal(lock.dependencyMatrix.npm.tailwindcss, versions.tailwindcssVersion);
    assert.equal(lock.dependencyMatrix.npm['@tailwindcss/vite'], versions.tailwindcssViteVersion);
    assert.equal(lock.dependencyMatrix.npm['@types/three'], versions.threeTypesVersion);
    assert.match(generated.read('vite.config.ts'), /tailwindcss\(\)/);
    assert.match(generated.read('src-tauri/Cargo.toml'), /tauri = \{ version = "2", features = \[\] \}/);
    assert.match(generated.read('src-tauri/Cargo.toml'), /nimi-shell-tauri = "0\.1\.0"/);
    assert.equal(JSON.parse(generated.read('src-tauri/tauri.conf.json')).build.devUrl, `http://127.0.0.1:${devPort}`);
    assert.match(generated.read('src-tauri/src/main.rs'), /nimi_shell_tauri::nimi_shell_tauri_runtime_bridge_handler!\[\]/);
    assert.equal(generated.read('src-tauri/src/main.rs').includes(['runtime', 'bridge', 'plugin'].join('_')), false);
    assertTauriIconSupport(generated);
    assert.match(generated.read('src/shell/auth/runtime-platform.ts'), /createNimiAppRuntimePlatformClient/);
    assert.match(generated.read('src/shell/auth/runtime-platform.ts'), /mode: 'dev-standalone'/);
    assert.match(generated.read('src/shell/auth/runtime-platform.ts'), /runtimeAccountLoginEnabled = false/);
    assert.match(generated.read('src/shell/auth/runtime-login-page.tsx'), /DesktopShellAuthPage/);
    assert.match(generated.read('src/styles.css'), /@import "@nimiplatform\/kit\/auth\/styles\.css"/);
    assert.match(generated.read('src/styles.css'), /@import "tailwindcss"/);
    assert.match(generated.read('scripts/dev-shell.mjs'), /Runtime developer session ready/);
    assert.match(generated.read('nimi.app.yaml'), /manifest_role: submitted-input/);
    assert.match(generated.read('.nimi/admission/submission.yaml'), /submission_role: developer-submitted-input/);
    assert.match(generated.read('.nimi/admission/submission.yaml'), /init_command: pnpm run init/);
    assert.match(generated.read('.nimi/admission/submission.yaml'), /dev_shell_command: pnpm dev:shell/);
    assert.match(generated.read('.nimi/admission/submission.yaml'), /admission_truth: platform-owned-after-review/);
    const buildProfile = generated.read('.nimi/admission/build-profile.yaml');
    assert.match(buildProfile, /build_profile_ref: tauri-pnpm-vite/);
    assert.match(buildProfile, /init_command: pnpm run init/);
    assert.match(buildProfile, /lockfile_path: pnpm-lock\.yaml/);
    assert.match(buildProfile, /lockfile_policy: author-install-generates-lockfile/);
    assert.match(buildProfile, /ci_install_command: pnpm install --no-frozen-lockfile/);
    assert.equal(lock.semantics.lockfilePolicy, 'author-install-generates-lockfile');
    const ci = generated.read('.github/workflows/ci.yml');
    assert.match(ci, /pnpm install --no-frozen-lockfile/);
    assert.match(ci, /pnpm run init/);
    assert.doesNotMatch(ci, /cache: pnpm/);
    assert.match(generated.read('.gitignore'), /^dist\/$/m);
    assert.match(generated.read('.gitignore'), /^\.env\.\*\.local$/m);
    assert.match(generated.read('README.md'), /pre-submission self-checks only/);
    assert.match(generated.read('README.md'), /pnpm dev:shell/);
    assert.match(generated.read('ADMISSION.md'), /developer-submitted listing request/);
    const generatedShellSource = [
      generated.read('src/shell/auth/runtime-platform.ts'),
      generated.read('src/shell/auth/runtime-login-page.tsx'),
      generated.read('src/shell/auth/runtime-account-auth.ts'),
      generated.read('src/shell/routes/product-area.tsx'),
      generated.read('src/shell/routes/demo-surfaces.tsx'),
    ].join('\n');
    assert.doesNotMatch(generatedShellSource, /Replace this route with app product behavior/);
    assert.doesNotMatch(generatedShellSource, /Open product action/);
    assert.doesNotMatch(generatedShellSource, /Add app-owned surfaces/);
    assert.doesNotMatch(generatedShellSource, /from ['"]@renderer\//);
    assert.doesNotMatch(generatedShellSource, /from ['"]@runtime\//);
  } finally {
    generated.cleanup();
  }
});

test('default CLI standalone scaffold uses current public SDK version source', () => {
  const generated = cliScaffold('standalone');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    const lock = JSON.parse(generated.read('.nimi/app-scaffold/lock.json'));
    const appToolsPackageJson = JSON.parse(readFileSync(path.join(testDir, '..', 'package.json'), 'utf8'));
    const expectedAppToolsVersion = `^${appToolsPackageJson.version}`;
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], '^0.5.15');
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], expectedAppToolsVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/nimi-coding'], '0.2.5');
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/sdk'], '^0.5.15');
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/app-tools'], expectedAppToolsVersion);
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/nimi-coding'], '0.2.5');
  } finally {
    generated.cleanup();
  }
});

test('workspace-app scaffold uses workspace package and Cargo path dependencies', () => {
  const generated = scaffold('workspace-app');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], 'workspace:*');
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], 'workspace:*');
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], 'workspace:*');
    assert.equal(packageJson.devDependencies['@nimiplatform/nimi-coding'], 'workspace:*');
    assert.match(generated.read('src-tauri/Cargo.toml'), /nimi-shell-tauri = \{ path = "\.\.\/\.\.\/\.\.\/kit\/shell\/tauri" \}/);
    assert.match(generated.read('src-tauri/src/main.rs'), /invoke_handler\(nimi_shell_tauri::nimi_shell_tauri_runtime_bridge_handler!\[\]\)/);
    assert.equal(generated.read('src-tauri/src/main.rs').includes(['runtime', 'bridge', 'plugin'].join('_')), false);
    assertTauriIconSupport(generated);
    assert.match(generated.read('apps/tester-app/spec/app-slice.md'), /not public Nimi App admission/);
  } finally {
    generated.cleanup();
  }
});

test('retired app scaffold profiles are not accepted', () => {
  const retiredProfiles = ['basic', ['vercel', 'ai'].join('-')];
  for (const profile of retiredProfiles) {
    assert.throws(
      () => createAppScaffold({
        cwd: os.tmpdir(),
        options: { dir: `reject-${profile}`, profile },
        versions,
        createFileTree,
        ensureDirEmptyOrMissing: () => {},
        mkdirSync,
      }),
      /Unsupported app scaffold profile/,
    );
  }
});

test('retired create flag is rejected instead of acting as a profile alias', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-cli-test-'));
  try {
    const retiredFlag = `--${Buffer.from('dGVtcGxhdGU=', 'base64').toString('utf8')}`;
    const result = runNimiApp(['create', '--dir', path.join(tempRoot, 'app'), retiredFlag, 'standalone'], tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown option/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create accepts explicit app identity and records safe generated names', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-identity-'));
  const target = path.join(tempRoot, 'app');
  const env = fakePnpmEnv(tempRoot);
  try {
    const result = runNimiApp([
      'create',
      '--dir',
      target,
      '--profile',
      'standalone',
      '--app-id',
      'nimi.tester',
      '--title',
      'Nimi Tester',
      '--package-name',
      'nimiapp-tester',
    ], tempRoot, { env });
    assert.equal(result.status, 0, result.stderr);
    const init = runNimiApp(['init', '--dir', target], tempRoot, { env });
    assert.equal(init.status, 0, init.stderr);

    const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(path.join(target, '.nimi/app-scaffold/lock.json'), 'utf8'));
    const identity = JSON.parse(readFileSync(path.join(target, '.nimi/app-scaffold/intent.json'), 'utf8'));
    assert.equal(packageJson.name, 'nimiapp-tester');
    assert.equal(Object.hasOwn(packageJson, 'author'), false);
    assert.equal(lock.appId, 'nimi.tester');
    assert.equal(lock.appTitle, 'Nimi Tester');
    assert.equal(lock.packageName, 'nimiapp-tester');
    assert.equal(lock.packageAuthor, null);
    assert.equal(lock.cargoPackageName, 'nimiapp-tester-shell');
    assert.equal(lock.appIdentity.npmPackageName, 'nimiapp-tester');
    assert.equal(identity.appId, 'nimi.tester');
    assert.equal(identity.appTitle, 'Nimi Tester');
    assert.equal(identity.packageName, 'nimiapp-tester');
    assert.equal(identity.cargoPackageName, 'nimiapp-tester-shell');
    assert.equal(identity.tauriIdentifier, 'ai.nimi.apps.nimi.tester');
    assert.match(readFileSync(path.join(target, 'nimi.app.yaml'), 'utf8'), /app_id: nimi\.tester/);
    assert.match(readFileSync(path.join(target, 'src/shell/auth/runtime-platform.ts'), 'utf8'), /appId = 'nimi\.tester'/);
    assert.match(readFileSync(path.join(target, 'src/shell/auth/runtime-platform.ts'), 'utf8'), /runtimeAccountLoginEnabled = true/);
    assert.match(readFileSync(path.join(target, 'src/shell/routes/product-area.tsx'), 'utf8'), /TesterWorkbench/);
    assert.match(readFileSync(path.join(target, 'src/tester/tester-workbench.tsx'), 'utf8'), /Nimi App Runtime Tester/);
    assert.match(readFileSync(path.join(target, 'src/tester/tester-runtime.ts'), 'utf8'), /sdk-surface-missing/);
    assert.match(readFileSync(path.join(target, 'src/tester/world-tour/world-tour-shared.ts'), 'utf8'), /claim_world_tour_viewer_launch/);
    assert.match(readFileSync(path.join(target, 'src-tauri/src/main.rs'), 'utf8'), /tester_run_history_load/);
    assert.match(readFileSync(path.join(target, 'src-tauri/src/world_tour.rs'), 'utf8'), /open_world_tour_window/);
    assert.ok(lock.managedFileTaxonomy.appOwnedProductCode.includes('src/tester/tester-workbench.tsx'));
    assert.ok(lock.managedFileTaxonomy.appOwnedProductCode.includes('src-tauri/src/tester_storage.rs'));
    assert.ok(lock.managedFileTaxonomy.appOwnedProductCode.includes('test/tester-contract.test.mjs'));
    const testerSources = [
      'src/tester/tester-workbench.tsx',
      'src/tester/tester-runtime.ts',
      'src/tester/tester-ai-config.ts',
      'src/tester/world-tour/world-tour-viewer-route.tsx',
    ].map((relativePath) => readFileSync(path.join(target, relativePath), 'utf8')).join('\n');
    assert.doesNotMatch(testerSources, /from ['"]@renderer\//);
    assert.doesNotMatch(testerSources, /from ['"]@runtime\//);
    assert.doesNotMatch(testerSources, /getDesktopAIConfigService/);
    assert.doesNotMatch(testerSources, /runtime-config-profile-library/);
    assert.match(readFileSync(path.join(target, 'src/shell/auth/runtime-login-page.tsx'), 'utf8'), /DesktopShellAuthPage/);
    assert.match(readFileSync(path.join(target, 'src-tauri/Cargo.toml'), 'utf8'), /name = "nimiapp-tester-shell"/);
    assert.match(readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), /src\/tester\/\*\*/);

    const doctor = runNimiApp(['doctor', '--dir', target], tempRoot, { env });
    assert.equal(doctor.status, 0, doctor.stderr);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create accepts package author and scoped npm package metadata', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-metadata-'));
  const target = path.join(tempRoot, 'app');
  const env = fakePnpmEnv(tempRoot);
  try {
    const result = runNimiApp([
      'create',
      '--dir',
      target,
      '--profile',
      'standalone',
      '--app-id',
      'nimi.tester',
      '--title',
      'Nimi Tester',
      '--package-name',
      '@nimi/nimi-tester',
      '--author',
      'Nimi Maintainers',
    ], tempRoot, { env });
    assert.equal(result.status, 0, result.stderr);
    const init = runNimiApp(['init', '--dir', target], tempRoot, { env });
    assert.equal(init.status, 0, init.stderr);

    const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(path.join(target, '.nimi/app-scaffold/lock.json'), 'utf8'));
    const identity = JSON.parse(readFileSync(path.join(target, '.nimi/app-scaffold/intent.json'), 'utf8'));
    assert.equal(packageJson.name, '@nimi/nimi-tester');
    assert.equal(packageJson.author, 'Nimi Maintainers');
    assert.equal(lock.packageName, '@nimi/nimi-tester');
    assert.equal(lock.packageAuthor, 'Nimi Maintainers');
    assert.equal(lock.cargoPackageName, 'nimi-nimi-tester-shell');
    assert.equal(identity.packageAuthor, 'Nimi Maintainers');
    assert.match(readFileSync(path.join(target, 'src-tauri/Cargo.toml'), 'utf8'), /name = "nimi-nimi-tester-shell"/);

    const doctor = runNimiApp(['doctor', '--dir', target], tempRoot, { env });
    assert.equal(doctor.status, 0, doctor.stderr);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create rejects invalid npm package metadata', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-invalid-metadata-'));
  try {
    const result = runNimiApp([
      'create',
      '--dir',
      path.join(tempRoot, 'app'),
      '--profile',
      'standalone',
      '--package-name',
      'Invalid Package',
    ], tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid npm package name/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create may target an otherwise empty git root but still refuses other non-empty roots', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-git-root-'));
  try {
    const emptyGitRoot = path.join(tempRoot, 'empty-git-root');
    mkdirSync(path.join(emptyGitRoot, '.git'), { recursive: true });
    writeFileSync(path.join(emptyGitRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    let result = runNimiApp(['create', '--dir', emptyGitRoot, '--profile', 'standalone'], tempRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(emptyGitRoot, '.git', 'HEAD'), 'utf8'), 'ref: refs/heads/main\n');
    assert.ok(readFileSync(path.join(emptyGitRoot, 'package.json'), 'utf8'));

    const gitRootWithFile = path.join(tempRoot, 'git-root-with-file');
    mkdirSync(path.join(gitRootWithFile, '.git'), { recursive: true });
    writeFileSync(path.join(gitRootWithFile, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(path.join(gitRootWithFile, 'LICENSE'), 'existing license\n');
    result = runNimiApp(['create', '--dir', gitRootWithFile, '--profile', 'standalone'], tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to scaffold into non-empty directory/);
    assert.equal(readFileSync(path.join(gitRootWithFile, 'LICENSE'), 'utf8'), 'existing license\n');

    const ordinaryNonEmpty = path.join(tempRoot, 'ordinary-non-empty');
    mkdirSync(ordinaryNonEmpty, { recursive: true });
    writeFileSync(path.join(ordinaryNonEmpty, 'README.md'), 'existing readme\n');
    result = runNimiApp(['create', '--dir', ordinaryNonEmpty, '--profile', 'standalone'], tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to scaffold into non-empty directory/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('doctor fails closed on managed drift and update preserves app-owned product code', () => {
  const generated = cliScaffold('standalone');
  try {
    let result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(result.status, 0, result.stderr);

    const authGatePath = path.join(generated.target, 'src/shell/auth/auth-gate.tsx');
    writeFileSync(authGatePath, `${generated.read('src/shell/auth/auth-gate.tsx')}\n// drift\n`);
    result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Managed scaffold drift detected/);

    const productPath = path.join(generated.target, 'src/shell/routes/product-area.tsx');
    const productEdit = [
      "import { Surface } from '@nimiplatform/kit/ui';",
      '',
      'export function ProductArea() {',
      '  return <Surface className="product-area"><h1>Developer owned edit</h1></Surface>;',
      '}',
      '',
    ].join('\n');
    writeFileSync(productPath, productEdit);

    result = runNimiApp(['update', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(result.status, 0, result.stderr);
    result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(generated.read('src/shell/routes/product-area.tsx'), productEdit);
    assert.doesNotMatch(generated.read('src/shell/auth/auth-gate.tsx'), /\/\/ drift/);
  } finally {
    generated.cleanup();
  }
});

test('doctor fails closed on missing lock and stale generated anti-targets', () => {
  const generated = cliScaffold('standalone');
  try {
    rmSync(path.join(generated.target, '.nimi/app-scaffold/lock.json'), { force: true });
    let result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing initialized scaffold lock/);
  } finally {
    generated.cleanup();
  }

  const stale = cliScaffold('standalone');
  try {
    const staleFlag = ['--', 'template'].join('');
    writeFileSync(
      path.join(stale.target, 'src/shell/routes/product-area.tsx'),
      `export const stale = ${JSON.stringify(staleFlag)};\n`,
    );
    const result = runNimiApp(['doctor', '--dir', stale.target], stale.tempRoot, { env: stale.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Forbidden scaffold remnants detected/);
  } finally {
    stale.cleanup();
  }

  const stalePackages = cliScaffold('standalone');
  try {
    writeFileSync(
      path.join(stalePackages.target, 'src/shell/routes/product-area.tsx'),
      "import { Surface } from '@nimiplatform/nimi-kit/ui';\nexport const stale = Surface;\n",
    );
    const result = runNimiApp(['doctor', '--dir', stalePackages.target], stalePackages.tempRoot, { env: stalePackages.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retired kit package name/);
  } finally {
    stalePackages.cleanup();
  }

  const inconsistentLockfile = cliScaffold('standalone');
  try {
    const buildProfilePath = path.join(inconsistentLockfile.target, '.nimi/admission/build-profile.yaml');
    const ciPath = path.join(inconsistentLockfile.target, '.github/workflows/ci.yml');
    writeFileSync(
      buildProfilePath,
      inconsistentLockfile
        .read('.nimi/admission/build-profile.yaml')
        .replace('ci_install_command: pnpm install --no-frozen-lockfile', 'ci_install_command: pnpm install --frozen-lockfile'),
    );
    writeFileSync(
      ciPath,
      inconsistentLockfile.read('.github/workflows/ci.yml').replace('--no-frozen-lockfile', '--frozen-lockfile'),
    );
    const result = runNimiApp(['doctor', '--dir', inconsistentLockfile.target], inconsistentLockfile.tempRoot, { env: inconsistentLockfile.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Managed scaffold drift detected|CI install command does not match build profile|frozen lockfile install but lockfile is missing/);
  } finally {
    inconsistentLockfile.cleanup();
  }

  const cachedWithoutLockfile = cliScaffold('standalone');
  try {
    const ciPath = path.join(cachedWithoutLockfile.target, '.github/workflows/ci.yml');
    writeFileSync(
      ciPath,
      cachedWithoutLockfile
        .read('.github/workflows/ci.yml')
        .replace('          node-version: 22', '          node-version: 22\n          cache: pnpm'),
    );
    const result = runNimiApp(['doctor', '--dir', cachedWithoutLockfile.target], cachedWithoutLockfile.tempRoot, { env: cachedWithoutLockfile.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pnpm cache before lockfile exists/);
  } finally {
    cachedWithoutLockfile.cleanup();
  }
});

test('doctor fails closed on provider/model hardcoding forms', () => {
  const cases = [
    {
      label: 'missed claude model literal',
      source: "export const hardcodedModel = 'claude-3-5-sonnet';\n",
    },
    {
      label: 'missed gemini model literal',
      source: "export const hardcodedModel = 'gemini-2.5-pro';\n",
    },
    {
      label: 'missed openai provider literal',
      source: "export const hardcodedProvider = 'openai';\n",
    },
    {
      label: 'generic provider/model keyed literals',
      source: "export const route = { provider: 'anthropic', model: 'gpt-4o' };\n",
    },
    {
      label: 'slash-qualified provider/model literal',
      source: "export const route = 'openai/gpt-4o';\n",
    },
    {
      label: 'common provider family literals',
      source: [
        "export const providers = [",
        "  'mistral',",
        "  'llama',",
        "  'deepseek',",
        "  'qwen',",
        "  'cohere',",
        "  'groq',",
        "  'xai',",
        "  'grok',",
        "  'perplexity',",
        "  'ollama',",
        '];',
        '',
      ].join('\n'),
    },
    {
      label: 'legacy packet provider default literal',
      source: "export const route = 'gemini/default';\n",
    },
  ];

  for (const currentCase of cases) {
    const generated = cliScaffold('standalone');
    try {
      writeFileSync(path.join(generated.target, 'src/shell/routes/product-area.tsx'), currentCase.source);
      const result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0, currentCase.label);
      assert.match(result.stderr, /Forbidden scaffold remnants detected/, currentCase.label);
      assert.match(result.stderr, /provider\/model hardcoding/, currentCase.label);
    } finally {
      generated.cleanup();
    }
  }
});

test('update fails closed on unsupported locks and classification conflicts', () => {
  const unsupported = cliScaffold('standalone');
  try {
    const lockPath = path.join(unsupported.target, '.nimi/app-scaffold/lock.json');
    const lock = JSON.parse(unsupported.read('.nimi/app-scaffold/lock.json'));
    lock.scaffoldVersion = 'unsupported-version';
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const result = runNimiApp(['update', '--dir', unsupported.target], unsupported.tempRoot, { env: unsupported.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported scaffold version/);
  } finally {
    unsupported.cleanup();
  }

  const mixedProfile = cliScaffold('standalone');
  try {
    const lockPath = path.join(mixedProfile.target, '.nimi/app-scaffold/lock.json');
    const lock = JSON.parse(mixedProfile.read('.nimi/app-scaffold/lock.json'));
    lock.profile = 'unknown-profile';
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const result = runNimiApp(['update', '--dir', mixedProfile.target], mixedProfile.tempRoot, { env: mixedProfile.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported scaffold profile/);
  } finally {
    mixedProfile.cleanup();
  }

  const conflict = cliScaffold('standalone');
  try {
    const lockPath = path.join(conflict.target, '.nimi/app-scaffold/lock.json');
    const lock = JSON.parse(conflict.read('.nimi/app-scaffold/lock.json'));
    lock.managedFileHashes['src/shell/routes/product-area.tsx'] = {
      class: 'scaffold-managed glue',
      sha256: 'conflict',
    };
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const result = runNimiApp(['update', '--dir', conflict.target], conflict.tempRoot, { env: conflict.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Scaffold classification conflict/);
  } finally {
    conflict.cleanup();
  }
});

test('app scaffold generator does not use volatile time or random sources', () => {
  const source = readFileSync(path.join(testDir, '..', 'lib', 'app-scaffold.mjs'), 'utf8');
  for (const volatilePattern of [
    /\bnew\s+Date\s*\(/,
    /\bDate\.now\s*\(/,
    /\bgetUTCFullYear\s*\(/,
    /\bMath\.random\s*\(/,
    /\brandomUUID\s*\(/,
    /\bcrypto\.random/i,
  ]) {
    assert.doesNotMatch(source, volatilePattern);
  }
});

test('app scaffold code templates are package-shipped and kept out of generator source', () => {
  const packageJson = JSON.parse(readFileSync(path.join(testDir, '..', 'package.json'), 'utf8'));
  const source = readFileSync(path.join(testDir, '..', 'lib', 'app-scaffold.mjs'), 'utf8');
  const runtimeTemplate = readFileSync(
    path.join(testDir, '..', 'templates', 'app-scaffold', 'common', 'src', 'shell', 'auth', 'runtime-platform.ts.tmpl'),
    'utf8',
  );

  assert.ok(packageJson.files.includes('templates'));
  assert.ok(source.split('\n').length < 700);
  assert.doesNotMatch(source, /DesktopShellAuthPage/);
  assert.doesNotMatch(source, /Nimi App Runtime Tester/);
  assert.match(runtimeTemplate, /\{\{APP_ID\}\}/);
  assert.match(runtimeTemplate, /mode: 'dev-standalone'/);
});


test('generated scaffold mechanically excludes forbidden shortcuts', () => {
  const generated = scaffold('standalone');
  try {
    const joined = [
      'src/shell/auth/runtime-platform.ts',
      'src/shell/auth/auth-gate.tsx',
      'src/shell/routes/demo-surfaces.tsx',
      'README.md',
      'SECURITY.md',
      'nimi.app.yaml',
    ].map((relativePath) => generated.read(relativePath)).join('\n');

    for (const forbidden of [
      'createPlatformClient(',
      'createLocalFirstPartyRuntimePlatformClient',
      '/api/auth/login',
      '/api/auth/refresh',
      'sessionStore',
      'refreshTokenProvider',
      'raw JWT',
      ['kit', 'features', 'model-test'].join('/'),
      ['gemini', 'default'].join('/'),
      ['gpt', '-'].join(''),
    ]) {
      assert.equal(joined.includes(forbidden), false, `${forbidden} must not be generated`);
    }
  } finally {
    generated.cleanup();
  }
});
