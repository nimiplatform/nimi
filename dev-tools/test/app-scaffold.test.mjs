import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAppScaffold } from '../lib/app-scaffold.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const nimiAppBinPath = path.join(testDir, '..', 'bin', 'nimi-app.mjs');

const versions = {
  sdkVersion: '0.0.0-sdk',
  devToolsVersion: '0.0.0-dev-tools',
  nimiKitVersion: '0.0.0-kit',
  reactVersion: '19.0.0',
  reactDomVersion: '19.0.0',
  nodeTypesVersion: '24.0.0',
  reactTypesVersion: '19.0.0',
  reactDomTypesVersion: '19.0.0',
  viteVersion: '7.0.0',
  viteReactPluginVersion: '5.0.0',
  tauriApiVersion: '2.0.0',
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

function cliScaffold(profile) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-cli-'));
  const target = path.join(tempRoot, profile);
  const result = runNimiApp(['create', '--dir', target, '--profile', profile], tempRoot);
  assert.equal(result.status, 0, result.stderr);
  return {
    tempRoot,
    target,
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

function runNimiApp(args, cwd) {
  return spawnSync(process.execPath, [nimiAppBinPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('standalone scaffold generates industrial Nimi App Tauri profile', () => {
  const generated = scaffold('standalone');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(packageJson.dependencies['@nimiplatform/nimi-kit'], versions.nimiKitVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/dev-tools'], versions.devToolsVersion);
    assert.equal(packageJson.scripts.doctor, 'nimi-app doctor');
    assert.equal(packageJson.scripts.update, 'nimi-app update');
    assert.equal(Object.hasOwn(packageJson, 'author'), false);
    const lock = JSON.parse(generated.read('.nimi/scaffold.lock.json'));
    assert.equal(lock.profile, 'standalone');
    assert.equal(lock.appId, 'tester-app');
    assert.equal(lock.managedFileTaxonomy.appOwnedProductCode[0], 'src/shell/routes/product-area.tsx');
    assert.equal(lock.managedFileHashes['src/shell/auth/auth-gate.tsx'].class, 'scaffold-managed glue');
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/sdk'], versions.sdkVersion);
    assert.match(generated.read('src-tauri/Cargo.toml'), /nimi-shell-tauri = "0\.1\.0"/);
    assert.match(generated.read('src-tauri/src/main.rs'), /nimi_shell_tauri::nimi_shell_tauri_runtime_bridge_handler!\[\]/);
    assert.equal(generated.read('src-tauri/src/main.rs').includes(['runtime', 'bridge', 'plugin'].join('_')), false);
    assertTauriIconSupport(generated);
    assert.match(generated.read('src/shell/auth/runtime-platform.ts'), /createNimiAppRuntimePlatformClient/);
    assert.match(generated.read('nimi.app.yaml'), /manifest_role: submitted-input/);
    const buildProfile = generated.read('.nimi/config/build-profile.yaml');
    assert.match(buildProfile, /build_profile_ref: tauri-pnpm-vite/);
    assert.match(buildProfile, /lockfile_path: pnpm-lock\.yaml/);
    assert.match(buildProfile, /lockfile_policy: author-install-generates-lockfile/);
    assert.match(buildProfile, /ci_install_command: pnpm install --no-frozen-lockfile/);
    assert.equal(lock.semantics.lockfilePolicy, 'author-install-generates-lockfile');
    const ci = generated.read('.github/workflows/ci.yml');
    assert.match(ci, /pnpm install --no-frozen-lockfile/);
    assert.doesNotMatch(ci, /cache: pnpm/);
    assert.match(generated.read('.gitignore'), /^dist\/$/m);
    assert.match(generated.read('README.md'), /pre-submission self-checks only/);
  } finally {
    generated.cleanup();
  }
});

test('default CLI standalone scaffold uses current public SDK version source', () => {
  const generated = cliScaffold('standalone');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    const lock = JSON.parse(generated.read('.nimi/scaffold.lock.json'));
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], '^0.5.14');
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/sdk'], '^0.5.14');
  } finally {
    generated.cleanup();
  }
});

test('workspace-app scaffold uses workspace package and Cargo path dependencies', () => {
  const generated = scaffold('workspace-app');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], 'workspace:*');
    assert.equal(packageJson.dependencies['@nimiplatform/nimi-kit'], 'workspace:*');
    assert.equal(packageJson.devDependencies['@nimiplatform/dev-tools'], 'workspace:*');
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
    ], tempRoot);
    assert.equal(result.status, 0, result.stderr);

    const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(path.join(target, '.nimi/scaffold.lock.json'), 'utf8'));
    const identity = readFileSync(path.join(target, '.nimi/config/app-identity.yaml'), 'utf8');
    assert.equal(packageJson.name, 'nimiapp-tester');
    assert.equal(Object.hasOwn(packageJson, 'author'), false);
    assert.equal(lock.appId, 'nimi.tester');
    assert.equal(lock.appTitle, 'Nimi Tester');
    assert.equal(lock.packageName, 'nimiapp-tester');
    assert.equal(lock.packageAuthor, null);
    assert.equal(lock.cargoPackageName, 'nimiapp-tester-shell');
    assert.equal(lock.appIdentity.npmPackageName, 'nimiapp-tester');
    assert.match(identity, /app_id: nimi\.tester/);
    assert.match(identity, /display_name: Nimi Tester/);
    assert.match(identity, /npm_package_name: nimiapp-tester/);
    assert.match(identity, /cargo_package_name: nimiapp-tester-shell/);
    assert.match(identity, /tauri_identifier: ai\.nimi\.apps\.nimi\.tester/);
    assert.match(readFileSync(path.join(target, 'nimi.app.yaml'), 'utf8'), /app_id: nimi\.tester/);
    assert.match(readFileSync(path.join(target, 'src/shell/auth/runtime-platform.ts'), 'utf8'), /appId = 'nimi\.tester'/);
    assert.match(readFileSync(path.join(target, 'src-tauri/Cargo.toml'), 'utf8'), /name = "nimiapp-tester-shell"/);

    const doctor = runNimiApp(['doctor', '--dir', target], tempRoot);
    assert.equal(doctor.status, 0, doctor.stderr);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create accepts package author and scoped npm package metadata', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-metadata-'));
  const target = path.join(tempRoot, 'app');
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
    ], tempRoot);
    assert.equal(result.status, 0, result.stderr);

    const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(path.join(target, '.nimi/scaffold.lock.json'), 'utf8'));
    const identity = readFileSync(path.join(target, '.nimi/config/app-identity.yaml'), 'utf8');
    assert.equal(packageJson.name, '@nimi/nimi-tester');
    assert.equal(packageJson.author, 'Nimi Maintainers');
    assert.equal(lock.packageName, '@nimi/nimi-tester');
    assert.equal(lock.packageAuthor, 'Nimi Maintainers');
    assert.equal(lock.cargoPackageName, 'nimi-nimi-tester-shell');
    assert.match(identity, /package_author: Nimi Maintainers/);
    assert.match(readFileSync(path.join(target, 'src-tauri/Cargo.toml'), 'utf8'), /name = "nimi-nimi-tester-shell"/);

    const doctor = runNimiApp(['doctor', '--dir', target], tempRoot);
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
    let result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot);
    assert.equal(result.status, 0, result.stderr);

    const authGatePath = path.join(generated.target, 'src/shell/auth/auth-gate.tsx');
    writeFileSync(authGatePath, `${generated.read('src/shell/auth/auth-gate.tsx')}\n// drift\n`);
    result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Managed scaffold drift detected/);

    const productPath = path.join(generated.target, 'src/shell/routes/product-area.tsx');
    const productEdit = [
      "import { Surface } from '@nimiplatform/nimi-kit/ui';",
      '',
      'export function ProductArea() {',
      '  return <Surface className="product-area"><h1>Developer owned edit</h1></Surface>;',
      '}',
      '',
    ].join('\n');
    writeFileSync(productPath, productEdit);

    result = runNimiApp(['update', '--dir', generated.target], generated.tempRoot);
    assert.equal(result.status, 0, result.stderr);
    result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot);
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
    rmSync(path.join(generated.target, '.nimi/scaffold.lock.json'), { force: true });
    let result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing scaffold lock/);
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
    const result = runNimiApp(['doctor', '--dir', stale.target], stale.tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Forbidden scaffold remnants detected/);
  } finally {
    stale.cleanup();
  }

  const inconsistentLockfile = cliScaffold('standalone');
  try {
    const buildProfilePath = path.join(inconsistentLockfile.target, '.nimi/config/build-profile.yaml');
    const ciPath = path.join(inconsistentLockfile.target, '.github/workflows/ci.yml');
    writeFileSync(
      buildProfilePath,
      inconsistentLockfile
        .read('.nimi/config/build-profile.yaml')
        .replace('ci_install_command: pnpm install --no-frozen-lockfile', 'ci_install_command: pnpm install --frozen-lockfile'),
    );
    writeFileSync(
      ciPath,
      inconsistentLockfile.read('.github/workflows/ci.yml').replace('--no-frozen-lockfile', '--frozen-lockfile'),
    );
    const result = runNimiApp(['doctor', '--dir', inconsistentLockfile.target], inconsistentLockfile.tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /frozen lockfile install but lockfile is missing/);
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
    const result = runNimiApp(['doctor', '--dir', cachedWithoutLockfile.target], cachedWithoutLockfile.tempRoot);
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
      const result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot);
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
    const lockPath = path.join(unsupported.target, '.nimi/scaffold.lock.json');
    const lock = JSON.parse(unsupported.read('.nimi/scaffold.lock.json'));
    lock.scaffoldVersion = 'unsupported-version';
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const result = runNimiApp(['update', '--dir', unsupported.target], unsupported.tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported scaffold version/);
  } finally {
    unsupported.cleanup();
  }

  const mixedProfile = cliScaffold('standalone');
  try {
    const lockPath = path.join(mixedProfile.target, '.nimi/scaffold.lock.json');
    const lock = JSON.parse(mixedProfile.read('.nimi/scaffold.lock.json'));
    lock.profile = 'unknown-profile';
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const result = runNimiApp(['update', '--dir', mixedProfile.target], mixedProfile.tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported scaffold profile/);
  } finally {
    mixedProfile.cleanup();
  }

  const conflict = cliScaffold('standalone');
  try {
    const lockPath = path.join(conflict.target, '.nimi/scaffold.lock.json');
    const lock = JSON.parse(conflict.read('.nimi/scaffold.lock.json'));
    lock.managedFileHashes['src/shell/routes/product-area.tsx'] = {
      class: 'scaffold-managed glue',
      sha256: 'conflict',
    };
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const result = runNimiApp(['update', '--dir', conflict.target], conflict.tempRoot);
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
