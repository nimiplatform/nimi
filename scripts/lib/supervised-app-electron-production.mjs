import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { packager } from '@electron/packager';
import { flipFuses, FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';
import { parse as parseYaml } from 'yaml';
import { spawnSyncCommand } from './command-runner.mjs';
import { publishBuildOutput, temporaryOutputPath } from './build-output-publisher.mjs';

// The root workspace owns compilation and dependency materialization. App
// Tools remains the sole .nimiapp pack owner; this produces its native input.
export async function buildSupervisedAppElectronProduction({ repoRoot, consumer }) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('This production builder currently supports only native macOS arm64.');
  }
  const appRoot = path.join(repoRoot, 'apps', consumer);
  const appManifest = await readJson(path.join(appRoot, 'package.json'));
  const appDeclaration = parseYaml(await readFile(path.join(appRoot, 'nimi.app.yaml'), 'utf8'));
  const executableName = `nimiplatform-${consumer}-shell`;
  const bundleId = `ai.nimi.apps.${appDeclaration.app_id}`;
  if (appManifest.name !== `@nimiplatform/${consumer}` || appManifest.version !== appDeclaration.version) {
    throw new Error('App package and declaration must identify the same workspace consumer and version.');
  }
  const requireFromApp = createRequire(path.join(appRoot, 'package.json'));
  const { build } = await import(requireFromApp.resolve('esbuild'));
  const electronPackage = await readJson(requireFromApp.resolve('electron/package.json'));
  const buildParent = path.join(repoRoot, '.nimi', 'local', 'build');
  await mkdir(buildParent, { recursive: true });
  const staging = await realpath(await mkdtemp(path.join(buildParent, `${consumer}-production-`)));
  const sourceRoot = path.join(staging, 'app');
  try {
    runChecked('pnpm', ['run', 'build:prepared'], appRoot);
    runChecked('pnpm', ['exec', 'tsc', '-p', 'tsconfig.electron.json', '--noEmit'], appRoot);
    // Legacy deploy resolves the workspace declarations and materializes all
    // production dependencies. It is not a frozen replay of the root lock.
    // Current local SDK, Kit and native package versions are verified below.
    runChecked('pnpm', [
      '--filter', appManifest.name, '--config.node-linker=hoisted',
      '--ignore-scripts', 'deploy', '--prod', '--legacy', sourceRoot,
    ], repoRoot);
    for (const entry of await readdir(sourceRoot)) {
      if (entry !== 'node_modules' && entry !== 'package.json') {
        await rm(path.join(sourceRoot, entry), { recursive: true, force: true });
      }
    }
    await cp(path.join(appRoot, 'dist'), path.join(sourceRoot, 'dist'), { recursive: true });
    await realpath(path.join(sourceRoot, 'dist', 'index.html'));
    await mkdir(path.join(sourceRoot, 'dist-electron'));
    await build({
      absWorkingDir: appRoot,
      entryPoints: [path.join(appRoot, 'src-electron/main.ts')],
      outfile: path.join(sourceRoot, 'dist-electron/main.js'),
      bundle: true, platform: 'node', target: 'node22', format: 'esm',
      packages: 'external', external: ['electron'],
      define: { __NIMI_ELECTRON_PRODUCTION__: 'true' },
    });
    await build({
      absWorkingDir: appRoot,
      entryPoints: [path.join(appRoot, 'src-electron/preload.cts')],
      outfile: path.join(sourceRoot, 'dist-electron/preload.cjs'),
      bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'],
    });
    const productionManifest = await readJson(path.join(sourceRoot, 'package.json'));
    delete productionManifest.devDependencies;
    delete productionManifest.scripts;
    for (const name of ['sdk', 'kit']) {
      const expected = await readJson(path.join(repoRoot, name === 'sdk' ? 'sdks/typescript' : 'kit', 'package.json'));
      const deployed = await readJson(path.join(sourceRoot, 'node_modules/@nimiplatform', name, 'package.json'));
      if (deployed.version !== expected.version) throw new Error(`Stale deployed ${name} package.`);
      await realpath(path.join(sourceRoot, 'node_modules/@nimiplatform', name, 'dist'));
      productionManifest.dependencies[`@nimiplatform/${name}`] = deployed.version;
    }
    await writeFile(path.join(sourceRoot, 'package.json'), `${JSON.stringify(productionManifest, null, 2)}\n`);
    const nativeName = '@nimiplatform/kit-protected-local-darwin-arm64';
    const nativeRoot = path.join(sourceRoot, 'node_modules', ...nativeName.split('/'));
    const nativeManifest = await readJson(path.join(nativeRoot, 'package.json'));
    const expectedNative = await readJson(path.join(repoRoot, 'kit/shell/protected-local-node/npm/darwin-arm64/package.json'));
    if (nativeManifest.version !== expectedNative.version) throw new Error('Stale deployed native carrier.');
    await realpath(path.join(nativeRoot, 'nimi_shell_protected_local.node'));
    const nativeResources = path.join(staging, 'nimi-native', 'protected-local');
    await mkdir(path.dirname(nativeResources), { recursive: true });
    await cp(nativeRoot, nativeResources, { recursive: true, dereference: true });
    await rm(nativeRoot, { recursive: true, force: true });
    await assertContainedLinks(sourceRoot, sourceRoot);
    const packageOutput = path.join(staging, 'package');
    const packagePaths = await packager({
      dir: sourceRoot, platform: 'darwin', arch: 'arm64',
      appBundleId: bundleId, name: executableName, executableName,
      appVersion: appManifest.version, buildVersion: appManifest.version,
      electronVersion: electronPackage.version,
      out: packageOutput, tmpdir: path.join(staging, 'packager'),
      overwrite: false, prune: false, quiet: true, derefSymlinks: true,
      asar: { unpack: '**/*.{node,dylib,dll}' },
      extraResource: [path.join(staging, 'nimi-native')],
      afterExtract: [async ({ buildPath }) => {
        // --inspect-brk takes effect before App main can reject it. Disable
        // only this Node inspector path in the candidate before signing.
        await flipFuses(path.join(buildPath, 'Electron.app'), {
          version: FuseVersion.V1,
          [FuseV1Options.EnableNodeCliInspectArguments]: false,
          resetAdHocDarwinSignature: true,
        });
      }],
      // Publisher-side local ad-hoc sealing provides no Developer ID or notarization.
      osxSign: {
        identity: '-', identityValidation: false, preAutoEntitlements: false,
        preEmbedProvisioningProfile: false, strictVerify: true,
        optionsForFile: () => ({ entitlements: [], hardenedRuntime: false, timestamp: 'none' }),
      },
    });
    const expectedPackage = path.join(packageOutput, `${executableName}-darwin-arm64`);
    if (packagePaths.length !== 1 || path.resolve(packagePaths[0]) !== expectedPackage) {
      throw new Error('Electron packager returned an unexpected package path.');
    }
    await realpath(path.join(expectedPackage, `${executableName}.app`, 'Contents/MacOS', executableName));
    const fuseWire = await getCurrentFuseWire(path.join(expectedPackage, `${executableName}.app`));
    if (fuseWire[FuseV1Options.EnableNodeCliInspectArguments] !== FuseState.DISABLE) {
      throw new Error('Production Electron Node CLI inspector fuse was not disabled.');
    }
    runChecked('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(expectedPackage, `${executableName}.app`)], repoRoot);
    const output = path.join(appRoot, 'dist-electron-package');
    // Publish only a fully built and sealed payload, retaining the previous
    // local candidate until this replacement is ready.
    const publishStage = temporaryOutputPath(output, 'staging');
    try {
      // Framework links are relative members of the signed bundle. Rewriting
      // them to this disposable build directory would break the final payload.
      await cp(packageOutput, publishStage, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
      await assertContainedLinks(publishStage, publishStage);
      runChecked('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(publishStage, `${executableName}-darwin-arm64`, `${executableName}.app`)], repoRoot);
      publishBuildOutput(publishStage, output);
    }
    finally { await rm(publishStage, { recursive: true, force: true }); }
    process.stdout.write(`[${consumer}] production payload ${output}; SDK/Kit/native versions verified\n`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function runChecked(command, args, cwd) {
  const result = spawnSyncCommand(command, args, { cwd, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function assertContainedLinks(root, directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const resolved = await realpath(target);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Production dependency link escapes the materialized payload: ${path.relative(root, target)}`);
      }
    } else if (entry.isDirectory()) await assertContainedLinks(root, target);
  }
}
