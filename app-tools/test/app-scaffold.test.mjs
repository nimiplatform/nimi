import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { APP_ACCESS_DOMAINS, resolveAppAccessDeclaration } from '../lib/app-access-declaration.mjs';
import {
  buildAppScaffoldSnapshotFromIntent,
  createAppScaffold,
  SCAFFOLD_VERSION,
  SUPPORTED_APP_SCAFFOLD_PROFILES,
} from '../lib/app-scaffold.mjs';
import {
  APP_SCAFFOLD_FEATURE_IDS,
  resolveAppScaffoldFeatures,
  validateAppScaffoldCapabilityCatalog,
} from '../lib/app-scaffold-capabilities.mjs';
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
  electronVersion: '42.0.0-electron',
  esbuildVersion: '0.28.0-esbuild',
  typescriptVersion: '5.0.0',
  yamlVersion: '2.0.0-yaml',
  packageManager: 'pnpm@10.32.1',
};

const LAB_SOURCE_IDENTITY_LITERALS = [
  'nimi.lab',
  '@nimiplatform/lab',
  'ai.nimi.apps.nimi.lab',
  'nimiapp-lab-shell',
];
const RETIRED_REFERENCE_PROFILE = `${'tes'}${'ter'}-${'reference'}`;

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
      mkdirSync(path.join(targetDir, '.nimi', 'methodology'), { recursive: true });
      writeFileSync(path.join(targetDir, '.nimi', 'methodology', 'authority-authoring.yaml'), 'source: fake-nimicoding-sync\n');
      return {
        ok: true,
        mode,
        summary: {
          total: 1,
          created: mode === 'apply' ? 1 : 0,
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
      features: options.features,
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

function assertGeneratedPathMissing(generated, relativePath) {
  assert.equal(existsSync(path.join(generated.target, relativePath)), false, `${relativePath} must not be generated`);
}

function assertGeneratedPathExists(generated, relativePath) {
  assert.equal(existsSync(path.join(generated.target, relativePath)), true, `${relativePath} must be generated`);
}

function fakePnpmEnv(tempRoot) {
  const binDir = path.join(tempRoot, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  const fakePnpm = path.join(binDir, 'pnpm');
  writeFileSync(
    fakePnpm,
    [
      '#!/bin/sh',
      'if [ "$1" = "--silent" ]; then shift; fi',
      'if [ "$1" = "exec" ] && [ "$2" = "nimicoding" ] && [ "$3" = "sync" ]; then',
      '  mkdir -p .nimi/methodology',
      '  printf "source: fake-nimicoding-sync\\n" > .nimi/methodology/authority-authoring.yaml',
      '  printf "{\\"ok\\":true,\\"summary\\":{\\"total\\":1,\\"created\\":1}}\\n"',
      '  exit 0',
      'fi',
      'printf "unexpected fake pnpm command: %s\\n" "$*" >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(fakePnpm, 0o755);
  writeFileSync(
    path.join(binDir, 'pnpm.cmd'),
    [
      '@ECHO off',
      'IF "%~1"=="--silent" SHIFT',
      'IF "%~1"=="exec" IF "%~2"=="nimicoding" IF "%~3"=="sync" (',
      '  MKDIR .nimi\\methodology 2>NUL',
      '  > .nimi\\methodology\\authority-authoring.yaml ECHO source: fake-nimicoding-sync',
      '  ECHO {"ok":true,"summary":{"total":1,"created":1}}',
      '  EXIT /B 0',
      ')',
      'ECHO unexpected fake pnpm command: %* 1>&2',
      'EXIT /B 1',
      '',
    ].join('\r\n'),
  );
  const fakeCorepack = path.join(binDir, 'corepack');
  writeFileSync(
    fakeCorepack,
    [
      '#!/bin/sh',
      'if [ "$1" = "pnpm" ]; then',
      '  shift',
      '  exec pnpm "$@"',
      'fi',
      'printf "unexpected fake corepack command: %s\\n" "$*" >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(fakeCorepack, 0o755);
  writeFileSync(
    path.join(binDir, 'corepack.cmd'),
    [
      '@ECHO off',
      'IF "%~1"=="pnpm" (',
      `  CALL "${path.join(binDir, 'pnpm.cmd')}" %2 %3 %4 %5 %6 %7 %8 %9`,
      '  EXIT /B %ERRORLEVEL%',
      ')',
      'ECHO unexpected fake corepack command: %* 1>&2',
      'EXIT /B 1',
      '',
    ].join('\r\n'),
  );
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
  };
}

function cliScaffold(profile, extraArgs = [], tempRootParent = os.tmpdir()) {
  const tempRoot = mkdtempSync(path.join(tempRootParent, 'nimi-app-scaffold-cli-'));
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
  assert.deepEqual(tauriConfig.bundle?.icon, ['icons/icon.png', 'icons/icon.ico']);
  const icon = generated.readBytes('src-tauri/icons/icon.png');
  assert.deepEqual([...icon.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ico = generated.readBytes('src-tauri/icons/icon.ico');
  assert.deepEqual([...ico.subarray(0, 6)], [0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
  assert.deepEqual([...ico.subarray(22, 30)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

function runGeneratedNodeScript(generated, scriptPath) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: generated.target,
    encoding: 'utf8',
    env: generated.env ? generated.env : process.env,
  });
}

test('standalone scaffold creates a generic starter with rewritten identity', () => {
  const generated = scaffold('standalone');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    assert.equal(packageJson.name, 'acme-widget');
    assert.equal(packageJson.private, false);
    assert.equal(packageJson.packageManager, versions.packageManager);
    assert.equal(packageJson.publishConfig.access, 'public');
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], versions.kitVersion);
    assert.equal(packageJson.dependencies['lucide-react'], versions.lucideReactVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], versions.appToolsVersion);
    assert.equal(packageJson.devDependencies['@types/three'], versions.threeTypesVersion);
    assert.equal(packageJson.devDependencies.yaml, versions.yamlVersion);
    assert.match(packageJson.scripts['dev:renderer'], /^vite --host 127\.0\.0\.1 --port \d+ --strictPort$/);
    const devPort = devPortFromScript(packageJson.scripts['dev:renderer']);
    assert.ok(devPort >= 1430 && devPort < 1530);
    assert.match(
      generated.read('nimi.app.yaml'),
      new RegExp(`^    renderer_origin: http://127\\.0\\.0\\.1:${devPort}$`, 'm'),
    );

    // Identity is rewritten everywhere; no Nimi Lab source identity leaks through.
    assert.match(generated.read('nimi.app.yaml'), /app_id: acme\.widget/);
    assert.match(generated.read('nimi.app.yaml'), /profile: standalone/);
    assert.match(generated.read('src/shell/auth/app-identity.ts'), /appId = 'acme\.widget'/);
    assert.match(generated.read('src/shell/auth/runtime-platform.ts'), /import \{ appId \} from '\.\/app-identity\.js'/);
    const tauri = JSON.parse(generated.read('src-tauri/tauri.conf.json'));
    assert.equal(tauri.identifier, 'ai.nimi.apps.acme.widget');
    assert.equal(tauri.productName, 'Acme Widget');
    assert.equal(tauri.build.devUrl, `http://127.0.0.1:${devPort}`);
    assert.match(generated.read('src-tauri/Cargo.toml'), /name = "acme-widget-shell"/);
    assert.match(generated.read('src-tauri/Cargo.toml'), /nimi-shell-tauri = "0\.1\.0"/);
    assert.match(generated.read('src-tauri/Cargo.toml'), /time = "=0\.3\.47"/);
    assert.match(generated.read('nimi.app.yaml'), /^app_access: \[\]$/m);
    assert.doesNotMatch(generated.read('nimi.app.yaml'), /scope:|qualifier:|operation_id:|resource_ref:/);

    const identityScannedFiles = [
      'nimi.app.yaml',
      'src/shell/auth/app-identity.ts',
      'src/shell/auth/runtime-platform.ts',
      'src-tauri/tauri.conf.json',
      'src-tauri/Cargo.toml',
      'src/main.tsx',
      'src/shell/routes/product-area.tsx',
      'src-tauri/src/main.rs',
    ];
    for (const relativePath of identityScannedFiles) {
      const content = generated.read(relativePath);
      for (const literal of LAB_SOURCE_IDENTITY_LITERALS) {
        assert.equal(content.includes(literal), false, `${literal} must not survive in ${relativePath}`);
      }
    }

    // Default profiles are generic starters. Lab-only product code is never copied.
    assert.match(generated.read('src/shell/routes/product-area.tsx'), /NimiStarterSurface/);
    assert.doesNotMatch(generated.read('src/shell/routes/product-area.tsx'), /LabWorkbench|WorldTourViewerRoute/);
    assert.match(generated.read('src/main.tsx'), /entry:acme-widget-app/);
    assert.doesNotMatch(generated.read('vite.config.ts'), /repoRoot|path\.join\(repoRoot|\.\.\/\.\.\/kit|kit\/ui\/src/);
    assert.match(generated.read('vite.config.ts'), /cacheDir: '\.vite'/);
    assert.doesNotMatch(generated.read('src-tauri/src/main.rs'), /lab_storage|world_tour|lab_/);
    assertGeneratedPathMissing(generated, 'src/lab');
    assertGeneratedPathMissing(generated, 'src/capabilities');
    assertGeneratedPathMissing(generated, 'src/shell/ai');
    assertGeneratedPathMissing(generated, 'src/shell/routes/settings.tsx');
    assertGeneratedPathMissing(generated, 'src/shell/routes/settings');
    assertGeneratedPathMissing(generated, 'src-tauri/src/world_tour.rs');
    assertGeneratedPathExists(generated, 'src-electron/main.ts');
    assertGeneratedPathExists(generated, 'src-electron/preload.cts');
    assertGeneratedPathMissing(generated, 'dist-electron');
    assertGeneratedPathMissing(generated, 'test/lab-contract.test.mjs');
    assertGeneratedPathMissing(generated, 'ADMISSION.md');
    assertGeneratedPathMissing(generated, '.nimi/admission/submission.yaml');
    assertGeneratedPathMissing(generated, '.nimi/admission/build-profile.yaml');

    // Taxonomy: only the generated starter route is app-owned in default profiles.
    const lock = generated.lock();
    const appOwned = lock.managedFileTaxonomy.appOwnedProductCode;
    assert.ok(appOwned.includes('src/shell/routes/product-area.tsx'));
    assert.equal(appOwned.some((file) => file.startsWith('src/lab/')), false);
    assert.equal(appOwned.some((file) => file.startsWith('src/capabilities/')), false);
    assert.equal(appOwned.some((file) => file.startsWith('src/shell/ai/')), false);
    assert.equal(appOwned.some((file) => file.startsWith('src-electron/')), false);
    const electronMain = generated.read('src-electron/main.ts');
    assert.match(electronMain, /registerNimiElectronAppBridge/);
    assert.match(electronMain, /const allowedRendererUrls = \[rendererUrl\];/);
    assert.match(electronMain, /allowedRendererUrls,\n    assetMediaPlatform: \{ protocol, webRequest: session\.defaultSession\.webRequest, webContents \},\n    ipcMain,/);
    assert.match(electronMain, /isAllowedElectronRendererUrl\(url, allowedRendererUrls\)/);
    assert.equal(electronMain.match(/\[rendererUrl\]/g)?.length, 1);
    assert.match(electronMain, /registerNimiElectronAppAssetProtocolScheme\(protocol\)/);
    assert.doesNotMatch(electronMain, /onProtectedSessionFailure/);
    assert.doesNotMatch(electronMain, /runtimeEndpoint|sessionProof|launchTicket/);
    assert.match(generated.read('src-tauri/src/main.rs'), /RuntimeBridgeLocalAppHost::platform_default\(\)/);
    assert.equal(lock.managedFileHashes['src/shell/auth/auth-gate.tsx'].class, 'scaffold-managed glue');
    assert.equal(lock.managedFileHashes['package.json'].class, 'scaffold-managed glue');
    assert.equal(lock.managedFileHashes['.github/workflows/ci.yml'].class, 'scaffold-managed glue');
    assert.equal(Object.hasOwn(lock.managedFileHashes, 'src/lab/lab-workbench.tsx'), false);

    assertTauriIconSupport(generated);
    const runtimePlatform = generated.read('src/shell/auth/runtime-platform.ts');
    assert.match(runtimePlatform, /getNimiLocalAppClient/);
    assert.match(runtimePlatform, /\.auth\.status\(\)/);
    assert.match(runtimePlatform, /!status\.sessionBound/);
    assert.match(runtimePlatform, /runtimeAccountLoginEnabled = false/);
    assert.doesNotMatch(runtimePlatform, /createNimiClient|developerRegistration|developer-registered-local-app/);
  } finally {
    generated.cleanup();
  }
});

test('standalone scaffold base contains no capability slices and records v2 empty selection', () => {
  assert.deepEqual(SUPPORTED_APP_SCAFFOLD_PROFILES, ['standalone', 'workspace-app']);
  assert.deepEqual(APP_SCAFFOLD_FEATURE_IDS, ['kit-recipes']);
  const generated = scaffold('standalone');
  try {
    assertGeneratedPathMissing(generated, 'src/capabilities');
    assert.match(generated.read('src/shell/routes/selected-capabilities.tsx'), /return null/);
    assert.match(generated.read('nimi.app.yaml'), /^app_access: \[\]$/m);
    const intent = JSON.parse(generated.read('.nimi/app-scaffold/intent.json'));
    const lock = generated.lock();
    assert.equal(intent.intentVersion, 2);
    assert.equal(lock.lockVersion, 2);
    assert.equal(intent.scaffoldVersion, SCAFFOLD_VERSION);
    assert.equal(lock.scaffoldVersion, SCAFFOLD_VERSION);
    assert.deepEqual(intent.features, []);
    assert.deepEqual(lock.features, []);
    assert.deepEqual(lock.appAccessItems, []);
  } finally {
    generated.cleanup();
  }
});

test('standalone scaffold composes the admitted real Lab Kit recipes slice', () => {
  const generated = scaffold('standalone', { features: 'kit-recipes' });
  try {
    assert.deepEqual(generated.lock().features, ['kit-recipes']);
    assert.deepEqual(generated.lock().appAccessItems, []);
    assertGeneratedPathExists(generated, 'src/capabilities/kit-recipes/index.tsx');
    assertGeneratedPathExists(generated, 'src/capabilities/kit-recipes/gallery.tsx');
    assertGeneratedPathExists(generated, 'src/capabilities/kit-recipes/kit-component-gallery-recipes.tsx');
    assert.match(
      generated.read('src/shell/routes/selected-capabilities.tsx'),
      /import \{ KitRecipesCapability \} from '\.\.\/\.\.\/capabilities\/kit-recipes\/index\.js';/,
    );
    assert.match(generated.read('src/capabilities/kit-recipes/gallery.tsx'), /UI Recipes/);
    assert.doesNotMatch(generated.read('src/capabilities/kit-recipes/gallery.tsx'), /useLabRendererHost/);
  } finally {
    generated.cleanup();
  }

  assert.throws(
    () => scaffold('standalone', { features: 'ai-consume' }),
    /Unknown app scaffold feature: ai-consume/,
  );
});

test('default starter AGENTS stays generic and does not inherit Lab ownership', () => {
  const generated = scaffold('standalone');
  try {
    const agents = generated.read('AGENTS.md');
    assert.equal(generated.lock().appOwnedInitialHashes['AGENTS.md'].class, 'app-owned product code');
    assert.match(agents, /src\/shell\/routes\/product-area\.tsx/);
    for (const forbidden of [
      /src\/lab/,
      /src-electron/,
      /lab_storage/,
      /world_tour/,
      /this same Lab app/,
    ]) {
      assert.doesNotMatch(agents, forbidden);
    }
  } finally {
    generated.cleanup();
  }
});

test('app id maps losslessly to the Tauri bundle identifier', () => {
  const generated = scaffold('standalone', {
    appId: 'acme-widget',
    title: 'Acme Widget',
    packageName: 'acme-widget',
  });
  try {
    assert.match(generated.read('nimi.app.yaml'), /app_id: acme-widget/);
    assert.match(generated.read('src/shell/auth/app-identity.ts'), /appId = 'acme-widget'/);
    const tauri = JSON.parse(generated.read('src-tauri/tauri.conf.json'));
    assert.equal(tauri.identifier, 'ai.nimi.apps.acme-widget');
  } finally {
    generated.cleanup();
  }
});

test('app id rejects lossy underscore identity', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-invalid-app-id-'));
  try {
    assert.throws(
      () => createAppScaffold({
        cwd: tempRoot,
        options: {
          dir: path.join(tempRoot, 'app'),
          profile: 'standalone',
          appId: 'acme_widget',
          title: 'Acme Widget',
          packageName: 'acme-widget',
        },
        versions,
        createFileTree,
        ensureDirEmptyOrMissing: () => {},
        mkdirSync,
      }),
      /Invalid app id: acme_widget/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated package.json scripts reference only commands and existing local scripts', () => {
  const generated = scaffold('standalone');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    assert.deepEqual(packageJson.pnpm?.onlyBuiltDependencies, ['electron', 'esbuild', 'protobufjs']);
    assert.equal(packageJson.scripts.dev, 'nimi-app dev --shell electron');
    assert.equal(packageJson.scripts['dev:shell'], 'nimi-app dev');
    assert.equal(packageJson.scripts['dev:electron'], 'nimi-app dev --shell electron');
    assert.equal(packageJson.scripts.postinstall, 'install-electron --no');
    assert.doesNotMatch(JSON.stringify(packageJson.scripts), /--shell\s+tauri/);
    assert.doesNotMatch(JSON.stringify(packageJson.scripts), /(?:^|\s)tauri dev(?:\s|$)/);
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

test('generated app installs the Kit app-host bridge at renderer bootstrap', () => {
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

test('workspace-app scaffold uses workspace + path deps without product authority', () => {
  const generated = scaffold('workspace-app');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], 'workspace:*');
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], 'workspace:*');
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], 'workspace:*');
    assert.equal(packageJson.devDependencies['@nimiplatform/nimi-coding'], versions.nimicodingVersion);
    assert.equal(packageJson.devDependencies.yaml, versions.yamlVersion);
    assert.match(generated.read('src-tauri/Cargo.toml'), /nimi-shell-tauri = \{ path = "\.\.\/\.\.\/\.\.\/kit\/shell\/tauri" \}/);
    assert.doesNotMatch(generated.read('vite.config.ts'), /repoRoot|path\.join\(repoRoot|\.\.\/\.\.\/kit|kit\/ui\/src/);
    assert.match(generated.read('nimi.app.yaml'), /profile: workspace-app/);
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
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], '^0.3.0');
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], expectedAppToolsVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/nimi-coding'], '0.5.0');
    assert.equal(packageJson.devDependencies.yaml, '^2.9.0');
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/sdk'], '^0.6.0');
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/app-tools'], expectedAppToolsVersion);
    assert.equal(lock.dependencyMatrix.npm.yaml, '^2.9.0');
  } finally {
    generated.cleanup();
  }
});

test('cli standalone scaffold expands all to the admitted catalog order', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-all-'));
  const target = path.join(tempRoot, 'app');
  try {
    const result = runNimiApp([
      'create', '--dir', target, '--profile', 'standalone', '--features', 'all',
    ], tempRoot);
    assert.equal(result.status, 0, result.stderr);
    const intent = JSON.parse(readFileSync(path.join(target, '.nimi/app-scaffold/intent.json'), 'utf8'));
    assert.deepEqual(intent.features, ['kit-recipes']);
    assertGeneratedPathExists({ target }, 'src/capabilities/kit-recipes/index.tsx');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create accepts explicit identity and rewrites every Nimi Lab source identity literal', () => {
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
    assert.match(readFileSync(path.join(target, 'src/shell/auth/app-identity.ts'), 'utf8'), /appId = 'studio\.canvas'/);
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

test('unsupported app scaffold profiles, including the retired reference profile, are rejected', () => {
  for (const profile of ['unsupported-profile', RETIRED_REFERENCE_PROFILE]) {
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

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-retired-profile-'));
  try {
    const result = runNimiApp([
      'create', '--dir', path.join(tempRoot, 'app'), '--profile', RETIRED_REFERENCE_PROFILE,
    ], tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported app scaffold profile/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create rejects unknown and invalid feature selections', () => {
  const cases = [
    { features: 'future-capability', pattern: /Unknown app scaffold feature: future-capability/ },
    { features: 'all,ai-consume', pattern: /Feature selection "all" cannot be combined with explicit feature ids/ },
  ];
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-feature-rejection-'));
  try {
    for (const [index, testCase] of cases.entries()) {
      assert.throws(
        () => createAppScaffold({
          cwd: tempRoot,
          options: {
            dir: path.join(tempRoot, `app-${index}`),
            profile: 'standalone',
            features: testCase.features,
          },
          versions,
          createFileTree,
          ensureDirEmptyOrMissing: () => {},
          mkdirSync,
        }),
        testCase.pattern,
      );
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create deduplicates explicit features and records canonical catalog order', () => {
  const generated = scaffold('standalone', { features: 'kit-recipes,kit-recipes' });
  try {
    assert.deepEqual(generated.lock().features, ['kit-recipes']);
    assert.deepEqual(
      JSON.parse(generated.read('.nimi/app-scaffold/intent.json')).features,
      ['kit-recipes'],
    );
  } finally {
    generated.cleanup();
  }
});

test('create rejects catalog dependency cycles and target collisions', () => {
  const capability = (id, requires, targetRoot) => ({
    id,
    label: id,
    requires,
    appAccessItems: [],
    sourceRoot: `src/lab/capabilities/${id}`,
    targetRoot,
    componentExport: `${id.replaceAll('-', '')}Component`,
    npmDependencies: {},
  });
  const cycleCatalog = {
    alpha: capability('alpha', ['beta'], 'src/capabilities/alpha'),
    beta: capability('beta', ['alpha'], 'src/capabilities/beta'),
  };
  assert.throws(
    () => resolveAppScaffoldFeatures('alpha', cycleCatalog),
    /Capability dependency cycle: alpha -> beta -> alpha/,
  );
  assert.deepEqual(
    resolveAppScaffoldFeatures(['alpha', 'alpha'], {
      alpha: capability('alpha', [], 'src/capabilities/alpha'),
    }).featureIds,
    ['alpha'],
  );

  const collisionCatalog = {
    alpha: capability('alpha', [], 'src/capabilities/shared'),
    beta: capability('beta', [], 'src/capabilities/shared/nested'),
  };
  assert.throws(
    () => validateAppScaffoldCapabilityCatalog(collisionCatalog),
    /Capability target collision: alpha and beta/,
  );
});

test('unsupported app scaffold v1 lock and intent fail closed', () => {
  const legacyLock = cliScaffold('standalone');
  try {
    const lockPath = path.join(legacyLock.target, '.nimi/app-scaffold/lock.json');
    const lock = JSON.parse(legacyLock.read('.nimi/app-scaffold/lock.json'));
    lock.lockVersion = 1;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const result = runNimiApp(['doctor', '--dir', legacyLock.target], legacyLock.tempRoot, { env: legacyLock.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported scaffold lock version: 1/);
  } finally {
    legacyLock.cleanup();
  }

  const legacyIntent = cliScaffold('standalone');
  try {
    const intentPath = path.join(legacyIntent.target, '.nimi/app-scaffold/intent.json');
    const intent = JSON.parse(legacyIntent.read('.nimi/app-scaffold/intent.json'));
    intent.intentVersion = 1;
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
    const result = runNimiApp(['update', '--dir', legacyIntent.target], legacyIntent.tempRoot, { env: legacyIntent.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported scaffold intent version: 1/);
    assert.throws(
      () => buildAppScaffoldSnapshotFromIntent({ intent, versions }),
      /Unsupported scaffold intent version: 1/,
    );
  } finally {
    legacyIntent.cleanup();
  }
});

test('unknown create flags are rejected', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-cli-test-'));
  try {
    const result = runNimiApp(['create', '--dir', path.join(tempRoot, 'app'), '--unsupported', 'standalone'], tempRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown option/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('dev accepts the package-manager argument separator used by dev:shell', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-dev-separator-'));
  try {
    const result = runNimiApp(['dev', '--', '--shell', 'electron', '--cdp-port', '9334'], tempRoot);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /Unknown option: --/);
    assert.doesNotMatch(result.stderr, /Unknown option: --cdp-port/);
    assert.match(
      result.stderr,
      process.platform === 'win32' || process.platform === 'darwin'
        ? /nimi\.app\.yaml is required/
        : /not admitted on this platform/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('dev accepts only one explicit CDP port value', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-dev-cdp-'));
  try {
    const duplicate = runNimiApp([
      'dev',
      '--cdp-port',
      '9334',
      '--cdp-port',
      '9335',
    ], tempRoot);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /Duplicate option: --cdp-port/u);

    const missing = runNimiApp(['dev', '--cdp-port'], tempRoot);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /--cdp-port requires a value/u);
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

test('App access declaration activates the four canonical domains and keeps unknown items inert', () => {
  assert.deepEqual(APP_ACCESS_DOMAINS, [
    'realm.data',
    'runtime.consume',
    'agent.local',
    'agent.configure',
  ]);
  assert.deepEqual(resolveAppAccessDeclaration([]), { rawItems: [], activatedDomains: [] });
  assert.deepEqual(resolveAppAccessDeclaration([
    'runtime.consume',
    'future.experimental',
    'agent.local',
    'agent.configure',
  ]), {
    rawItems: ['runtime.consume', 'future.experimental', 'agent.local', 'agent.configure'],
    activatedDomains: ['runtime.consume', 'agent.local', 'agent.configure'],
  });
});

test('update regenerates App access from canonical selected features', () => {
  const generated = cliScaffold('standalone', [], testDir);
  try {
    const intentPath = path.join(generated.target, '.nimi/app-scaffold/intent.json');
    const intent = JSON.parse(generated.read('.nimi/app-scaffold/intent.json'));
    intent.appAccessItems = ['realm.data', 'future.experimental', 'agent.local', 'agent.configure'];
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
    let result = runNimiApp(['update', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(result.status, 0, result.stderr);
    result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      generated.read('nimi.app.yaml'),
      /^app_access: \[\]$/m,
    );
    const lock = JSON.parse(generated.read('.nimi/app-scaffold/lock.json'));
    assert.deepEqual(lock.features, []);
    assert.deepEqual(lock.appAccessItems, []);
    assert.deepEqual(resolveAppAccessDeclaration(lock.appAccessItems).activatedDomains, []);

    const validatorPath = path.join(generated.target, 'scripts/validate.mjs');
    const validation = runGeneratedNodeScript(generated, validatorPath);
    assert.equal(validation.status, 0, validation.stderr);
    assert.match(validation.stdout, /validate local-development checks passed/);
  } finally {
    generated.cleanup();
  }
});

test('doctor audits an existing submitted app without converting it into a managed scaffold', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-existing-doctor-'));
  const target = path.join(tempRoot, 'existing-app');
  const env = fakePnpmEnv(tempRoot);
  try {
    mkdirSync(path.join(target, 'src'), { recursive: true });
    writeFileSync(path.join(target, 'package.json'), `${JSON.stringify({
      name: 'existing-app',
      private: true,
      type: 'module',
      scripts: {
        dev: 'nimi-app dev --shell electron',
        'dev:shell': 'nimi-app dev',
        'dev:electron': 'nimi-app dev --shell electron',
        'dev:renderer': 'vite --host 127.0.0.1 --port 1468 --strictPort',
        'build:electron': 'tsc -p tsconfig.electron.json',
      },
    }, null, 2)}\n`);
    const manifestPath = path.join(target, 'nimi.app.yaml');
    const manifest = [
      'app_id: existing.app',
      'display_name: Existing App',
      'profile: standalone',
      'manifest_role: submitted-input',
      'app_access: []',
      'local_development:',
      '  electron:',
      '    renderer_origin: http://127.0.0.1:1468',
      '',
    ].join('\n');
    writeFileSync(manifestPath, manifest);
    writeFileSync(path.join(target, 'src', 'main.ts'), 'export const app = true;\n');
    writeFileSync(path.join(target, 'pnpm-lock.yaml'), "packages:\n  '@grpc/grpc-js@1.14.4': {}\n");

    let result = runNimiApp(['doctor', '--dir', target], tempRoot, { env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(target, '.nimi', 'app-scaffold', 'lock.json')), false);

    writeFileSync(manifestPath, manifest.replace(':1468', ':1469'));
    result = runNimiApp(['doctor', '--dir', target], tempRoot, { env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dev:renderer.*1469/);
    writeFileSync(manifestPath, manifest);

    writeFileSync(path.join(target, 'src', 'bypass.ts'), "import '@grpc/grpc-js';\n");
    result = runNimiApp(['doctor', '--dir', target], tempRoot, { env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /protected Runtime gRPC client/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('doctor fails closed on a missing scaffold lock', () => {
  const missingLock = cliScaffold('standalone');
  try {
    rmSync(path.join(missingLock.target, '.nimi/app-scaffold/lock.json'), { force: true });
    const result = runNimiApp(['doctor', '--dir', missingLock.target], missingLock.tempRoot, { env: missingLock.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing initialized scaffold lock/);
  } finally {
    missingLock.cleanup();
  }

});

test('doctor fails closed on provider/model hardcoding in product code but not in tests', () => {
  const cases = [
    "export const route = { provider: 'anthropic', model: 'gpt-4o' };\n",
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

  // The generated contract test ships a negative assertion that names providers;
  // it must not trip the product-truth hardcoding scan.
  const clean = cliScaffold('standalone');
  try {
    const result = runNimiApp(['doctor', '--dir', clean.target], clean.tempRoot, { env: clean.env });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    clean.cleanup();
  }
});

test('doctor fails closed on app-owned Realm permission grant shortcuts', () => {
  const cases = [
    { source: 'export async function bypass(realm) { return realm.permissionGrants.requestMyAppPermissionGrant({ path: {}, body: {} }); }\n', pattern: /Realm permission grant/ },
    { source: "export async function bypass() { return fetch('/api/human/me'); }\n", pattern: /Realm API/ },
    { source: "export const route = '/v1/chat/completions';\n", pattern: /OpenAI-compatible Runtime REST/ },
  ];
  for (const { source, pattern } of cases) {
    const generated = cliScaffold('standalone');
    try {
      writeFileSync(path.join(generated.target, 'src/shell/routes/product-area.tsx'), source);
      const result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0, source);
      assert.match(result.stderr, pattern, source);
    } finally {
      generated.cleanup();
    }
  }
});

test('doctor fails closed on installed-app custody bypasses', () => {
  const cases = [
    { source: "export const mode = 'ACCOUNT_CALLER_MODE_EXTERNAL_PRINCIPAL';\n", pattern: /external principal installed-app posture/ },
    { source: "import grpc from '@grpc/grpc-js';\nexport const client = grpc;\n", pattern: /protected Runtime gRPC client/ },
    { source: "localStorage.setItem('nimi-access-token', value);\n", pattern: /storage of protected material/ },
    { source: "export const command = 'auth.sessionLoad';\n", pattern: /forbidden installed-app shell capability/ },
  ];

  for (const { source, pattern } of cases) {
    const generated = cliScaffold('standalone');
    try {
      writeFileSync(path.join(generated.target, 'src/shell/routes/product-area.tsx'), source);
      const result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0, source);
      assert.match(result.stderr, pattern, source);
    } finally {
      generated.cleanup();
    }
  }
});

test('doctor requires official Desktop-supervised development scripts', () => {
  const cases = [
    {
      mutate(scripts) {
        scripts.dev = 'tauri dev';
      },
      pattern: /official local-development launcher|Electron development supervisor/,
    },
    {
      mutate(scripts) {
        scripts['dev:tauri'] = 'nimi-app dev --shell tauri';
      },
      pattern: /retired Tauri local-development carrier/,
    },
    {
      mutate(scripts) {
        scripts['dev:electron'] = 'electron dist-electron/main.js';
      },
      pattern: /official local-development launcher|Electron development supervisor/,
    },
  ];
  for (const testCase of cases) {
    const generated = cliScaffold('standalone');
    try {
      const packagePath = path.join(generated.target, 'package.json');
      const packageJson = JSON.parse(generated.read('package.json'));
      testCase.mutate(packageJson.scripts);
      writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
      const result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, testCase.pattern);
    } finally {
      generated.cleanup();
    }
  }
});

test('doctor rejects malformed App access declaration items', () => {
  const cases = [
    {
      replace: 'app_access: []',
      with: 'app_access:\n  domain: realm.data',
      pattern: /App access declaration must be an array/,
    },
    {
      replace: 'app_access: []',
      with: 'app_access:\n  - realm.data\n  - realm.data',
      pattern: /Duplicate App access declaration item/,
    },
    {
      replace: 'app_access: []',
      with: 'app_access:\n  - " realm.data"',
      pattern: /Invalid App access declaration item/,
    },
  ];
  for (const testCase of cases) {
    const generated = cliScaffold('standalone');
    try {
      const manifestPath = path.join(generated.target, 'nimi.app.yaml');
      const nextManifest = generated.read('nimi.app.yaml').replace(testCase.replace, testCase.with);
      writeFileSync(manifestPath, nextManifest);
      const result = runNimiApp(['doctor', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0, testCase.with);
      assert.match(result.stderr, testCase.pattern, testCase.with);
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

test('app source resolves only scaffoldable slices from live Nimi Lab and is packaged via prepack', () => {
  const packageJson = JSON.parse(readFileSync(path.join(testDir, '..', 'package.json'), 'utf8'));
  // The snapshot is a gitignored build artifact baked into the tarball at pack.
  assert.ok(packageJson.files.includes('templates'));
  assert.ok(packageJson.files.includes('scripts'));
  assert.equal(
    packageJson.scripts.prepack,
    'node scripts/sync-app-source.mjs --apply',
  );
  assert.equal(
    packageJson.scripts.prepublishOnly,
    'node scripts/sync-app-source.mjs --apply',
  );

  // In the monorepo there is no baked snapshot; the generator reads only admitted slices from apps/lab.
  const { baseDir, manifest } = resolveAppSource();
  assert.match(baseDir, /apps[/\\]lab$/);
  assert.equal(manifest.sourceApp, 'apps/lab');
  assert.equal(manifest.sourceIdentity.appId, 'nimi.lab');
  assert.equal(manifest.sourceIdentity.packageName, '@nimiplatform/lab');
  assert.equal(manifest.sourceIdentity.tauriIdentifier, 'ai.nimi.apps.nimi.lab');
  assert.equal(manifest.sourceIdentity.cargoPackageName, 'nimiapp-lab-shell');
  assert.equal(manifest.sourceIdentity.rendererEntryId, 'lab-app');
  assert.equal(manifest.sourceIdentity.appTitle, 'Nimi Lab');
  assert.deepEqual(
    manifest.files.map((entry) => entry.path),
    [
      'src/lab/capabilities/kit-recipes/gallery.tsx',
      'src/lab/capabilities/kit-recipes/index.tsx',
      'src/lab/capabilities/kit-recipes/kit-component-gallery-data-recipes.tsx',
      'src/lab/capabilities/kit-recipes/kit-component-gallery-demos.tsx',
      'src/lab/capabilities/kit-recipes/kit-component-gallery-recipes.tsx',
      'src/lab/capabilities/kit-recipes/kit-component-gallery-surface.tsx',
    ],
  );
  assert.ok(manifest.files.every((entry) => entry.class === 'app-owned product code'));
  assert.deepEqual(APP_SCAFFOLD_FEATURE_IDS, ['kit-recipes']);
});

test('generated scaffold mechanically excludes forbidden shortcuts', () => {
  const generated = scaffold('standalone');
  try {
    assert.match(generated.read('.gitignore'), /^node_modules\/$/m);
    assert.match(generated.read('.gitignore'), /^\.nimi\/local\/$/m);
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
      '/api/human/me/permission-grants',
      'requestMyAppPermissionGrant(',
      "fetch('/api/",
      '/v1/chat/completions',
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

test('default profiles generate local-app carrier boundaries without Lab-only or fixture truth', () => {
  for (const profile of ['standalone', 'workspace-app']) {
    const generated = scaffold(profile);
    try {
      const runtimePlatform = generated.read('src/shell/auth/runtime-platform.ts');
      const localAppClient = generated.read('src/shell/auth/local-app-client.ts');
      const authGate = generated.read('src/shell/auth/auth-gate.tsx');
      const main = generated.read('src/main.tsx');
      const joined = [runtimePlatform, localAppClient, authGate, main].join('\n');

      assert.doesNotMatch(runtimePlatform, /developer-registered-local-app|developerRegistration/, `${profile} must not retain developer registration`);
      assert.match(runtimePlatform, /'local-app'/, `${profile} keeps the final local-app mode`);
      assert.match(runtimePlatform, /getNimiLocalAppClient/, `${profile} must consume the final SDK client`);
      assert.match(localAppClient, /createNimiClient/, `${profile} must consume the SDK local-app owner surface`);
      assert.match(localAppClient, /createNimiLocalAppStandardShellSurface/, `${profile} must compose the Kit local-app shell`);
      assert.match(runtimePlatform, /!status\.sessionBound/, `${profile} must require a bound local-app session without conflating permissions`);
      assert.doesNotMatch(runtimePlatform, /createNimiClient|RuntimeOptions|runtime\.account|runtime\.ai|bootstrapArtifact/i, `${profile} must keep non-carrier operations absent`);

    } finally {
      generated.cleanup();
    }
  }
});
