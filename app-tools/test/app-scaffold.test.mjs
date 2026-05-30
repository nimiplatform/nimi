import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAppScaffold } from '../lib/app-scaffold.mjs';
import { initApp } from '../lib/app-doctor-update.mjs';
import { resolveAppSource } from '../scripts/sync-app-source.mjs';

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
  lucideReactVersion: '0.577.0',
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

const REFERENCE_IDENTITY_LITERALS = [
  'dev.nimi.tester',
  '@nimiplatform/tester',
  'ai.nimi.apps.nimi.tester',
  'nimiapp-tester-shell',
];

function createFileTree(baseDir, files) {
  for (const file of files) {
    const targetPath = path.join(baseDir, file.path);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content);
  }
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

function scaffold(profile, options = {}) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-test-'));
  const target = path.join(tempRoot, 'app');
  createAppScaffold({
    cwd: tempRoot,
    options: {
      dir: target,
      profile,
      appId: options.appId || 'acme.widget',
      title: options.title || 'Acme Widget',
      packageName: options.packageName || 'acme-widget',
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
    lock() {
      return JSON.parse(this.read('.nimi/app-scaffold/lock.json'));
    },
    cleanup() {
      rmSync(tempRoot, { recursive: true, force: true });
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

function cliScaffold(profile, extraArgs = []) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-cli-'));
  const target = path.join(tempRoot, 'app');
  const env = fakePnpmEnv(tempRoot);
  const result = runNimiApp(['create', '--dir', target, '--profile', profile, ...extraArgs], tempRoot, { env });
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

test('standalone scaffold forks the reference app with rewritten identity', () => {
  const generated = scaffold('standalone');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    assert.equal(packageJson.name, 'acme-widget');
    assert.equal(packageJson.private, false);
    assert.equal(packageJson.publishConfig.access, 'public');
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], versions.kitVersion);
    assert.equal(packageJson.dependencies['lucide-react'], versions.lucideReactVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], versions.appToolsVersion);
    assert.equal(packageJson.devDependencies['@types/three'], versions.threeTypesVersion);
    assert.match(packageJson.scripts['dev:renderer'], /^vite --host 127\.0\.0\.1 --port \d+ --strictPort$/);
    const devPort = devPortFromScript(packageJson.scripts['dev:renderer']);
    assert.ok(devPort >= 1430 && devPort < 1530);

    // Identity is rewritten everywhere; no reference-app identity leaks through.
    assert.match(generated.read('nimi.app.yaml'), /app_id: acme\.widget/);
    assert.match(generated.read('nimi.app.yaml'), /profile: standalone/);
    assert.match(generated.read('src/shell/auth/runtime-platform.ts'), /appId = 'acme\.widget'/);
    const tauri = JSON.parse(generated.read('src-tauri/tauri.conf.json'));
    assert.equal(tauri.identifier, 'ai.nimi.apps.acme.widget');
    assert.equal(tauri.productName, 'Acme Widget');
    assert.equal(tauri.build.devUrl, `http://127.0.0.1:${devPort}`);
    assert.match(generated.read('src-tauri/Cargo.toml'), /name = "acme-widget-shell"/);
    assert.match(generated.read('src-tauri/Cargo.toml'), /nimi-shell-tauri = "0\.1\.0"/);

    const identityScannedFiles = [
      'nimi.app.yaml',
      'src/shell/auth/runtime-platform.ts',
      'src-tauri/tauri.conf.json',
      'src-tauri/Cargo.toml',
      'src/tester/tester-runtime-invokers.ts',
    ];
    for (const relativePath of identityScannedFiles) {
      const content = generated.read(relativePath);
      for (const literal of REFERENCE_IDENTITY_LITERALS) {
        assert.equal(content.includes(literal), false, `${literal} must not survive in ${relativePath}`);
      }
    }

    // Reference-app product code is the baseline product surface for every app.
    assert.match(generated.read('src/shell/routes/product-area.tsx'), /TesterWorkbench/);
    assert.match(generated.read('src/tester/tester-runtime.ts'), /invokeTesterCapability/);

    // Taxonomy: tester product is app-owned; shell/auth + packaging glue is managed.
    const lock = generated.lock();
    const appOwned = lock.managedFileTaxonomy.appOwnedProductCode;
    assert.ok(appOwned.includes('src/shell/routes/product-area.tsx'));
    assert.ok(appOwned.includes('src/tester/tester-workbench.tsx'));
    assert.ok(appOwned.includes('src-tauri/src/tester_storage.rs'));
    assert.ok(appOwned.includes('test/tester-contract.test.mjs'));
    assert.equal(lock.managedFileHashes['src/shell/auth/auth-gate.tsx'].class, 'scaffold-managed glue');
    assert.equal(lock.managedFileHashes['package.json'].class, 'scaffold-managed glue');
    assert.equal(lock.managedFileHashes['.github/workflows/ci.yml'].class, 'scaffold-managed glue');
    assert.equal(Object.hasOwn(lock.managedFileHashes, 'src/tester/tester-workbench.tsx'), false);

    assertTauriIconSupport(generated);
    assert.match(generated.read('src/shell/auth/runtime-platform.ts'), /createNimiAppRuntimePlatformClient/);
    assert.match(generated.read('src/shell/auth/runtime-platform.ts'), /mode: 'local-first-party'/);
    assert.doesNotMatch(generated.read('src/shell/auth/runtime-platform.ts'), /dev-standalone/);
    assert.match(generated.read('nimi.app.yaml'), /manifest_role: submitted-input/);
    assert.match(generated.read('.nimi/admission/submission.yaml'), /submission_role: developer-submitted-input/);
    assert.match(generated.read('.nimi/admission/build-profile.yaml'), /lockfile_policy: author-install-generates-lockfile/);
    const ci = generated.read('.github/workflows/ci.yml');
    assert.match(ci, /pnpm install --no-frozen-lockfile/);
    assert.match(ci, /pnpm run init/);
    assert.doesNotMatch(ci, /cache: pnpm/);
  } finally {
    generated.cleanup();
  }
});

test('generated package.json scripts reference only commands and existing local scripts', () => {
  const generated = scaffold('standalone');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    // Single-login model: the app launches its Tauri shell directly and logs in
    // through the in-app AuthGate. There is no dev-standalone bootstrap script.
    assert.equal(packageJson.scripts['dev:shell'], 'tauri dev');
    // Any `node scripts/<file>` script must point at a file the scaffold actually
    // emits — a dangling reference (e.g. a deleted dev-shell.mjs) makes the
    // documented command fail on first run.
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      const match = /\bnode\s+(scripts\/\S+)/.exec(String(command));
      if (!match) continue;
      assert.ok(
        existsSync(path.join(generated.target, match[1])),
        `dev script "${name}" references missing file ${match[1]}`,
      );
    }
  } finally {
    generated.cleanup();
  }
});

test('generated app installs the Kit runtime-transport bridge at renderer bootstrap', () => {
  // Streaming (chat.stream) needs the renderer to publish the scoped invoke+listen
  // runtime hook. That is a single Kit platform contract, so every scaffolded app
  // must call the Kit bootstrap before render — not hand-roll its own hook.
  const generated = scaffold('standalone');
  try {
    const main = generated.read('src/main.tsx');
    assert.match(main, /import \{[^}]*installNimiShellRuntimeBridge[^}]*\} from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
    const bootstrapAt = main.indexOf('installNimiShellRuntimeBridge()');
    const renderAt = main.indexOf('.render(');
    assert.ok(bootstrapAt > -1, 'generated main.tsx must call installNimiShellRuntimeBridge()');
    assert.ok(renderAt > -1, 'generated main.tsx must render the app');
    assert.ok(bootstrapAt < renderAt, 'bootstrap must run before render');
    assert.doesNotMatch(main, /__NIMI_TAURI_RUNTIME__/);
  } finally {
    generated.cleanup();
  }
});

test('generated app grants the Tauri event capability streaming needs', () => {
  // Installing the listen hook is not enough: calling it invokes the core:event
  // plugin command, which Tauri v2 gates behind a capability. Without it, stream
  // open fails closed with SDK_RUNTIME_TAURI_STREAM_OPEN_FAILED ("event.listen not
  // allowed"). The main window must grant core:event (via core:default).
  const generated = scaffold('standalone');
  try {
    const capability = JSON.parse(generated.read('src-tauri/capabilities/default.json'));
    assert.ok(capability.windows.includes('main'), 'capability must target the main window');
    const permissions = capability.permissions.map((entry) => (typeof entry === 'string' ? entry : entry.identifier));
    const grantsEvent = permissions.some((p) => p === 'core:default' || p === 'core:event:default' || p === 'core:event:allow-listen');
    assert.ok(grantsEvent, `capability must grant core:event for stream listen; got ${JSON.stringify(permissions)}`);
  } finally {
    generated.cleanup();
  }
});

test('workspace-app scaffold uses workspace + path deps and writes an app-slice input', () => {
  const generated = scaffold('workspace-app');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], 'workspace:*');
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], 'workspace:*');
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], 'workspace:*');
    assert.equal(packageJson.devDependencies['@nimiplatform/nimi-coding'], 'workspace:*');
    assert.match(generated.read('src-tauri/Cargo.toml'), /nimi-shell-tauri = \{ path = "\.\.\/\.\.\/\.\.\/kit\/shell\/tauri" \}/);
    assert.match(generated.read('nimi.app.yaml'), /profile: workspace-app/);
    assert.match(generated.read('apps/acme-widget/spec/app-slice.md'), /not public Nimi App admission/);
    const lock = generated.lock();
    assert.ok(lock.managedFileTaxonomy.packageOwnedProjection.includes('apps/acme-widget/spec/app-slice.md'));
    assertTauriIconSupport(generated);
  } finally {
    generated.cleanup();
  }
});

test('cli standalone scaffold uses current public dependency version sources', () => {
  const generated = cliScaffold('standalone');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    const lock = JSON.parse(generated.read('.nimi/app-scaffold/lock.json'));
    const appToolsPackageJson = JSON.parse(readFileSync(path.join(testDir, '..', 'package.json'), 'utf8'));
    const expectedAppToolsVersion = `^${appToolsPackageJson.version}`;
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], '^0.6.0');
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], '^0.2.0');
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], expectedAppToolsVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/nimi-coding'], '0.2.5');
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/sdk'], '^0.6.0');
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/app-tools'], expectedAppToolsVersion);
  } finally {
    generated.cleanup();
  }
});

test('create accepts explicit identity and rewrites every reference identity literal', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-identity-'));
  const target = path.join(tempRoot, 'app');
  const env = fakePnpmEnv(tempRoot);
  try {
    const result = runNimiApp([
      'create', '--dir', target, '--profile', 'standalone',
      '--app-id', 'studio.canvas', '--title', 'Studio Canvas', '--package-name', 'studio-canvas',
    ], tempRoot, { env });
    assert.equal(result.status, 0, result.stderr);
    const init = runNimiApp(['init', '--dir', target], tempRoot, { env });
    assert.equal(init.status, 0, init.stderr);

    const lock = JSON.parse(readFileSync(path.join(target, '.nimi/app-scaffold/lock.json'), 'utf8'));
    const intent = JSON.parse(readFileSync(path.join(target, '.nimi/app-scaffold/intent.json'), 'utf8'));
    assert.equal(lock.appId, 'studio.canvas');
    assert.equal(lock.appTitle, 'Studio Canvas');
    assert.equal(lock.packageName, 'studio-canvas');
    assert.equal(lock.cargoPackageName, 'studio-canvas-shell');
    assert.equal(lock.tauriIdentifier, 'ai.nimi.apps.studio.canvas');
    assert.equal(intent.appId, 'studio.canvas');

    assert.match(readFileSync(path.join(target, 'nimi.app.yaml'), 'utf8'), /app_id: studio\.canvas/);
    assert.match(readFileSync(path.join(target, 'src/shell/auth/runtime-platform.ts'), 'utf8'), /appId = 'studio\.canvas'/);
    assert.match(readFileSync(path.join(target, 'src-tauri/Cargo.toml'), 'utf8'), /name = "studio-canvas-shell"/);

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
      'create', '--dir', target, '--profile', 'standalone',
      '--app-id', 'studio.canvas', '--title', 'Studio Canvas',
      '--package-name', '@studio/canvas', '--author', 'Studio Maintainers',
    ], tempRoot, { env });
    assert.equal(result.status, 0, result.stderr);
    const init = runNimiApp(['init', '--dir', target], tempRoot, { env });
    assert.equal(init.status, 0, init.stderr);

    const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(path.join(target, '.nimi/app-scaffold/lock.json'), 'utf8'));
    assert.equal(packageJson.name, '@studio/canvas');
    assert.equal(packageJson.author, 'Studio Maintainers');
    assert.equal(lock.cargoPackageName, 'studio-canvas-shell');
    assert.match(readFileSync(path.join(target, 'src-tauri/Cargo.toml'), 'utf8'), /name = "studio-canvas-shell"/);

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
      'create', '--dir', path.join(tempRoot, 'app'), '--profile', 'standalone', '--package-name', 'Invalid Package',
    ], tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid npm package name/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
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

test('create may target an otherwise empty git root but refuses other non-empty roots', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-git-root-'));
  try {
    const emptyGitRoot = path.join(tempRoot, 'empty-git-root');
    mkdirSync(path.join(emptyGitRoot, '.git'), { recursive: true });
    writeFileSync(path.join(emptyGitRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    let result = runNimiApp(['create', '--dir', emptyGitRoot, '--profile', 'standalone'], tempRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(emptyGitRoot, '.git', 'HEAD'), 'utf8'), 'ref: refs/heads/main\n');
    assert.ok(readFileSync(path.join(emptyGitRoot, 'package.json'), 'utf8'));

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

test('doctor fails closed on missing lock and retired package names', () => {
  const missingLock = cliScaffold('standalone');
  try {
    rmSync(path.join(missingLock.target, '.nimi/app-scaffold/lock.json'), { force: true });
    const result = runNimiApp(['doctor', '--dir', missingLock.target], missingLock.tempRoot, { env: missingLock.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing initialized scaffold lock/);
  } finally {
    missingLock.cleanup();
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
});

test('doctor fails closed on provider/model hardcoding in product code but not in tests', () => {
  const cases = [
    "export const hardcodedModel = 'claude-3-5-sonnet';\n",
    "export const hardcodedProvider = 'openai';\n",
    "export const route = { provider: 'anthropic', model: 'gpt-4o' };\n",
    "export const route = 'openai/gpt-4o';\n",
  ];
  for (const source of cases) {
    const generated = cliScaffold('standalone');
    try {
      writeFileSync(path.join(generated.target, 'src/shell/routes/product-area.tsx'), source);
      const result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0, source);
      assert.match(result.stderr, /provider\/model hardcoding/, source);
    } finally {
      generated.cleanup();
    }
  }

  // The reference contract test ships a negative assertion that names providers;
  // it must not trip the product-truth hardcoding scan.
  const clean = cliScaffold('standalone');
  try {
    const result = runNimiApp(['doctor', '--dir', clean.target], clean.tempRoot, { env: clean.env });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    clean.cleanup();
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

test('app scaffold generator is deterministic and free of inlined product strings', () => {
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
  assert.ok(source.split('\n').length < 700);
  // Product UI strings live in the apps/tester snapshot, never inlined in the generator.
  assert.doesNotMatch(source, /DesktopShellAuthPage/);
  assert.doesNotMatch(source, /Nimi App Runtime Tester/);
});

test('app source resolves from the live reference app and is packaged via prepack', () => {
  const packageJson = JSON.parse(readFileSync(path.join(testDir, '..', 'package.json'), 'utf8'));
  // The snapshot is a gitignored build artifact baked into the tarball at pack.
  assert.ok(packageJson.files.includes('templates'));
  assert.ok(packageJson.files.includes('scripts'));
  assert.equal(packageJson.scripts.prepack, 'node scripts/sync-app-source.mjs --apply');
  assert.equal(packageJson.scripts.prepublishOnly, 'node scripts/sync-app-source.mjs --apply');

  // In the monorepo there is no baked snapshot; the generator reads apps/tester live.
  const { baseDir, manifest } = resolveAppSource();
  assert.match(baseDir, /apps[/\\]tester$/);
  assert.equal(manifest.sourceApp, 'apps/tester');
  assert.ok(manifest.files.some((entry) => entry.path === 'src/shell/auth/runtime-platform.ts' && entry.class === 'scaffold-managed glue'));
  assert.ok(manifest.files.some((entry) => entry.path === 'src/tester/tester-workbench.tsx' && entry.class === 'app-owned product code'));
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
    ]) {
      assert.equal(joined.includes(forbidden), false, `${forbidden} must not be generated`);
    }
  } finally {
    generated.cleanup();
  }
});
