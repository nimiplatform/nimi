import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { APP_ACCESS_DOMAINS, resolveAppAccessDeclaration } from '../lib/app-access-declaration.mjs';
import {
  assertIdentityNeutralProductSource,
  buildAppScaffoldCandidateCreatePlan,
  buildAppScaffoldCandidateSnapshot,
  buildAppScaffoldSnapshot,
  buildAppScaffoldSnapshotFromIntent,
  createAppScaffold,
  createAppScaffoldCandidate,
  renderCargoDependencyValue,
  resolveAppScaffoldCreateInput,
  SCAFFOLD_INTENT_PATH,
  SCAFFOLD_INTENT_VERSION,
  SCAFFOLD_LOCK_PATH,
  SCAFFOLD_LOCK_VERSION,
  SCAFFOLD_VERSION,
  SUPPORTED_APP_SCAFFOLD_PROFILES,
  validateScaffoldFileOwnership,
} from '../lib/app-scaffold.mjs';
import {
  APP_SCAFFOLD_MODULE_REGISTRY,
  APP_SCAFFOLD_FEATURE_IDS,
  APP_SCAFFOLD_REFERENCE_APP_FEATURE_IDS,
  resolveAppScaffoldCandidateFeatures,
  resolveAppScaffoldFeatures,
  resolveAppScaffoldIntentFeatures,
  validateAppScaffoldCargoDependencyValue,
  validateAppScaffoldModuleRegistry,
} from '../lib/app-scaffold-capabilities.mjs';
import { initApp } from '../lib/app-doctor-update.mjs';
import { resolveAppCreatePlan, resolveCandidateAppCreatePlan } from '../lib/index.mjs';
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
  lucideReactVersion: '0.577.0',
  nodeTypesVersion: '24.0.0',
  reactTypesVersion: '19.0.0',
  reactDomTypesVersion: '19.0.0',
  viteVersion: '7.0.0',
  viteReactPluginVersion: '5.0.0',
  tailwindcssVersion: '4.0.0',
  tailwindcssViteVersion: '4.0.0',
  tauriCliVersion: '2.0.0-cli',
  nimiShellTauriVersion: '0.2.0',
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

function candidateSnapshot(features) {
  return buildAppScaffoldCandidateSnapshot({
    profile: 'standalone',
    versions,
    appId: 'candidate.target',
    appTitle: 'Candidate Target',
    packageName: 'candidate-target',
    features,
  });
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
  writeInstalledLock(target);
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

function writeInstalledLock(target) {
  const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  const importer = {};
  for (const sectionName of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const entries = Object.entries(packageJson[sectionName] || {});
    if (entries.length === 0) continue;
    importer[sectionName] = Object.fromEntries(entries.map(([name, specifier]) => [name, { specifier, version: specifier }]));
  }
  writeFileSync(path.join(target, 'pnpm-lock.yaml'), stringifyYaml({
    lockfileVersion: '9.0',
    importers: { '.': importer },
  }));
  const cargo = readFileSync(path.join(target, 'src-tauri', 'Cargo.toml'), 'utf8');
  const shellVersion = cargo.match(/^nimi-shell-tauri\s*=\s*"([^"]+)"$/mu)?.[1];
  assert.ok(shellVersion, 'generated Cargo manifest must use a registry nimi-shell-tauri version');
  writeFileSync(path.join(target, 'src-tauri', 'Cargo.lock'), [
    'version = 4',
    '',
    '[[package]]',
    'name = "nimi-shell-tauri"',
    `version = "${shellVersion}"`,
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    `checksum = "${'a'.repeat(64)}"`,
    '',
  ].join('\n'));
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
    assert.equal(packageJson.version, '0.1.0');
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.packageManager, versions.packageManager);
    assert.equal(Object.hasOwn(packageJson, 'publishConfig'), false);
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], versions.kitVersion);
    for (const dependency of ['i18next', 'lucide-react', 'react-i18next', '@tauri-apps/api']) {
      assert.equal(Object.hasOwn(packageJson.dependencies, dependency), false);
    }
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], versions.appToolsVersion);
    assert.equal(Object.hasOwn(packageJson.devDependencies, '@types/three'), false);
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
    assert.match(generated.read('src/shell/auth/app-identity.ts'), /appId = "acme\.widget"/);
    assert.match(generated.read('src/shell/auth/runtime-platform.ts'), /import \{ appId \} from '\.\/app-identity\.js'/);
    const tauri = JSON.parse(generated.read('src-tauri/tauri.conf.json'));
    assert.equal(tauri.identifier, 'ai.nimi.apps.acme.widget');
    assert.equal(tauri.productName, 'Acme Widget');
    assert.equal(tauri.build.devUrl, `http://127.0.0.1:${devPort}`);
    assert.match(generated.read('src-tauri/Cargo.toml'), /name = "acme-widget-shell"/);
    assert.ok(generated.read('src-tauri/Cargo.toml').includes(`nimi-shell-tauri = "${versions.nimiShellTauriVersion}"`));
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
    assert.match(generated.read('src/shell/routes/product-area.tsx'), /WorkbenchCore/);
    assert.match(generated.read('src/shell/routes/product-area.tsx'), /WorkbenchEmptyState/);
    assert.doesNotMatch(generated.read('src/shell/routes/product-area.tsx'), /LabWorkbench|WorldTourViewerRoute/);
    assert.doesNotMatch(generated.read('src/shell/routes/product-area.tsx'), /DemoSurfaces|Kit Demo/);
    assert.match(generated.read('src/main.tsx'), /entry:acme-widget-app/);
    assert.doesNotMatch(generated.read('vite.config.ts'), /repoRoot|path\.join\(repoRoot|\.\.\/\.\.\/kit|kit\/ui\/src/);
    assert.match(generated.read('vite.config.ts'), /cacheDir: '\.vite'/);
    assert.doesNotMatch(generated.read('src-tauri/src/main.rs'), /lab_storage|world_tour|lab_/);
    assertGeneratedPathMissing(generated, 'src/lab');
    assertGeneratedPathMissing(generated, 'src/capabilities');
    assertGeneratedPathExists(generated, 'src/workbench-core/workbench-core.tsx');
    assertGeneratedPathExists(generated, 'src/workbench-core/runtime-gate.tsx');
    assertGeneratedPathMissing(generated, 'src/shell/ai');
    assertGeneratedPathMissing(generated, 'src/shell/routes/settings.tsx');
    assertGeneratedPathMissing(generated, 'src/shell/routes/settings');
    assertGeneratedPathMissing(generated, 'src-tauri/src/world_tour.rs');
    assertGeneratedPathExists(generated, 'src-electron/main.ts');
    assertGeneratedPathExists(generated, 'src-electron/preload.cts');
    assertGeneratedPathMissing(generated, 'dist-electron');
    assertGeneratedPathMissing(generated, 'test/lab-contract.test.mjs');
    assertGeneratedPathMissing(generated, 'ADMISSION.md');
    assertGeneratedPathExists(generated, '.nimi/admission/submission.yaml');
    assertGeneratedPathExists(generated, '.nimi/config/build-profile.yaml');
    assertGeneratedPathExists(generated, '.github/workflows/nimi-app-release.yml');

    // Taxonomy: product source and developer-owned package/build/submission inputs remain editable.
    const lock = generated.lock();
    const appOwned = lock.managedFileTaxonomy.appOwnedProductCode;
    assert.ok(appOwned.includes('src/shell/routes/product-area.tsx'));
    assert.ok(appOwned.includes('src/workbench-core/workbench-core.tsx'));
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
    assert.match(electronMain, /app\.setAppUserModelId\(NATIVE_BUNDLE_IDENTIFIER\)/);
    assert.doesNotMatch(electronMain, /onProtectedSessionFailure/);
    assert.doesNotMatch(electronMain, /runtimeEndpoint|sessionProof|launchTicket/);
    assert.match(generated.read('src-tauri/src/main.rs'), /RuntimeBridgeLocalAppHost::platform_default\(\)/);
    assert.equal(lock.managedFileHashes['src/shell/workbench-target-adapter.ts'].class, 'scaffold-managed glue');
    assert.equal(Object.hasOwn(lock.managedFileHashes, 'src/shell/auth/auth-gate.tsx'), false);
    assert.equal(lock.appOwnedInitialHashes['package.json'].class, 'app-owned product code');
    assert.equal(lock.appOwnedInitialHashes['.nimi/config/build-profile.yaml'].class, 'app-owned product code');
    assert.equal(lock.appOwnedInitialHashes['.nimi/admission/submission.yaml'].class, 'app-owned product code');
    assert.equal(lock.managedFileHashes['.github/workflows/nimi-app-release.yml'].class, 'scaffold-managed glue');
    const workflowSource = generated.read('.github/workflows/nimi-app-release.yml');
    const workflow = parseYaml(workflowSource);
    assert.deepEqual(workflow.on.push.tags, ['v*']);
    assert.deepEqual(workflow.on.workflow_dispatch, {});
    assert.match(workflowSource, /pack --target \$env:NIMI_APP_TARGET --production/u);
    assert.match(workflowSource, /actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/u);
    assert.doesNotMatch(workflowSource, /^\s*- uses: [^\s]+@v\d+/mu);
    assert.equal((workflowSource.match(/persist-credentials: false/gu) ?? []).length, 3);
    assert.doesNotMatch(workflowSource, /run: .*\$\{\{ matrix\.target \}\}/u);
    assert.match(workflowSource, /gh release create/u);
    assert.match(workflowSource, /git status --porcelain/u);
    assert.equal((workflowSource.match(/git status --porcelain/gu) ?? []).length, 2);
    assert.doesNotMatch(workflowSource, /git diff --exit-code/u);
    assert.match(workflowSource, /github\.event_name == 'push' && github\.ref_type == 'tag'/u);
    assert.doesNotMatch(workflowSource, /^\s*if:\s*github\.ref_type == 'tag'\s*$/mu);
    assert.deepEqual(workflow.jobs['build-target'].permissions, { contents: 'read' });
    const productionBuild = workflow.jobs['build-target'].steps.find((step) => step.name === 'Build and sign production target');
    assert.match(productionBuild.if, /event_name == 'push'/u);
    assert.match(productionBuild.run, /build --target .* --production/u);
    const developmentBuild = workflow.jobs['build-target'].steps.find((step) => step.name === 'Build development target');
    assert.deepEqual(developmentBuild.env, { NIMI_APP_TARGET: '${{ matrix.target }}' });
    assert.doesNotMatch(developmentBuild.run, /--production/u);
    assert.equal(workflow.jobs['attest-target'].permissions['id-token'], 'write');
    assert.equal(workflow.jobs.release.needs.includes('attest-target'), true);
    assert.match(workflowSource, /repos\/\$GITHUB_REPOSITORY\/immutable-releases/u);
    assert.match(workflowSource, /index\("creation"\).*index\("update"\).*index\("deletion"\)/u);
    assert.match(workflowSource, /conditions\.ref_name\.exclude/u);
    assert.match(workflowSource, /release_json=.*releases\/tags/u);
    assert.doesNotMatch(workflowSource, /candidate-uploads|Account|Bearer|--clobber|publish:\s*true/u);
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

test('standalone scaffold base remains empty while the public catalog exposes the admitted features', () => {
  assert.deepEqual(SUPPORTED_APP_SCAFFOLD_PROFILES, ['standalone']);
  assert.deepEqual(APP_SCAFFOLD_FEATURE_IDS, [
    'studio-create',
    'studio-media',
    'studio-voice',
    'kit-recipes',
    'agent-center',
    'agent-conversation',
    'agent-realtime',
  ]);
  const generated = scaffold('standalone');
  try {
    assertGeneratedPathMissing(generated, 'src/capabilities');
    assertGeneratedPathMissing(generated, 'src/scaffold/generated/host-adapters.tsx');
    assert.equal(generated.read('src/scaffold/generated/module-styles.css'), '');
    assert.match(generated.read('src/scaffold/generated/navigation.ts'), /generatedInitialViewId = generatedNavigationGroups\[0\]\?\.items\[0\]\?\.id \?\? null/);
    for (const relativePath of [
      'src/scaffold/generated/capability-registry.ts',
      'src/scaffold/generated/runtime-registry.ts',
      'src/scaffold/generated/route-registry.tsx',
      'src/scaffold/generated/navigation.ts',
      'src/scaffold/generated/module-styles.css',
    ]) {
      assert.doesNotMatch(generated.read(relativePath), /from ['"].*(?:ai-studio-core|studio-create|studio-media|studio-voice)/);
    }
    assert.match(generated.read('nimi.app.yaml'), /^app_access: \[\]$/m);
    const intent = JSON.parse(generated.read('.nimi/app-scaffold/intent.json'));
    const lock = generated.lock();
    assert.equal(intent.intentVersion, SCAFFOLD_INTENT_VERSION);
    assert.equal(lock.lockVersion, SCAFFOLD_LOCK_VERSION);
    assert.equal(intent.scaffoldVersion, SCAFFOLD_VERSION);
    assert.equal(lock.scaffoldVersion, SCAFFOLD_VERSION);
    assert.deepEqual(intent.features, []);
    assert.deepEqual(intent.directFeatures, []);
    assert.deepEqual(intent.resolvedModules, []);
    assert.deepEqual(lock.features, []);
    assert.deepEqual(lock.directFeatures, []);
    assert.deepEqual(lock.resolvedModules, []);
    assert.deepEqual(lock.appAccessItems, []);
    assert.equal(lock.dependencyMatrix.toolchain.node, '>=24');
    assert.equal(lock.dependencyMatrix.toolchain.pnpm, versions.packageManager.replace(/^pnpm@/u, ''));
  } finally {
    generated.cleanup();
  }
});

test('standalone scaffold exposes every admitted feature while keeping internal modules private', () => {
  assert.deepEqual(
    resolveAppScaffoldFeatures('all').directFeatureIds,
    [
      'studio-create', 'studio-media', 'studio-voice', 'kit-recipes',
      'agent-center', 'agent-conversation', 'agent-realtime',
    ],
  );
  for (const featureId of APP_SCAFFOLD_FEATURE_IDS) {
    assert.deepEqual(resolveAppScaffoldFeatures(featureId).directFeatureIds, [featureId]);
  }
  assert.throws(
    () => resolveAppScaffoldFeatures('ai-studio-core'),
    /App scaffold internal module cannot be selected directly/,
  );
  assert.throws(
    () => resolveAppScaffoldFeatures('ai-consume'),
    /Unknown app scaffold feature: ai-consume/,
  );
});

test('selected feature closure projects exact capability review inputs', () => {
  const generated = scaffold('standalone', { features: ['studio-create'] });
  try {
    const submission = parseYaml(generated.read('.nimi/admission/submission.yaml'));
    assert.deepEqual(submission.capability_contract_refs, ['text.generate', 'text.embed']);
    assert.deepEqual(submission.required_standardized_feature_refs, []);
    assert.deepEqual(generated.lock().capabilityContractRefs, ['text.generate', 'text.embed']);
  } finally {
    generated.cleanup();
  }
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

test('dotted app id maps losslessly to the Tauri bundle identifier', () => {
  const generated = scaffold('standalone', {
    appId: 'acme.widget',
    title: 'Acme Widget',
    packageName: 'acme-widget',
  });
  try {
    assert.match(generated.read('nimi.app.yaml'), /app_id: acme\.widget/);
    assert.match(generated.read('src/shell/auth/app-identity.ts'), /appId = "acme\.widget"/);
    const tauri = JSON.parse(generated.read('src-tauri/tauri.conf.json'));
    assert.equal(tauri.identifier, 'ai.nimi.apps.acme.widget');
  } finally {
    generated.cleanup();
  }
});

test('identity replacement never reprocesses target values containing starter literals', () => {
  const generated = scaffold('standalone', {
    appId: 'acme.widget2',
    title: 'Acme Widget2',
    packageName: 'acme-widget2',
  });
  try {
    assert.equal(generated.lock().appIdentity.cargoPackageName, 'acme-widget2-shell');
    assert.match(generated.read('src-tauri/Cargo.toml'), /^name = "acme-widget2-shell"$/m);
    assert.doesNotMatch(generated.read('src-tauri/Cargo.toml'), /acme-widget222-shell/);
    assert.match(generated.read('README.md'), /Acme Widget2/);
    assert.doesNotMatch(generated.read('README.md'), /Acme Widget22/);
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

test('standalone scaffold always uses public dependency declarations', () => {
  const generated = scaffold('standalone');
  try {
    const packageJson = JSON.parse(generated.read('package.json'));
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], versions.sdkVersion);
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], versions.kitVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], versions.appToolsVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/nimi-coding'], versions.nimicodingVersion);
    assert.equal(packageJson.devDependencies.yaml, versions.yamlVersion);
    assert.ok(generated.read('src-tauri/Cargo.toml').includes(`nimi-shell-tauri = "${versions.nimiShellTauriVersion}"`));
    assert.doesNotMatch(generated.read('vite.config.ts'), /repoRoot|path\.join\(repoRoot|\.\.\/\.\.\/kit|kit\/ui\/src/);
    assert.match(generated.read('nimi.app.yaml'), /profile: standalone/);
    assert.match(generated.read('src/shell/auth/app-identity.ts'), /scaffoldProfile = "standalone"/);
    assert.match(generated.read('README.md'), /Profile: `standalone`/);
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
    const rootPackageJson = JSON.parse(readFileSync(path.join(testDir, '..', '..', 'package.json'), 'utf8'));
    const expectedAppToolsVersion = `^${appToolsPackageJson.version}`;
    const expectedSdkVersion = appToolsPackageJson.nimiScaffoldVersions.sdkVersion;
    const expectedKitVersion = appToolsPackageJson.nimiScaffoldVersions.kitVersion;
    const expectedNimicodingVersion = appToolsPackageJson.nimiScaffoldVersions.nimicodingVersion;
    assert.equal(expectedNimicodingVersion, rootPackageJson.devDependencies['@nimiplatform/nimi-coding']);
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], expectedSdkVersion);
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], expectedKitVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], expectedAppToolsVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/nimi-coding'], expectedNimicodingVersion);
    assert.equal(packageJson.devDependencies.yaml, '^2.9.0');
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/sdk'], expectedSdkVersion);
    assert.equal(lock.dependencyMatrix.npm['@nimiplatform/app-tools'], expectedAppToolsVersion);
    assert.equal(lock.dependencyMatrix.npm.yaml, '^2.9.0');
  } finally {
    generated.cleanup();
  }
});

test('cli help projects the current registry lifecycle and honest workflow without running lifecycle commands', () => {
  const result = runNimiApp(['--help'], testDir);
  assert.equal(result.status, 0, result.stderr);
  const help = result.stdout;
  for (const expected of [
    'Admitted features: studio-create (Create), studio-media (Media), studio-voice (Voice), kit-recipes (UI Recipes), agent-center (Agent Center), agent-conversation (Agent Conversation), agent-realtime (Agent Realtime)',
    'studio-create (Create)',
    'studio-media (Media)',
    'studio-voice (Voice)',
    'kit-recipes (UI Recipes)',
    'Candidate features (not public-selectable): (none)',
    'Internal modules (dependency-only): ai-studio-core',
    '--features all expands in order to: studio-create, studio-media, studio-voice, kit-recipes, agent-center, agent-conversation, agent-realtime',
    'nimi-app check [--dir path] [--conformance simulator | --production] [--json]',
    '--author person-or-team',
    'identity-neutral Lab-derived workbench-core',
    'standalone: any empty target directory using public registry package versions only.',
    'Nimi workspace paths, local tarballs, downgrades, and private validation topology are never public create modes.',
    'App-owned: workbench-core and selected module product code',
    'Scaffold-managed: carrier, identity, manifest/native wiring, and generated composition glue.',
    'create -> dependency install -> init -> sync -> check -> dev/test/build -> pack',
    'remain NOT-VERIFIED',
  ]) {
    assert.match(help, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(help, /workspace-app|direct apps\/\*/u);

  const readme = readFileSync(path.join(testDir, '..', 'README.md'), 'utf8');
  const starterReadme = readFileSync(path.join(testDir, '..', 'templates', 'default-starter', 'README.md'), 'utf8');
  const starterAgents = readFileSync(path.join(testDir, '..', 'templates', 'default-starter', 'AGENTS.md'), 'utf8');
  for (const content of [readme, starterReadme, starterAgents]) {
    assert.match(content, /NOT-VERIFIED/u);
    assert.doesNotMatch(content, /conformance simulator|Simulator/u);
  }
  assert.match(readme, /author.*person.*team/isu);
  assert.match(readme, /third-party[\s\S]*public npm and Cargo dependency versions/iu);
  assert.match(readme, /non-public validation topology[\s\S]*not a public profile/u);
  assert.match(starterReadme, /App-owned product code/u);
  assert.match(starterAgents, /create -> dependency install -> init -> sync -> check -> dev\/test\/build -> pack/u);
  for (const content of [readme, starterReadme]) {
    const installAt = content.indexOf('pnpm install');
    const initAt = content.indexOf('pnpm run init');
    const syncAt = content.indexOf('pnpm run sync');
    const checkAt = content.indexOf('pnpm run check');
    const buildAt = content.indexOf('pnpm run app:build');
    const devAt = content.indexOf('pnpm dev');
    assert.ok(installAt > -1 && installAt < initAt, 'install must be documented before init');
    assert.ok(initAt < syncAt, 'init must be documented before sync');
    assert.ok(syncAt < checkAt, 'sync must be documented before check');
    assert.ok(checkAt < buildAt, 'check must be documented before build');
    assert.ok(buildAt < devAt, 'build must be documented before dev');
  }
});

test('cli standalone scaffold expands all to the admitted ordered set', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-all-'));
  const target = path.join(tempRoot, 'app');
  try {
    const result = runNimiApp([
      'create', '--dir', target, '--profile', 'standalone', '--features', 'all',
    ], tempRoot);
    assert.equal(result.status, 0, result.stderr);
    const intent = JSON.parse(readFileSync(path.join(target, SCAFFOLD_INTENT_PATH), 'utf8'));
    assert.deepEqual(intent.directFeatures, [
      'studio-create',
      'studio-media',
      'studio-voice',
      'kit-recipes',
      'agent-center',
      'agent-conversation',
      'agent-realtime',
    ]);
    assert.deepEqual(intent.resolvedModules, [
      'ai-studio-core',
      'studio-create',
      'studio-media',
      'studio-voice',
      'kit-recipes',
      'agent-center',
      'agent-conversation',
      'agent-realtime',
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create accepts explicit identity through structured carrier surfaces and canonical lock state', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-identity-'));
  const target = path.join(tempRoot, 'app');
  const env = fakePnpmEnv(tempRoot);
  try {
    const result = runNimiApp([
      'create', '--dir', target, '--profile', 'standalone',
      '--app-id', 'studio.canvas', '--title', 'Studio Canvas', '--package-name', 'studio-canvas',
    ], tempRoot, { env });
    assert.equal(result.status, 0, result.stderr);
    writeInstalledLock(target);
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
    assert.match(readFileSync(path.join(target, 'src/shell/auth/app-identity.ts'), 'utf8'), /appId = "studio\.canvas"/);
    assert.match(readFileSync(path.join(target, 'src-tauri/Cargo.toml'), 'utf8'), /name = "studio-canvas-shell"/);

    const doctor = runNimiApp(['check', '--dir', target], tempRoot, { env });
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
    writeInstalledLock(target);
    const init = runNimiApp(['init', '--dir', target], tempRoot, { env });
    assert.equal(init.status, 0, init.stderr);

    const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(path.join(target, '.nimi/app-scaffold/lock.json'), 'utf8'));
    assert.equal(packageJson.name, '@studio/canvas');
    assert.equal(packageJson.author, 'Studio Maintainers');
    assert.equal(lock.cargoPackageName, 'studio-canvas-shell');
    assert.match(readFileSync(path.join(target, 'src-tauri/Cargo.toml'), 'utf8'), /name = "studio-canvas-shell"/);

    const doctor = runNimiApp(['check', '--dir', target], tempRoot, { env });
    assert.equal(doctor.status, 0, doctor.stderr);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create accepts equivalent TTY-answer and flag input through one canonical resolver', () => {
  const raw = {
    dir: 'apps/studio-canvas',
    profile: 'standalone',
    appId: 'studio.canvas',
    title: 'Studio: Canvas #1',
    packageName: '@studio/canvas',
    author: 'Studio Team',
    features: '',
  };
  const ttyResolved = resolveAppScaffoldCreateInput({ cwd: 'D:/repo', options: { ...raw } });
  const flagsResolved = resolveAppScaffoldCreateInput({ cwd: 'D:/repo', options: { ...raw } });
  assert.deepEqual(ttyResolved, flagsResolved);
  assert.deepEqual(ttyResolved.directFeatures, []);
  assert.deepEqual(ttyResolved.resolvedModules, []);
});

test('create accepts safely serialized Display Name and one person-or-team author field', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-safe-identity-'));
  const target = path.join(tempRoot, 'app');
  const displayName = 'Studio: Canvas # "Prime" & <One>';
  try {
    const result = runNimiApp([
      'create', '--dir', target, '--profile', 'standalone',
      '--app-id', 'studio.canvas', '--title', displayName,
      '--package-name', '@studio/canvas', '--author', 'Studio Team',
    ], tempRoot);
    assert.equal(result.status, 0, result.stderr);
    const manifest = parseYaml(readFileSync(path.join(target, 'nimi.app.yaml'), 'utf8'));
    const tauri = JSON.parse(readFileSync(path.join(target, 'src-tauri/tauri.conf.json'), 'utf8'));
    const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    const identityModule = readFileSync(path.join(target, 'src/shell/auth/app-identity.ts'), 'utf8');
    const intent = JSON.parse(readFileSync(path.join(target, '.nimi/app-scaffold/intent.json'), 'utf8'));
    assert.equal(manifest.display_name, displayName);
    assert.equal(tauri.productName, displayName);
    assert.equal(tauri.app.windows[0].title, displayName);
    assert.equal(packageJson.author, 'Studio Team');
    assert.match(identityModule, new RegExp(`appTitle = ${JSON.stringify(displayName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(intent.appIdentity.displayName, displayName);
    assert.equal(intent.appIdentity.nativeBundleIdentifier, 'ai.nimi.apps.studio.canvas');
    assert.equal(Object.hasOwn(intent, 'team'), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create rejects every reserved Nimi Lab identity before target materialization', () => {
  const cases = [
    { appId: 'nimi.lab', title: 'Example App', packageName: 'example-app' },
    { appId: 'example.app', title: 'Nimi Lab', packageName: 'example-app' },
    { appId: 'example.app', title: 'Example App', packageName: '@nimiplatform/lab' },
    { appId: 'example.app', title: 'Example App', packageName: 'nimiapp-lab' },
  ];
  for (const [index, identity] of cases.entries()) {
    const events = [];
    assert.throws(
      () => createAppScaffold({
        cwd: os.tmpdir(),
        options: { dir: `reserved-lab-${index}`, profile: 'standalone', ...identity },
        versions,
        createFileTree: () => events.push('write'),
        ensureDirEmptyOrMissing: () => events.push('ensure'),
        mkdirSync: () => events.push('mkdir'),
      }),
      /Nimi Lab canonical identity is reserved/,
    );
    assert.deepEqual(events, []);
  }
});

test('create accepts third-party workspaces without reading unrelated sibling App manifests', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-port-collision-'));
  const existingDir = path.join(tempRoot, 'apps', 'existing');
  const target = path.join(tempRoot, 'apps', 'new-app');
  try {
    writeFileSync(path.join(tempRoot, 'pnpm-workspace.yaml'), [
      'packages:',
      "  - 'apps/*'",
      "  - 'kit'",
      "  - 'app-tools'",
      "  - 'sdks/typescript'",
      '',
    ].join('\n'));
    mkdirSync(existingDir, { recursive: true });
    mkdirSync(path.join(tempRoot, 'kit', 'shell', 'tauri'), { recursive: true });
    writeFileSync(path.join(existingDir, 'nimi.app.yaml'), [
      'app_id: existing.app',
      'display_name: Existing App',
      'version: 0.1.0',
      'local_development:',
      '  electron:',
      '    renderer_origin: not-a-url',
      '',
    ].join('\n'));
    const plan = resolveAppCreatePlan(tempRoot, {
      dir: target,
      profile: 'standalone',
      appId: 'collision.app',
      title: 'Collision App',
      packageName: 'collision-app',
    });
    assert.deepEqual(plan.preview.topology, { profile: 'standalone' });
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('standalone scaffold CLI accepts arbitrary repositories and hard-cuts workspace-app', () => {
  const thirdPartyRepo = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-third-party-repo-'));
  try {
    const target = path.join(thirdPartyRepo, 'packages', 'third-party-app');
    const created = runNimiApp([
      'create', '--dir', target, '--profile', 'standalone',
      '--app-id', 'third.party', '--title', 'Third Party', '--package-name', 'third-party',
    ], thirdPartyRepo);
    assert.equal(created.status, 0, created.stderr);
    const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    const scaffoldVersions = JSON.parse(readFileSync(path.join(testDir, '..', 'package.json'), 'utf8')).nimiScaffoldVersions;
    assert.equal(packageJson.dependencies['@nimiplatform/sdk'], scaffoldVersions.sdkVersion);
    assert.equal(packageJson.dependencies['@nimiplatform/kit'], scaffoldVersions.kitVersion);
    assert.equal(packageJson.devDependencies['@nimiplatform/app-tools'], scaffoldVersions.appToolsVersion);
    assert.ok(
      readFileSync(path.join(target, 'src-tauri', 'Cargo.toml'), 'utf8')
        .includes(`nimi-shell-tauri = "${scaffoldVersions.nimiShellTauriVersion}"`),
    );
  } finally {
    rmSync(thirdPartyRepo, { recursive: true, force: true });
  }

  const retired = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-retired-workspace-profile-'));
  try {
    const target = path.join(retired, 'app');
    const result = runNimiApp(['create', '--dir', target, '--profile', 'workspace-app'], retired);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported app scaffold profile: workspace-app/);
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(retired, { recursive: true, force: true });
  }
});

test('candidate high-level plan reuses standalone output without exposing a workspace profile', () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-candidate-workspace-plan-'));
  const target = path.join(workspace, 'apps', 'candidate');
  try {
    writeFileSync(path.join(workspace, 'pnpm-workspace.yaml'), [
      'packages:',
      "  - 'apps/*'",
      "  - 'kit'",
      "  - 'app-tools'",
      "  - 'sdks/typescript'",
      '',
    ].join('\n'));
    const options = {
      dir: target,
      profile: 'standalone',
      appId: 'candidate.workspace',
      title: 'Candidate Workspace',
      packageName: 'candidate-workspace',
    };
    const publicPlan = resolveAppCreatePlan(workspace, options);
    const candidatePlan = resolveCandidateAppCreatePlan(workspace, {
      ...options,
      features: ['studio-create'],
    });
    assert.deepEqual(candidatePlan.preview.topology, { profile: 'standalone' });
    assert.deepEqual(candidatePlan.preview.topology, publicPlan.preview.topology);
    assert.equal(candidatePlan.resolvedInput.targetDir, target);
    assert.equal(candidatePlan.preview.profile, 'standalone');
    assert.equal(
      candidatePlan.preview.cargoDependencies['nimi-shell-tauri'],
      JSON.parse(readFileSync(path.join(testDir, '..', 'package.json'), 'utf8')).nimiScaffoldVersions.nimiShellTauriVersion,
    );
    assert.equal(candidatePlan.preview.identity.devPort, publicPlan.preview.identity.devPort);
    assert.deepEqual(candidatePlan.preview.directFeatures, ['studio-create']);
    assert.equal(existsSync(target), false);

    const existing = path.join(workspace, 'apps', 'existing');
    mkdirSync(existing, { recursive: true });
    writeFileSync(path.join(existing, 'nimi.app.yaml'), [
      'app_id: existing.app',
      'display_name: Existing App',
      'local_development:',
      '  electron:',
      `    renderer_origin: http://127.0.0.1:${candidatePlan.preview.identity.devPort}`,
      '',
    ].join('\n'));
    const repeatedCandidatePlan = resolveCandidateAppCreatePlan(workspace, { ...options, features: ['studio-create'] });
    assert.deepEqual(repeatedCandidatePlan.preview.topology, { profile: 'standalone' });
    assert.equal(existsSync(target), false);

    const outsideTarget = path.join(workspace, 'packages', 'outside');
    const outsidePlan = resolveCandidateAppCreatePlan(workspace, {
      ...options,
      dir: outsideTarget,
      appId: 'candidate.outside',
      packageName: 'candidate-outside',
      features: ['studio-create'],
    });
    assert.equal(outsidePlan.preview.profile, 'standalone');
    assert.equal(outsidePlan.resolvedInput.targetDir, outsideTarget);
    assert.equal(existsSync(outsideTarget), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
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
    { features: 'ai-studio-core', pattern: /App scaffold internal module cannot be selected directly/ },
    { features: 'all,ai-consume', pattern: /Feature selection "all" cannot be combined with explicit feature ids/ },
  ];
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-feature-rejection-'));
  try {
    for (const [index, testCase] of cases.entries()) {
      const target = path.join(tempRoot, `app-${index}`);
      assert.throws(
        () => createAppScaffold({
          cwd: tempRoot,
          options: {
            dir: target,
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
      assert.equal(existsSync(target), false, 'prevalidation failure must not materialize the target');
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create accepts the admitted registry and keeps validation on the same de-duplicating resolver', () => {
  assert.equal(APP_SCAFFOLD_MODULE_REGISTRY['ai-studio-core'].kind, 'internal');
  assert.equal(Object.hasOwn(APP_SCAFFOLD_MODULE_REGISTRY['ai-studio-core'], 'lifecycle'), false);
  for (const id of [
    'studio-create', 'studio-media', 'studio-voice', 'kit-recipes',
    'agent-center', 'agent-conversation', 'agent-realtime',
  ]) {
    assert.equal(APP_SCAFFOLD_MODULE_REGISTRY[id].kind, 'feature');
    assert.equal(APP_SCAFFOLD_MODULE_REGISTRY[id].lifecycle, 'admitted');
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(APP_SCAFFOLD_MODULE_REGISTRY).map(([id, module]) => (
      [id, module.sourceMappings.map((mapping) => mapping.targetRoot)]
    ))),
    {
      'ai-studio-core': ['src/capabilities/ai-studio-core'],
      'studio-create': ['src/capabilities/studio-create'],
      'studio-media': ['src/capabilities/studio-media'],
      'studio-voice': ['src/capabilities/studio-voice'],
      'kit-recipes': ['src/capabilities/kit-recipes'],
      'agent-center': ['src/capabilities/agent-center'],
      'agent-conversation': ['src/capabilities/agent-conversation'],
      'agent-realtime': ['src/capabilities/agent-realtime'],
    },
  );

  const create = resolveAppScaffoldCandidateFeatures(['studio-create']);
  assert.deepEqual(create.directFeatureIds, ['studio-create']);
  assert.deepEqual(create.resolvedFeatureIds, ['studio-create']);
  assert.deepEqual(create.resolvedModuleIds, ['ai-studio-core', 'studio-create']);
  assert.deepEqual(create.appAccessItems, ['runtime.consume']);
  assert.deepEqual(resolveAppScaffoldFeatures('studio-create'), create);

  const multi = resolveAppScaffoldCandidateFeatures([
    'studio-media',
    'studio-create',
    'studio-media',
  ]);
  assert.deepEqual(multi.directFeatureIds, ['studio-create', 'studio-media']);
  assert.deepEqual(multi.resolvedFeatureIds, ['studio-create', 'studio-media']);
  assert.deepEqual(multi.resolvedModuleIds, ['ai-studio-core', 'studio-create', 'studio-media']);
  assert.equal(multi.resolvedModuleIds.filter((id) => id === 'ai-studio-core').length, 1);
  assert.deepEqual(multi.appAccessItems, ['runtime.consume']);

  const kit = resolveAppScaffoldCandidateFeatures(['kit-recipes']);
  assert.deepEqual(kit.directFeatureIds, ['kit-recipes']);
  assert.deepEqual(kit.resolvedFeatureIds, ['kit-recipes']);
  assert.deepEqual(kit.resolvedModuleIds, ['kit-recipes']);
  assert.deepEqual(kit.appAccessItems, []);

  const agentCenter = resolveAppScaffoldCandidateFeatures(['agent-center']);
  assert.deepEqual(agentCenter.directFeatureIds, ['agent-center']);
  assert.deepEqual(agentCenter.resolvedFeatureIds, ['agent-center']);
  assert.deepEqual(agentCenter.resolvedModuleIds, ['agent-center']);
  assert.deepEqual(agentCenter.appAccessItems, ['agent.local', 'agent.configure']);
  assert.equal(APP_SCAFFOLD_MODULE_REGISTRY['agent-center'].lifecycle, 'admitted');
  assert.deepEqual(resolveAppScaffoldFeatures('agent-center'), agentCenter);

  const agentRealtime = resolveAppScaffoldCandidateFeatures(['agent-realtime']);
  assert.deepEqual(agentRealtime.resolvedModuleIds, ['agent-realtime']);
  assert.deepEqual(agentRealtime.appAccessItems, ['agent.local']);
  assert.equal(APP_SCAFFOLD_MODULE_REGISTRY['agent-realtime'].lifecycle, 'admitted');

  const agentConversation = resolveAppScaffoldCandidateFeatures(['agent-conversation']);
  assert.deepEqual(agentConversation.resolvedModuleIds, ['agent-conversation']);
  assert.deepEqual(agentConversation.appAccessItems, ['agent.local']);
  assert.equal(APP_SCAFFOLD_MODULE_REGISTRY['agent-conversation'].lifecycle, 'admitted');

  assert.deepEqual(APP_SCAFFOLD_REFERENCE_APP_FEATURE_IDS, [
    'studio-create', 'studio-media', 'studio-voice',
    'agent-center', 'agent-conversation', 'agent-realtime',
  ]);
  const referenceApp = resolveAppScaffoldCandidateFeatures(APP_SCAFFOLD_REFERENCE_APP_FEATURE_IDS);
  assert.deepEqual(referenceApp.directFeatureIds, APP_SCAFFOLD_REFERENCE_APP_FEATURE_IDS);
  assert.deepEqual(referenceApp.appAccessItems, ['runtime.consume', 'agent.local', 'agent.configure']);

  assert.throws(
    () => resolveAppScaffoldCandidateFeatures('studio-create'),
    /explicit feature id array/,
  );
  assert.throws(
    () => resolveAppScaffoldCandidateFeatures(['all']),
    /does not accept "all"/,
  );
  assert.throws(
    () => resolveAppScaffoldCandidateFeatures(['ai-studio-core']),
    /internal module cannot be selected directly/,
  );
  assert.throws(
    () => resolveAppScaffoldCandidateFeatures(['unknown']),
    /Unknown app scaffold feature: unknown/,
  );
});

test('create accepts public post-admission output that exactly matches candidate materialization', () => {
  const selections = [
    ['studio-create'],
    ['studio-media'],
    ['studio-voice'],
    ['kit-recipes'],
    ['agent-center'],
    ['agent-conversation'],
    ['agent-realtime'],
    ['studio-create', 'studio-media'],
    [
      'studio-create', 'studio-media', 'studio-voice', 'kit-recipes',
      'agent-center', 'agent-conversation', 'agent-realtime',
    ],
  ];
  for (const [index, features] of selections.entries()) {
    const input = {
      profile: 'standalone',
      versions,
      appId: `post-admission-${index}`,
      appTitle: `Post Admission ${index}`,
      packageName: `post-admission-${index}`,
    };
    const candidate = buildAppScaffoldCandidateSnapshot({ ...input, features });
    const publicSnapshot = buildAppScaffoldSnapshot({
      ...input,
      features: index === selections.length - 1 ? 'all' : features,
    });
    assert.deepEqual(publicSnapshot.createFiles, candidate.createFiles);
    assert.deepEqual(publicSnapshot.lock, candidate.lock);
  }
});

test('create accepts candidate studio-create as one shared AI Studio route with target-only host wiring', () => {
  const snapshot = candidateSnapshot(['studio-create']);
  const read = (relativePath) => snapshot.filesByPath.get(relativePath)?.content ?? '';
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.dependencies.i18next, versions.i18nextVersion);
  assert.equal(packageJson.dependencies['lucide-react'], versions.lucideReactVersion);
  assert.equal(Object.hasOwn(packageJson.dependencies, 'react-i18next'), false);
  for (const relativePath of [
    'src/scaffold/generated/capability-registry.ts',
    'src/scaffold/generated/runtime-registry.ts',
    'src/scaffold/generated/route-registry.tsx',
    'src/scaffold/generated/navigation.ts',
    'src/scaffold/generated/module-styles.css',
    'src/scaffold/generated/i18n.ts',
    'src/scaffold/generated/host-adapters.tsx',
  ]) {
    assert.ok(snapshot.filesByPath.has(relativePath), `${relativePath} must be generated`);
  }
  assert.match(read('src/scaffold/generated/capability-registry.ts'), /from '\.\.\/\.\.\/capabilities\/ai-studio-core\/index\.js'/);
  assert.match(read('src/scaffold/generated/capability-registry.ts'), /studioCreateModule, studioCreateMessageBundles/);
  assert.doesNotMatch(read('src/scaffold/generated/capability-registry.ts'), /studioMediaModule|studioVoiceModule/);
  assert.match(read('src/scaffold/generated/runtime-registry.ts'), /studioCreateRuntimeHandlers/);
  assert.match(read('src/scaffold/generated/route-registry.tsx'), /content = <GeneratedAIStudioRoute capabilityId=\{activeViewId\}/);
  assert.equal(read('src/scaffold/generated/route-registry.tsx').match(/GeneratedAIStudioRoute/g)?.length, 2);
  assert.match(read('src/scaffold/generated/route-registry.tsx'), /export function GeneratedModuleHost/);
  assert.match(read('src/scaffold/generated/route-registry.tsx'), /<GeneratedAIStudioHost onSelectCapability=\{onSelectView\}>\{children\}/);
  assert.match(read('src/scaffold/generated/route-registry.tsx'), /tabIndex=\{-1\}/);
  assert.match(read('src/shell/routes/product-area.tsx'), /VIEW_STORAGE_KEY/);
  assert.match(read('src/shell/routes/product-area.tsx'), /<GeneratedModuleHost onSelectView=\{selectView\}>/);
  assert.match(read('src/scaffold/generated/navigation.ts'), /translateGeneratedMessage\(registration\.descriptor\.labelKey\)/);
  assert.match(read('src/scaffold/generated/i18n.ts'), /generatedAIStudioMessageBundles/);
  assert.match(read('src/scaffold/generated/module-styles.css'), /capabilities\/ai-studio-core\/ai-studio-core\.css/);

  const host = read('src/scaffold/generated/host-adapters.tsx');
  for (const expected of [
    'AIStudioWorkspace',
    'runStudioCapability',
    'createStudioNonSuccess',
    'createStudioRunTargetSummary',
    'createEmptyStudioPromptDraftStore',
    'loadStudioAIConfig',
    'parseStudioPromptDraftStore',
    'projectStudioManagedHistory',
    'readStudioPromptDraft',
    'subscribeStudioAIConfigRefresh',
    'updateStudioPromptDraftStore',
    'useAIStudioWorkspaceController',
    'ModelConfigAIConfigSurface',
    'openDesktopIntent',
    'getNimiLocalAppClient',
    'storage.readJson',
    'storage.writeJson',
    'storage.assets.remove',
    'storage.assets.stat',
    'ai.voiceAssets.list',
    'ai.artifacts.upload',
    'navigator.clipboard.writeText',
  ]) {
    assert.match(host, new RegExp(expected.replaceAll('.', '\\.')));
  }
  assert.doesNotMatch(host, /apps\/lab|nimi\.lab|lab-|WorldTour|Simulator/);
  assert.doesNotMatch(host, /type PromptDraftStore|if \(enabled && prompt\)|mediaHistory\.push\(/);
  assert.doesNotMatch(host, /HISTORY_LIMIT_PER_CAPABILITY|function parseHistory|DEFAULT_HISTORY_PANEL|stored\.sha256/);
  assert.match(host, /_STORAGE_JSON_NOT_FOUND/);
  assert.match(host, /_LOCAL_ASSET_NOT_FOUND/);
  assert.match(host, /section: 'ai-models'/);
  assert.match(host, /aiConfig\.listOptions\(query\)/);
  assert.match(host, /aiConfig\.overwrite\(input\)/);
  assert.match(host, /revision=\{snapshot\?\.revision\}/);
  assert.match(host, /effectiveSelections=\{snapshot\?\.effectiveSelections\}/);
  assert.doesNotMatch(host, /effectiveSelections\.map/);
  assert.doesNotMatch(host, /modelConfig\.localSelections|consumer: 'third-party-app'/);
  assert.match(host, /renderAIConfigPanel=\{\(input\) => <GeneratedAIConfigPanel/);
  assert.match(host, /load: loadVerifiedHistory/);
  assert.match(host, /persist: persistHistory/);
  assert.match(host, /appendRecord,/);
  assert.match(host, /cleanupArtifacts,/);
  assert.match(host, /loadPanelPreferences,/);
  assert.match(host, /savePanelPreferences,/);
  assert.match(host, /revealLocalAppAsset: \(relativePath\) => getNimiLocalAppClient\(\)\.storage\.assets\.reveal\(relativePath\)/);
  assert.doesNotMatch(host, /exportArtifact/);
  assert.match(host, /status: 'unavailable'/);
  assert.match(host, /remainingCleanupPaths: cleanup\.remainingCleanupPaths/);
  assert.match(host, /displayFailure: \{ reason: 'runtime-call-failed'/);
  assert.match(host, /controller=\{controller\}/);
  assert.doesNotMatch(host, /historyRepository=\{historyRepository\}/);
  assert.match(read('src/shell/App.tsx'), /<NimiToaster \/>/);
});

test('create accepts candidate multi in module order with one AI Studio plus an independent Kit view', () => {
  const snapshot = candidateSnapshot(['studio-create', 'studio-media', 'studio-voice', 'kit-recipes']);
  const read = (relativePath) => snapshot.filesByPath.get(relativePath)?.content ?? '';
  const capabilityRegistry = read('src/scaffold/generated/capability-registry.ts');
  assert.ok(capabilityRegistry.indexOf('studioCreateModule') < capabilityRegistry.indexOf('studioMediaModule'));
  assert.ok(capabilityRegistry.indexOf('studioMediaModule') < capabilityRegistry.indexOf('studioVoiceModule'));
  assert.equal(capabilityRegistry.match(/aiStudioCoreMessageBundles/g)?.length, 3);
  const runtimeRegistry = read('src/scaffold/generated/runtime-registry.ts');
  assert.ok(runtimeRegistry.indexOf('studioCreateRuntimeHandlers') < runtimeRegistry.indexOf('studioMediaRuntimeHandlers'));
  assert.ok(runtimeRegistry.indexOf('studioMediaRuntimeHandlers') < runtimeRegistry.indexOf('studioVoiceRuntimeHandlers'));
  assert.ok(snapshot.lock.resolvedViews.includes('music.generate'));
  assert.ok(snapshot.lock.resolvedNavigation.includes('music.generate'));
  const routeRegistry = read('src/scaffold/generated/route-registry.tsx');
  assert.equal(routeRegistry.match(/content = <GeneratedAIStudioRoute/g)?.length, 1);
  assert.match(routeRegistry, /content = <KitRecipesCapability exampleAppId=\{appId\} \/>/);
  const navigation = read('src/scaffold/generated/navigation.ts');
  assert.ok(navigation.indexOf('generatedAIStudioModules.map') < navigation.indexOf('id: "kit-recipes"'));
});

test('create accepts candidate Kit-only output without AI source imports or an AI host adapter', () => {
  const snapshot = candidateSnapshot(['kit-recipes']);
  const packageJson = JSON.parse(snapshot.filesByPath.get('package.json').content);
  assert.equal(packageJson.dependencies['lucide-react'], versions.lucideReactVersion);
  assert.equal(Object.hasOwn(packageJson.dependencies, 'i18next'), false);
  assert.equal(snapshot.filesByPath.has('src/scaffold/generated/host-adapters.tsx'), false);
  assert.equal(snapshot.filesByPath.has('src/scaffold/generated/i18n.ts'), false);
  for (const relativePath of [
    'src/scaffold/generated/capability-registry.ts',
    'src/scaffold/generated/runtime-registry.ts',
    'src/scaffold/generated/route-registry.tsx',
    'src/scaffold/generated/navigation.ts',
    'src/scaffold/generated/module-styles.css',
  ]) {
    const content = snapshot.filesByPath.get(relativePath)?.content ?? '';
    assert.doesNotMatch(content, /from ['"].*(?:ai-studio-core|studio-create|studio-media|studio-voice)/);
  }
  assert.equal(snapshot.filesByPath.get('src/scaffold/generated/module-styles.css')?.content, '');
  assert.match(snapshot.filesByPath.get('src/scaffold/generated/route-registry.tsx')?.content ?? '', /KitRecipesCapability/);
});

test('candidate Agent Center slice mounts the canonical Kit entry with one formal App client', () => {
  const snapshot = candidateSnapshot(['agent-center']);
  const read = (relativePath) => snapshot.filesByPath.get(relativePath)?.content ?? '';
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.dependencies['lucide-react'], versions.lucideReactVersion);
  assert.deepEqual(snapshot.lock.appAccessItems, ['agent.local', 'agent.configure']);
  assert.ok(snapshot.filesByPath.has('src/capabilities/agent-center/index.tsx'));
  assert.match(read('src/capabilities/agent-center/index.tsx'), /AppAgentCenterEntry/);
  assert.doesNotMatch(read('src/capabilities/agent-center/index.tsx'), /getLabLocalAppClient|apps\/lab|Nimi Lab/);
  const route = read('src/scaffold/generated/route-registry.tsx');
  assert.match(route, /import \{ getNimiLocalAppClient \} from '\.\.\/\.\.\/shell\/auth\/local-app-client\.js'/);
  assert.match(route, /<AgentCenterCapability client=\{getNimiLocalAppClient\(\)\} \/>/);
  assert.equal(snapshot.filesByPath.has('src/scaffold/generated/host-adapters.tsx'), false);
});

test('candidate Agent Realtime slice mounts Kit-owned session and Host media mechanics', () => {
  const snapshot = candidateSnapshot(['agent-realtime']);
  const read = (relativePath) => snapshot.filesByPath.get(relativePath)?.content ?? '';
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.dependencies['lucide-react'], versions.lucideReactVersion);
  assert.deepEqual(snapshot.lock.appAccessItems, ['agent.local']);
  const source = read('src/capabilities/agent-realtime/index.tsx');
  assert.match(source, /AgentRealtimeEntry/);
  assert.match(source, /createBrowserAgentRealtimeHostMediaPort/);
  assert.doesNotMatch(source, /getUserMedia|AudioContext|MediaRecorder|apps\/lab|Nimi Lab/);
  const route = read('src/scaffold/generated/route-registry.tsx');
  assert.match(route, /<AgentRealtimeCapability client=\{getNimiLocalAppClient\(\)\} \/>/);
});

test('candidate Agent Conversation slice mounts Kit-owned projection and Host media mechanics', () => {
  const snapshot = candidateSnapshot(['agent-conversation']);
  const read = (relativePath) => snapshot.filesByPath.get(relativePath)?.content ?? '';
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.dependencies['lucide-react'], versions.lucideReactVersion);
  assert.deepEqual(snapshot.lock.appAccessItems, ['agent.local']);
  const source = read('src/capabilities/agent-conversation/index.tsx');
  assert.match(source, /AppConversationEntry/);
  assert.match(source, /createBrowserAppConversationHostPort/);
  assert.doesNotMatch(source, /readArtifact|uploadAttachment|transcribeVoice|MediaRecorder|apps\/lab|Nimi Lab/);
  const route = read('src/scaffold/generated/route-registry.tsx');
  assert.match(route, /<AgentConversationCapability client=\{getNimiLocalAppClient\(\)\} \/>/);
});

test('exact fresh reference App input materializes the fixed AI and Agent closure', () => {
  const snapshot = candidateSnapshot(APP_SCAFFOLD_REFERENCE_APP_FEATURE_IDS);
  assert.deepEqual(snapshot.lock.directFeatures, APP_SCAFFOLD_REFERENCE_APP_FEATURE_IDS);
  assert.deepEqual(snapshot.lock.appAccessItems, ['runtime.consume', 'agent.local', 'agent.configure']);
  for (const moduleId of [
    'studio-create', 'studio-media', 'studio-voice',
    'agent-center', 'agent-conversation', 'agent-realtime',
  ]) {
    assert.ok(snapshot.lock.resolvedModules.includes(moduleId), `${moduleId} must be in the reference closure`);
    assert.ok(snapshot.filesByPath.has(`src/capabilities/${moduleId}/index.tsx`)
      || snapshot.filesByPath.has(`src/capabilities/${moduleId}/index.ts`), `${moduleId} source must materialize`);
  }
  const route = snapshot.filesByPath.get('src/scaffold/generated/route-registry.tsx')?.content ?? '';
  for (const component of ['AgentCenterCapability', 'AgentConversationCapability', 'AgentRealtimeCapability']) {
    assert.match(route, new RegExp(`<${component} client=\\{getNimiLocalAppClient\\(\\)\\}`));
  }
});

test('phase 7 candidate product imports map wholly into capabilities and reject Lab source residue prewrite', () => {
  const snapshot = buildAppScaffoldCandidateSnapshot({
    profile: 'standalone',
    versions,
    appId: 'candidate.closure',
    appTitle: 'Candidate Closure',
    packageName: 'candidate-closure',
    features: ['studio-create', 'studio-media', 'studio-voice', 'kit-recipes'],
  });
  const productFiles = snapshot.createFiles.filter((file) => file.path.startsWith('src/capabilities/'));
  assert.ok(productFiles.length > 0);
  const importPattern = /\b(?:from|import)\s*(?:\(\s*)?['"](\.\.?\/[^'"]+)['"]/gu;
  for (const file of productFiles) {
    assert.doesNotMatch(file.content, /apps\/lab|src\/ai-studio-core|src\/studio-modules|nimi\.lab|Nimi Lab|Lab-only/);
    for (const match of file.content.matchAll(importPattern)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), match[1]));
      assert.match(resolved, /^src\/capabilities\//, `${file.path}: ${match[1]} -> ${resolved}`);
    }
  }

  const manifest = resolveAppSource({ resolvedModuleIds: ['kit-recipes'] }).manifest;
  for (const [field, content] of [
    ['appId', 'export const owner = "nimi.lab";'],
    ['appTitle', 'export const title = "Nimi Lab";'],
    ['tauriIdentifier', 'export const native = "ai.nimi.apps.nimi.lab";'],
  ]) {
    assert.throws(
      () => assertIdentityNeutralProductSource('src/capabilities/test.ts', content, manifest),
      new RegExp(`reserved Lab identity: src/capabilities/test\\.ts: ${field}`),
    );
  }
  assert.throws(
    () => assertIdentityNeutralProductSource(
      'src/capabilities/test.ts',
      'export const ownership = "Lab-only diagnostics";',
      manifest,
    ),
    /Lab-only marker: src\/capabilities\/test\.ts/,
  );
});

test('create accepts only canonical existing-intent feature order after admission', () => {
  const resolved = resolveAppScaffoldIntentFeatures(['studio-create', 'studio-media']);
  assert.deepEqual(resolved.resolvedModuleIds, ['ai-studio-core', 'studio-create', 'studio-media']);
  assert.throws(
    () => resolveAppScaffoldIntentFeatures(['studio-media', 'studio-create']),
    /must be canonical registry order/,
  );
  assert.throws(
    () => resolveAppScaffoldIntentFeatures(['studio-create', 'studio-create']),
    /must be canonical registry order/,
  );
  assert.throws(
    () => resolveAppScaffoldIntentFeatures([' studio-create']),
    /canonical feature id array/,
  );
  assert.throws(
    () => resolveAppScaffoldIntentFeatures(['ai-studio-core']),
    /internal module cannot be selected directly/,
  );

  const selected = buildAppScaffoldSnapshot({
    profile: 'standalone',
    versions,
    appId: 'candidate.intent',
    appTitle: 'Candidate Intent',
    packageName: 'candidate-intent',
    features: ['kit-recipes'],
  });
  const intent = JSON.parse(selected.filesByPath.get(SCAFFOLD_INTENT_PATH).content);
  const rebuilt = buildAppScaffoldSnapshotFromIntent({ intent, versions });
  assert.deepEqual(rebuilt.lock.directFeatures, ['kit-recipes']);
  assert.deepEqual(rebuilt.lock.resolvedModules, ['kit-recipes']);
  assert.ok(rebuilt.filesByPath.has('src/capabilities/kit-recipes/index.tsx'));
  assert.equal(rebuilt.filesByPath.has('src/product-modules/kit-recipes/index.tsx'), false);
});

test('create rejects catalog dependency cycles and target collisions', () => {
  const capability = (id, requires, targetRoot, order, lifecycle = 'candidate') => ({
    id,
    kind: 'feature',
    lifecycle,
    order,
    label: id,
    requires,
    appAccessItems: [],
    sourceMappings: [{ sourceRoot: `src/modules/${id}`, targetRoot }],
    npmDependencies: {},
    cargoDependencies: {},
    hostAdapterContract: 'test-host-v1',
    views: [`${id}.view`],
    navigation: [`${id}.view`],
    styles: [],
    assets: [],
    productEntry: { kind: 'component', modulePath: `src/modules/${id}/index.tsx`, componentExport: 'TestComponent' },
  });
  const cycleCatalog = {
    alpha: capability('alpha', ['beta'], 'src/capabilities/alpha', 10),
    beta: capability('beta', ['alpha'], 'src/capabilities/beta', 20),
  };
  assert.throws(
    () => resolveAppScaffoldCandidateFeatures(['alpha'], cycleCatalog),
    /App scaffold module dependency cycle: alpha -> beta -> alpha/,
  );

  const admittedCatalog = {
    alpha: capability('alpha', [], 'src/capabilities/alpha', 10, 'admitted'),
    beta: capability('beta', [], 'src/capabilities/beta', 20, 'admitted'),
  };
  assert.deepEqual(
    resolveAppScaffoldFeatures('all', admittedCatalog).directFeatureIds,
    ['alpha', 'beta'],
  );
  assert.deepEqual(
    resolveAppScaffoldFeatures(['beta', 'alpha', 'beta'], admittedCatalog).directFeatureIds,
    ['alpha', 'beta'],
  );

  const collisionCatalog = {
    alpha: capability('alpha', [], 'src/capabilities/shared', 10),
    beta: capability('beta', [], 'src/capabilities/shared/nested', 20),
  };
  assert.throws(
    () => validateAppScaffoldModuleRegistry(collisionCatalog),
    /App scaffold module target collision: alpha and beta/,
  );
});

test('phase 7 file ownership rejects exact case-folded and file-prefix collisions', () => {
  const owned = (pathValue, ownerId) => ({
    path: pathValue,
    content: '',
    mutationClass: 'app-owned product code',
    ownerKind: 'module',
    ownerId,
  });
  assert.throws(
    () => validateScaffoldFileOwnership([
      owned('src/capabilities/shared.ts', 'alpha'),
      owned('src/capabilities/shared.ts', 'beta'),
    ]),
    /ownership collision: src\/capabilities\/shared\.ts and src\/capabilities\/shared\.ts: module\/alpha and module\/beta/,
  );
  assert.throws(
    () => validateScaffoldFileOwnership([
      owned('src/capabilities/Feature.ts', 'alpha'),
      owned('src/capabilities/feature.ts', 'beta'),
    ]),
    /ownership collision: src\/capabilities\/Feature\.ts and src\/capabilities\/feature\.ts: module\/alpha and module\/beta/,
  );
  assert.throws(
    () => validateScaffoldFileOwnership([
      owned('src/capabilities/feature', 'alpha'),
      owned('src/capabilities/feature/index.ts', 'beta'),
    ]),
    /file\/directory prefix collision: src\/capabilities\/feature: module\/alpha and module\/beta/,
  );
});

test('phase 7 Cargo dependency objects compare structurally and render non-empty safe TOML', () => {
  const moduleEntry = (id, order, cargoDependencies) => ({
    id,
    kind: 'feature',
    lifecycle: 'candidate',
    order,
    label: id,
    requires: [],
    sourceMappings: [{ sourceRoot: `src/modules/${id}`, targetRoot: `src/capabilities/${id}` }],
    appAccessItems: [],
    npmDependencies: {},
    cargoDependencies,
    hostAdapterContract: 'test-host-v1',
    views: [`${id}.view`],
    navigation: [`${id}.view`],
    styles: [],
    assets: [],
    productEntry: {
      kind: 'component',
      modulePath: `src/modules/${id}/index.tsx`,
      componentExport: 'TestComponent',
    },
  });
  const expected = {
    version: '1.2.3',
    features: ['derive', 'serde'],
    'default-features': false,
    optional: true,
  };
  const registry = {
    alpha: moduleEntry('alpha', 10, { shared: expected }),
    beta: moduleEntry('beta', 20, {
      shared: { optional: true, features: ['derive', 'serde'], version: '1.2.3', 'default-features': false },
    }),
  };
  const resolved = resolveAppScaffoldCandidateFeatures(['alpha', 'beta'], registry);
  assert.deepEqual(resolved.cargoDependencies.shared, expected);
  assert.equal(
    renderCargoDependencyValue(expected, 'shared'),
    '{ default-features = false, features = ["derive", "serde"], optional = true, version = "1.2.3" }',
  );
  assert.throws(
    () => renderCargoDependencyValue({ path: '../crate' }, 'local'),
    /Cargo dependency field is invalid: local\.path/,
  );
  assert.throws(
    () => resolveAppScaffoldCandidateFeatures(['alpha'], {
      alpha: moduleEntry('alpha', 10, { local: { path: '../crate' } }),
    }),
    /Cargo dependency field is invalid: alpha:local\.path/,
  );
  assert.throws(
    () => resolveAppScaffoldCandidateFeatures(['alpha'], {
      alpha: { ...moduleEntry('alpha', 10, {}), npmDependencies: { local: 'workspace:*' } },
    }),
    /npm dependency must use a public registry version: alpha:local/,
  );
  for (const spec of [
    'github:owner/repo',
    'gitlab:owner/repo',
    'git@github.com:owner/repo.git',
    'owner/repo',
    'ssh://git@example.test/repo.git',
    '~/local-package',
    'not a version',
    'ftp://example.test/package',
    'registry.example.test/owner/package',
  ]) {
    assert.throws(
      () => resolveAppScaffoldCandidateFeatures(['alpha'], {
        alpha: { ...moduleEntry('alpha', 10, {}), npmDependencies: { vcs: spec } },
      }),
      /npm dependency must use a public registry version: alpha:vcs/,
    );
  }
  for (const spec of ['^1.2.3', '>=1 <2', 'latest', 'npm:@scope/renamed-package@~2.1.0']) {
    assert.doesNotThrow(() => resolveAppScaffoldCandidateFeatures(['alpha'], {
      alpha: { ...moduleEntry('alpha', 10, {}), npmDependencies: { registry: spec } },
    }));
  }
  for (const spec of ['../crate', 'not a version', 'git://example.test/repo']) {
    assert.throws(
      () => validateAppScaffoldCargoDependencyValue(spec, 'invalid-string'),
      /Cargo dependency must use a public registry version: invalid-string/,
    );
  }
  for (const spec of ['0.1.0', '^1.2.3', '~1.2', '>=1.2.3, <2', '1.*']) {
    assert.doesNotThrow(() => validateAppScaffoldCargoDependencyValue(spec, 'valid-string'));
  }
  assert.throws(
    () => buildAppScaffoldCandidateSnapshot({
      profile: 'standalone',
      versions: { ...versions, nimiShellTauriVersion: '../crate' },
      appId: 'invalid.base-cargo',
      appTitle: 'Invalid Base Cargo',
      packageName: 'invalid-base-cargo',
      features: [],
    }),
    /Cargo dependency must use a public registry version: nimi-shell-tauri/,
  );
  for (const descriptor of [
    { version: ['1'] },
    { optional: 'false' },
    { features: true },
    { package: false },
  ]) {
    assert.throws(
      () => resolveAppScaffoldCandidateFeatures(['alpha'], {
        alpha: moduleEntry('alpha', 10, { invalid: descriptor }),
      }),
      /Cargo dependency value has the wrong type: alpha:invalid/,
    );
  }
  assert.throws(
    () => resolveAppScaffoldCandidateFeatures(['alpha', 'beta'], {
      alpha: moduleEntry('alpha', 10, { shared: { version: '1' } }),
      beta: moduleEntry('beta', 20, { shared: { version: '2' } }),
    }),
    /Cargo dependency version collision for shared/,
  );
  assert.throws(() => renderCargoDependencyValue({}, 'empty'), /Cargo dependency is empty: empty/);
  assert.throws(
    () => renderCargoDependencyValue({ git: 'https://example.test/repo' }, 'unsafe'),
    /Cargo dependency field is invalid: unsafe\.git/,
  );
  assert.throws(
    () => renderCargoDependencyValue({ features: ['derive', ''] }, 'bad-features'),
    /Cargo dependency value has the wrong type: bad-features\.features/,
  );
});

test('phase 7 candidate materialization reports the exact residual target after filesystem failure', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-candidate-residual-'));
  const target = path.join(tempRoot, 'candidate');
  const options = {
    dir: target,
    profile: 'standalone',
    appId: 'candidate.residual',
    title: 'Candidate Residual',
    packageName: 'candidate-residual',
    features: ['studio-create'],
    silent: true,
  };
  try {
    const plan = buildAppScaffoldCandidateCreatePlan({ cwd: tempRoot, options, versions });
    let failure;
    try {
      createAppScaffoldCandidate({
        cwd: tempRoot,
        options,
        versions,
        plan,
        ensureDirEmptyOrMissing: () => {},
        mkdirSync,
        createFileTree(targetDir) {
          writeFileSync(path.join(targetDir, 'partial-write.txt'), 'residual');
          throw new Error('controlled-filesystem-failure');
        },
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error);
    assert.equal(
      failure.message,
      `Scaffold materialization failed; inspect the exact residual target ${target}: controlled-filesystem-failure`,
    );
    assert.equal(existsSync(target), true);
    assert.equal(readFileSync(path.join(target, 'partial-write.txt'), 'utf8'), 'residual');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('unsupported previous app scaffold lock and intent fail closed', () => {
  const legacyLock = cliScaffold('standalone');
  try {
    const lockPath = path.join(legacyLock.target, '.nimi/app-scaffold/lock.json');
    const lock = JSON.parse(legacyLock.read('.nimi/app-scaffold/lock.json'));
    lock.lockVersion = 2;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const result = runNimiApp(['check', '--dir', legacyLock.target], legacyLock.tempRoot, { env: legacyLock.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported scaffold lock version: 2/);
  } finally {
    legacyLock.cleanup();
  }

  const legacyIntent = cliScaffold('standalone');
  try {
    const intentPath = path.join(legacyIntent.target, '.nimi/app-scaffold/intent.json');
    const intent = JSON.parse(legacyIntent.read('.nimi/app-scaffold/intent.json'));
    intent.intentVersion = 2;
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
    const result = runNimiApp(['sync', '--dir', legacyIntent.target], legacyIntent.tempRoot, { env: legacyIntent.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported scaffold intent version: 2/);
    assert.throws(
      () => buildAppScaffoldSnapshotFromIntent({ intent, versions }),
      /Unsupported scaffold intent version: 2/,
    );
  } finally {
    legacyIntent.cleanup();
  }

  const retiredProfile = cliScaffold('standalone');
  try {
    const intentPath = path.join(retiredProfile.target, '.nimi/app-scaffold/intent.json');
    const lockPath = path.join(retiredProfile.target, '.nimi/app-scaffold/lock.json');
    const intent = JSON.parse(retiredProfile.read('.nimi/app-scaffold/intent.json'));
    const lock = JSON.parse(retiredProfile.read('.nimi/app-scaffold/lock.json'));
    const managedPath = path.join(retiredProfile.target, 'src/scaffold/generated/navigation.ts');
    const managedBefore = readFileSync(managedPath, 'utf8');
    intent.profile = 'workspace-app';
    lock.profile = 'workspace-app';
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const result = runNimiApp(['sync', '--dir', retiredProfile.target], retiredProfile.tempRoot, { env: retiredProfile.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported scaffold profile: workspace-app/);
    assert.equal(readFileSync(managedPath, 'utf8'), managedBefore);
    assert.throws(
      () => buildAppScaffoldSnapshotFromIntent({ intent, versions }),
      /Unsupported scaffold profile: workspace-app/,
    );
  } finally {
    retiredProfile.cleanup();
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

test('dev accepts one explicit CDP configuration', () => {
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

    const noCdp = runNimiApp(['dev', '--no-cdp'], tempRoot);
    assert.notEqual(noCdp.status, 0);
    assert.doesNotMatch(noCdp.stderr, /Unknown option: --no-cdp/u);

    const conflict = runNimiApp(['dev', '--no-cdp', '--cdp-port', '9334'], tempRoot);
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /--cdp-port and --no-cdp cannot be combined/u);
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
    assert.doesNotMatch(result.stdout, /resolved create preview/);
    assert.equal(readFileSync(path.join(ordinaryNonEmpty, 'README.md'), 'utf8'), 'existing readme\n');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('sync rejects missing or incomplete current intent before projection or managed writes', () => {
  const incomplete = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-scaffold-incomplete-intent-'));
  const incompleteTarget = path.join(incomplete, 'app');
  const incompleteEnv = fakePnpmEnv(incomplete);
  try {
    const created = runNimiApp(['create', '--dir', incompleteTarget, '--profile', 'standalone'], incomplete, { env: incompleteEnv });
    assert.equal(created.status, 0, created.stderr);
    const intentPath = path.join(incompleteTarget, SCAFFOLD_INTENT_PATH);
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    delete intent.resolvedModules;
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
    const init = runNimiApp(['init', '--dir', incompleteTarget], incomplete, { env: incompleteEnv });
    assert.notEqual(init.status, 0);
    assert.match(init.stderr, /canonical resolved intent/);
    assert.equal(existsSync(path.join(incompleteTarget, SCAFFOLD_LOCK_PATH)), false);
    assert.equal(existsSync(path.join(incompleteTarget, '.nimi', 'methodology')), false);
  } finally {
    rmSync(incomplete, { recursive: true, force: true });
  }

  const generated = cliScaffold('standalone');
  try {
    const intentPath = path.join(generated.target, SCAFFOLD_INTENT_PATH);
    const managedPath = path.join(generated.target, 'src', 'shell', 'auth', 'app-identity.ts');
    rmSync(intentPath);
    writeFileSync(managedPath, '// existing managed drift must not be overwritten\n');
    const update = runNimiApp(['sync', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.notEqual(update.status, 0);
    assert.match(update.stderr, /Missing scaffold init intent/);
    assert.equal(existsSync(intentPath), false);
    assert.equal(readFileSync(managedPath, 'utf8'), '// existing managed drift must not be overwritten\n');
  } finally {
    generated.cleanup();
  }
});

test('sync rejects scaffold identity drift before managed writes', () => {
  const generated = cliScaffold('standalone');
  try {
    const intentPath = path.join(generated.target, '.nimi/app-scaffold/intent.json');
    const originalIntent = JSON.parse(readFileSync(intentPath, 'utf8'));
    const managedPath = path.join(generated.target, 'src', 'shell', 'auth', 'app-identity.ts');
    const managedBefore = readFileSync(managedPath, 'utf8');
    for (const [field, value] of [
      ['profile', 'workspace-app'],
      ['appId', 'other.app'],
      ['appTitle', 'Other App'],
      ['packageName', 'other-app'],
      ['packageAuthor', 'Other Maintainers'],
      ['cargoPackageName', 'other-app-shell'],
      ['tauriIdentifier', 'ai.nimi.apps.other.app'],
      ['accentPack', 'other-accent'],
    ]) {
      writeFileSync(intentPath, `${JSON.stringify({ ...originalIntent, [field]: value }, null, 2)}\n`);
      const result = runNimiApp(['sync', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0, `${field} drift must fail`);
      assert.match(result.stderr, /is immutable; create a fresh scaffold/u);
      assert.equal(readFileSync(managedPath, 'utf8'), managedBefore);
    }
  } finally {
    generated.cleanup();
  }
});

test('sync advances the App version while preserving immutable scaffold identity', () => {
  const generated = cliScaffold('standalone');
  try {
    const intentPath = path.join(generated.target, '.nimi/app-scaffold/intent.json');
    const packagePath = path.join(generated.target, 'package.json');
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.version = '0.1.1';
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const sync = runNimiApp(['sync', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(sync.status, 0, sync.stderr);
    const check = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(check.status, 0, check.stderr);

    assert.equal(JSON.parse(generated.read('package.json')).version, '0.1.1');
    assert.equal(parseYaml(generated.read('nimi.app.yaml')).version, '0.1.1');
    assert.match(generated.read('src-tauri/Cargo.toml'), /^version = "0\.1\.1"$/mu);
    assert.equal(JSON.parse(generated.read('src-tauri/tauri.conf.json')).version, '0.1.1');
    assert.equal(parseYaml(generated.read('.nimi/config/app-identity.yaml')).version, '0.1.1');
    assert.equal(parseYaml(generated.read('.nimi/admission/submission.yaml')).version, '0.1.1');
    const synchronizedIntent = JSON.parse(generated.read('.nimi/app-scaffold/intent.json'));
    assert.equal(synchronizedIntent.version, '0.1.1');
    assert.equal(synchronizedIntent.appIdentity.version, '0.1.1');
    const synchronizedLock = JSON.parse(generated.read('.nimi/app-scaffold/lock.json'));
    assert.equal(synchronizedLock.version, '0.1.1');
    assert.equal(synchronizedLock.appId, intent.appId);
  } finally {
    generated.cleanup();
  }
});

test('check fails closed on managed drift and sync preserves app-owned product code', () => {
  const generated = cliScaffold('standalone');
  try {
    let result = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(result.status, 0, result.stderr);

    const targetAdapterPath = path.join(generated.target, 'src/shell/workbench-target-adapter.ts');
    writeFileSync(targetAdapterPath, `${generated.read('src/shell/workbench-target-adapter.ts')}\n// drift\n`);
    result = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
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

    const packagePath = path.join(generated.target, 'package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.dependencies['app-owned-library'] = '^1.0.0';
    packageJson.scripts['test:app'] = 'node --test test/product.test.mjs';
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    const buildProfilePath = path.join(generated.target, '.nimi/config/build-profile.yaml');
    const buildProfile = parseYaml(readFileSync(buildProfilePath, 'utf8'));
    buildProfile.test_command = 'pnpm run test:app';
    buildProfile.targets['windows-x86_64'].payload_path = 'custom-output/app.exe';
    buildProfile.targets['windows-x86_64'].runtime_entry = 'payload/app.exe';
    writeFileSync(buildProfilePath, stringifyYaml(buildProfile));
    const submissionPath = path.join(generated.target, '.nimi/admission/submission.yaml');
    const submission = parseYaml(readFileSync(submissionPath, 'utf8'));
    submission.support_manifest.escalation_path = 'https://example.test/support';
    writeFileSync(submissionPath, stringifyYaml(submission));

    result = runNimiApp(['sync', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(result.status, 0, result.stderr);
    result = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(generated.read('src/shell/routes/product-area.tsx'), productEdit);
    assert.doesNotMatch(generated.read('src/shell/workbench-target-adapter.ts'), /\/\/ drift/);
    const preservedPackage = JSON.parse(generated.read('package.json'));
    assert.equal(preservedPackage.dependencies['app-owned-library'], '^1.0.0');
    assert.equal(preservedPackage.scripts['test:app'], 'node --test test/product.test.mjs');
    assert.equal(parseYaml(generated.read('.nimi/config/build-profile.yaml')).targets['windows-x86_64'].payload_path, 'custom-output/app.exe');
    assert.equal(parseYaml(generated.read('.nimi/admission/submission.yaml')).support_manifest.escalation_path, 'https://example.test/support');
  } finally {
    generated.cleanup();
  }
});

test('phase 7 check rejects tampered resolved ownership projections in the scaffold lock', () => {
  const generated = cliScaffold('standalone');
  try {
    const lockPath = path.join(generated.target, SCAFFOLD_LOCK_PATH);
    const original = JSON.parse(generated.read(SCAFFOLD_LOCK_PATH));
    const cases = [
      ['resolvedViews', 'Resolved scaffold views'],
      ['resolvedNavigation', 'Resolved scaffold navigation'],
      ['resolvedStyles', 'Resolved scaffold styles'],
      ['resolvedAssets', 'Resolved scaffold assets'],
      ['hostAdapterContracts', 'Scaffold host adapter contracts'],
    ];
    for (const [field, label] of cases) {
      const tampered = structuredClone(original);
      tampered[field] = [...tampered[field], `tampered-${field}`];
      writeFileSync(lockPath, `${JSON.stringify(tampered, null, 2)}\n`);
      const result = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0, `${field} tamper unexpectedly passed`);
      assert.match(result.stderr, new RegExp(`${label} does not match current scaffold generator`));
      writeFileSync(lockPath, `${JSON.stringify(original, null, 2)}\n`);
    }
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

test('sync regenerates App access from canonical selected features', () => {
  const generated = cliScaffold('standalone', [], testDir);
  try {
    const intentPath = path.join(generated.target, '.nimi/app-scaffold/intent.json');
    const intent = JSON.parse(generated.read('.nimi/app-scaffold/intent.json'));
    intent.appAccessItems = ['realm.data', 'future.experimental', 'agent.local', 'agent.configure'];
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
    let result = runNimiApp(['sync', '--dir', generated.target], generated.tempRoot, { env: generated.env });
    assert.equal(result.status, 0, result.stderr);
    result = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
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

test('sync adopts and check audits an existing submitted App without creating a managed scaffold lock', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-existing-doctor-'));
  const target = path.join(tempRoot, 'existing-app');
  const env = fakePnpmEnv(tempRoot);
  const lifecycleVersions = JSON.parse(readFileSync(path.join(testDir, '..', 'package.json'), 'utf8')).nimiScaffoldVersions;
  try {
    mkdirSync(path.join(target, 'src'), { recursive: true });
    mkdirSync(path.join(target, 'src-tauri'), { recursive: true });
    mkdirSync(path.join(target, '.nimi', 'config'), { recursive: true });
    writeFileSync(path.join(target, 'package.json'), `${JSON.stringify({
      name: 'existing-app',
      version: '0.1.0',
      private: true,
      type: 'module',
      packageManager: lifecycleVersions.packageManager,
      scripts: {
        dev: 'nimi-app dev --shell electron',
        'dev:shell': 'nimi-app dev',
        'dev:electron': 'nimi-app dev --shell electron',
        'dev:renderer': 'vite --host 127.0.0.1 --port 1468 --strictPort',
        'build:electron': 'tsc -p tsconfig.electron.json',
        'build:shell': 'node -e "process.exit(0)"',
        'test:app': 'node -e "process.exit(0)"',
      },
      dependencies: {
        '@nimiplatform/sdk': lifecycleVersions.sdkVersion,
        '@nimiplatform/kit': lifecycleVersions.kitVersion,
      },
      devDependencies: {
        '@nimiplatform/app-tools': lifecycleVersions.appToolsVersion,
        '@nimiplatform/nimi-coding': lifecycleVersions.nimicodingVersion,
      },
    }, null, 2)}\n`);
    const manifestPath = path.join(target, 'nimi.app.yaml');
    const manifest = [
      'app_id: existing.app',
      'display_name: Existing App',
      'version: 0.1.0',
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
    writeFileSync(path.join(target, 'src-tauri', 'Cargo.toml'), [
      '[package]',
      'name = "existing-app-shell"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      `nimi-shell-tauri = "${lifecycleVersions.nimiShellTauriVersion}"`,
      '',
    ].join('\n'));
    writeFileSync(path.join(target, 'src-tauri', 'tauri.conf.json'), `${JSON.stringify({
      productName: 'Existing App',
      version: '0.1.0',
      identifier: 'ai.nimi.apps.existing.app',
    }, null, 2)}\n`);
    writeFileSync(path.join(target, '.nimi', 'config', 'build-profile.yaml'), [
      'build_profile_ref: existing-test',
      'test_command: pnpm run test:app',
      'build_command: pnpm run build:shell',
      'targets:',
      '  windows-x86_64:',
      '    os: windows',
      '    arch: x86_64',
      '    build_command: pnpm run build:shell',
      '    payload_path: build/windows',
      '    runtime_entry: payload/existing-app.exe',
      'profile_role: developer-workflow-input',
      '',
    ].join('\n'));
    writeInstalledLock(target);

    let result = runNimiApp(['sync', '--dir', target], tempRoot, { env });
    assert.equal(result.status, 0, result.stderr);
    result = runNimiApp(['check', '--dir', target], tempRoot, { env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(target, '.nimi', 'app-scaffold', 'lock.json')), false);

    writeFileSync(manifestPath, manifest.replace(':1468', ':1469'));
    result = runNimiApp(['check', '--dir', target], tempRoot, { env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dev:renderer.*1469/);
    writeFileSync(manifestPath, manifest);

    writeFileSync(path.join(target, 'src', 'bypass.ts'), "import '@grpc/grpc-js';\n");
    result = runNimiApp(['check', '--dir', target], tempRoot, { env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /protected Runtime gRPC client/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('check fails closed on a missing scaffold lock', () => {
  const missingLock = cliScaffold('standalone');
  try {
    rmSync(path.join(missingLock.target, '.nimi/app-scaffold/lock.json'), { force: true });
    const result = runNimiApp(['check', '--dir', missingLock.target], missingLock.tempRoot, { env: missingLock.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing initialized scaffold lock/);
  } finally {
    missingLock.cleanup();
  }

});

test('check fails closed on provider/model hardcoding in product code but not in tests', () => {
  const cases = [
    "export const route = { provider: 'anthropic', model: 'gpt-4o' };\n",
  ];
  for (const source of cases) {
    const generated = cliScaffold('standalone');
    try {
      writeFileSync(path.join(generated.target, 'src/shell/routes/product-area.tsx'), source);
      const result = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
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
    const result = runNimiApp(['check', '--dir', clean.target], clean.tempRoot, { env: clean.env });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    clean.cleanup();
  }
});

test('check fails closed on app-owned Realm permission grant shortcuts', () => {
  const cases = [
    { source: 'export async function bypass(realm) { return realm.permissionGrants.requestMyAppPermissionGrant({ path: {}, body: {} }); }\n', pattern: /Realm permission grant/ },
    { source: "export async function bypass() { return fetch('/api/human/me'); }\n", pattern: /Realm API/ },
    { source: "export const route = '/v1/chat/completions';\n", pattern: /OpenAI-compatible Runtime REST/ },
  ];
  for (const { source, pattern } of cases) {
    const generated = cliScaffold('standalone');
    try {
      writeFileSync(path.join(generated.target, 'src/shell/routes/product-area.tsx'), source);
      const result = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0, source);
      assert.match(result.stderr, pattern, source);
    } finally {
      generated.cleanup();
    }
  }
});

test('check fails closed on installed-app custody bypasses', () => {
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
      const result = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0, source);
      assert.match(result.stderr, pattern, source);
    } finally {
      generated.cleanup();
    }
  }
});

test('check requires official Desktop-supervised development scripts', () => {
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
      const result = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, testCase.pattern);
    } finally {
      generated.cleanup();
    }
  }
});

test('check rejects malformed App access declaration items', () => {
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
      const result = runNimiApp(['check', '--dir', generated.target], generated.tempRoot, { env: generated.env });
      assert.notEqual(result.status, 0, testCase.with);
      assert.match(result.stderr, testCase.pattern, testCase.with);
    } finally {
      generated.cleanup();
    }
  }
});

test('sync fails closed on unsupported locks and classification conflicts', () => {
  const unsupported = cliScaffold('standalone');
  try {
    const lockPath = path.join(unsupported.target, '.nimi/app-scaffold/lock.json');
    const lock = JSON.parse(unsupported.read('.nimi/app-scaffold/lock.json'));
    lock.scaffoldVersion = 'unsupported-version';
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const result = runNimiApp(['sync', '--dir', unsupported.target], unsupported.tempRoot, { env: unsupported.env });
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
    const result = runNimiApp(['sync', '--dir', conflict.target], conflict.tempRoot, { env: conflict.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Scaffold classification conflict/);
  } finally {
    conflict.cleanup();
  }
});

test('app source resolves only scaffoldable slices: neutral skeleton and admitted roots from live Nimi Lab and packaged prepack', () => {
  const packageJson = JSON.parse(readFileSync(path.join(testDir, '..', 'package.json'), 'utf8'));
  // The version projection and snapshot are release artifacts refreshed at pack.
  assert.ok(packageJson.files.includes('templates'));
  assert.ok(packageJson.files.includes('scripts'));
  assert.equal(packageJson.scripts.prepack, 'pnpm run build');
  assert.equal(packageJson.scripts.prepublishOnly, 'pnpm run build');
  assert.equal(
    packageJson.scripts.build,
    'node scripts/sync-scaffold-versions.mjs --apply && node scripts/sync-app-source.mjs --apply',
  );

  // In the monorepo there is no baked snapshot; prepack reads the neutral
  // skeleton plus the exact admitted positive source inventory from apps/lab.
  const { baseDir, manifest } = resolveAppSource();
  assert.match(baseDir, /apps[/\\]lab$/);
  assert.equal(manifest.manifestVersion, 2);
  assert.equal(manifest.sourceApp, 'apps/lab');
  assert.deepEqual(manifest.resolvedModules, [
    'ai-studio-core',
    'studio-create',
    'studio-media',
    'studio-voice',
    'kit-recipes',
    'agent-center',
    'agent-conversation',
    'agent-realtime',
  ]);
  assert.equal(manifest.sourceIdentity.appId, 'nimi.lab');
  assert.equal(manifest.sourceIdentity.packageName, '@nimiplatform/lab');
  assert.equal(manifest.sourceIdentity.tauriIdentifier, 'ai.nimi.apps.nimi.lab');
  assert.equal(manifest.sourceIdentity.cargoPackageName, 'nimiapp-lab-shell');
  assert.equal(manifest.sourceIdentity.rendererEntryId, 'lab-app');
  assert.equal(manifest.sourceIdentity.appTitle, 'Nimi Lab');
  for (const expected of [
    'src/workbench-core/empty-state.tsx',
    'src/workbench-core/index.ts',
    'src/workbench-core/runtime-gate.tsx',
    'src/workbench-core/workbench-core.css',
    'src/workbench-core/workbench-core.tsx',
    'src/ai-studio-core/index.ts',
    'src/studio-modules/studio-create/index.ts',
    'src/studio-modules/studio-media/index.ts',
    'src/studio-modules/studio-voice/index.ts',
    'src/product-modules/kit-recipes/index.tsx',
    'src/product-modules/agent-center/index.tsx',
    'src/product-modules/agent-conversation/index.tsx',
    'src/product-modules/agent-realtime/index.tsx',
  ]) {
    assert.ok(manifest.files.some((entry) => entry.path === expected), expected);
  }
  assert.ok(manifest.files.every((entry) => entry.class === 'app-owned product code'));
  assert.deepEqual(APP_SCAFFOLD_FEATURE_IDS, [
    'studio-create',
    'studio-media',
    'studio-voice',
    'kit-recipes',
    'agent-center',
    'agent-conversation',
    'agent-realtime',
  ]);

  const candidate = resolveAppScaffoldCandidateFeatures(['studio-create']);
  const candidateSource = resolveAppSource({ resolvedModuleIds: candidate.resolvedModuleIds });
  assert.deepEqual(candidateSource.manifest.resolvedModules, ['ai-studio-core', 'studio-create']);
  assert.ok(candidateSource.manifest.files.some((entry) => entry.path === 'src/ai-studio-core/index.ts'));
  assert.ok(candidateSource.manifest.files.some((entry) => entry.path === 'src/studio-modules/studio-create/index.ts'));
  assert.equal(candidateSource.manifest.files.some((entry) => entry.path.startsWith('src/studio-modules/studio-media/')), false);
  assert.equal(candidateSource.manifest.files.some((entry) => entry.path.startsWith('src/studio-modules/studio-voice/')), false);
  assert.equal(candidateSource.manifest.files.some((entry) => entry.path.startsWith('src/product-modules/kit-recipes/')), false);
  assert.ok(candidateSource.manifest.files.every((entry) => entry.class === 'app-owned product code'));

  const fullCandidate = resolveAppScaffoldCandidateFeatures([
    'studio-create',
    'studio-media',
    'studio-voice',
    'kit-recipes',
  ]);
  const fullCandidateSource = resolveAppSource({ resolvedModuleIds: fullCandidate.resolvedModuleIds });
  assert.deepEqual(fullCandidateSource.manifest.resolvedModules, [
    'ai-studio-core',
    'studio-create',
    'studio-media',
    'studio-voice',
    'kit-recipes',
  ]);
  for (const root of [
    'src/ai-studio-core/',
    'src/studio-modules/studio-create/',
    'src/studio-modules/studio-media/',
    'src/studio-modules/studio-voice/',
    'src/product-modules/kit-recipes/',
  ]) {
    assert.ok(fullCandidateSource.manifest.files.some((entry) => entry.path.startsWith(root)), root);
  }
  assert.throws(
    () => resolveAppSource({ resolvedModuleIds: ['studio-create'] }),
    /source module closure is missing dependency: studio-create -> ai-studio-core/,
  );
});

test('generated scaffold mechanically excludes forbidden shortcuts', () => {
  const generated = scaffold('standalone');
  try {
    assert.match(generated.read('.gitignore'), /^node_modules\/$/m);
    assert.match(generated.read('.gitignore'), /^\.nimi\/local\/$/m);
    const joined = [
      'src/shell/auth/runtime-platform.ts',
      'src/shell/workbench-target-adapter.ts',
      'src/shell/routes/product-area.tsx',
      'src/workbench-core/runtime-gate.tsx',
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
  for (const profile of SUPPORTED_APP_SCAFFOLD_PROFILES) {
    const generated = scaffold(profile);
    try {
      const runtimePlatform = generated.read('src/shell/auth/runtime-platform.ts');
      const localAppClient = generated.read('src/shell/auth/local-app-client.ts');
      const targetAdapter = generated.read('src/shell/workbench-target-adapter.ts');
      const runtimeGate = generated.read('src/workbench-core/runtime-gate.tsx');
      const main = generated.read('src/main.tsx');
      const joined = [runtimePlatform, localAppClient, targetAdapter, runtimeGate, main].join('\n');

      assert.doesNotMatch(runtimePlatform, /developer-registered-local-app|developerRegistration/, `${profile} must not retain developer registration`);
      assert.match(runtimePlatform, /'local-app'/, `${profile} keeps the final local-app mode`);
      assert.match(runtimePlatform, /getNimiLocalAppClient/, `${profile} must consume the final SDK client`);
      assert.match(localAppClient, /createNimiClient/, `${profile} must consume the SDK local-app owner surface`);
      assert.match(localAppClient, /createNimiLocalAppStandardShellSurface/, `${profile} must compose the Kit local-app shell`);
      assert.match(runtimePlatform, /!status\.sessionBound/, `${profile} must require a bound local-app session without conflating permissions`);
      assert.match(targetAdapter, /resolveTargetRuntimeGate/, `${profile} must keep Runtime wiring in the target adapter`);
      assert.match(runtimeGate, /WorkbenchRuntimeGate/, `${profile} must consume the shared visible gate`);
      assert.doesNotMatch(runtimePlatform, /createNimiClient|RuntimeOptions|runtime\.account|runtime\.ai|bootstrapArtifact/i, `${profile} must keep non-carrier operations absent`);

    } finally {
      generated.cleanup();
    }
  }
});
