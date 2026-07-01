#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { createAppScaffold } from '../lib/app-scaffold.mjs';
import { doctorApp, initApp } from '../lib/app-doctor-update.mjs';
import { appScaffoldVersions } from '../lib/index.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const profiles = [
  'standalone',
  'workspace-app',
  'tester-reference',
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
      writeFileSync(path.join(targetDir, '.nimi', 'config', 'bootstrap.yaml'), 'source: generated-app-smoke\n');
      writeFileSync(path.join(targetDir, '.nimi', 'contracts', 'result.schema.yaml'), 'source: generated-app-smoke\n');
      writeFileSync(path.join(targetDir, '.nimi', 'methodology', 'core.yaml'), 'source: generated-app-smoke\n');
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

function scaffoldProfile(tempRoot, profile, versions, runners, options = {}) {
  const appId = `smoke.${profile.replaceAll('-', '.')}`;
  const packageName = `smoke-${profile}`;
  const target = path.join(tempRoot, profile);
  createAppScaffold({
    cwd: tempRoot,
    options: {
      dir: target,
      profile,
      appId,
      title: `Smoke ${profile}`,
      packageName,
    },
    versions,
    createFileTree,
    ensureDirEmptyOrMissing(targetDir) {
      if (existsSync(targetDir) && (!statSync(targetDir).isDirectory() || readdirSync(targetDir).length > 0)) {
        throw new Error(`Smoke target must be empty: ${targetDir}`);
      }
    },
    mkdirSync,
  });
  if (options.fakeInitAndDoctor !== false) {
    initApp(tempRoot, { dir: target, json: true }, versions, runners);
    doctorApp(tempRoot, { dir: target, json: true }, versions, runners);
  }
  return target;
}

function runCommand(cwd, display, binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: process.env.CI || '1',
      CARGO_TERM_PROGRESS_WHEN: process.env.CARGO_TERM_PROGRESS_WHEN || 'never',
      ...options.env,
    },
  });
  if (result.status !== 0 || result.error) {
    const output = [
      result.error?.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n').trim();
    throw new Error(`${display} failed in ${cwd}\n${output}`);
  }
}

function runPnpm(cwd, args, display = `pnpm ${args.join(' ')}`) {
  if (process.platform === 'win32') {
    runCommand(cwd, display, 'cmd.exe', ['/d', '/c', 'corepack', 'pnpm', ...args]);
    return;
  }
  runCommand(cwd, display, 'corepack', ['pnpm', ...args]);
}

function runRootPnpm(args, display = `pnpm ${args.join(' ')}`) {
  runPnpm(repoRoot, args, display);
}

function buildWorkspacePackagePrerequisites() {
  runRootPnpm(['--filter', '@nimiplatform/sdk', 'build'], 'pnpm --filter @nimiplatform/sdk build');
  runRootPnpm(['--filter', '@nimiplatform/kit', 'build'], 'pnpm --filter @nimiplatform/kit build');
}

function relativeFileSpec(fromDir, targetDir) {
  const relative = path.relative(fromDir, targetDir).replaceAll(path.sep, '/');
  return `file:${relative.startsWith('.') ? relative : `./${relative}`}`;
}

function rewritePackageForGeneratedSmokeInstall(target, versions) {
  const packageJsonPath = path.join(target, 'package.json');
  const original = readFileSync(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(original);
  packageJson.dependencies['@nimiplatform/sdk'] = relativeFileSpec(target, path.join(repoRoot, 'sdks', 'typescript'));
  packageJson.dependencies['@nimiplatform/kit'] = relativeFileSpec(target, path.join(repoRoot, 'kit'));
  packageJson.devDependencies['@nimiplatform/app-tools'] = relativeFileSpec(target, path.join(repoRoot, 'app-tools'));
  packageJson.devDependencies['@nimiplatform/nimi-coding'] = versions.nimicodingVersion;
  packageJson.pnpm = {
    ...(packageJson.pnpm || {}),
    overrides: {
      ...(packageJson.pnpm?.overrides || {}),
      '@nimiplatform/sdk': packageJson.dependencies['@nimiplatform/sdk'],
      '@nimiplatform/kit': packageJson.dependencies['@nimiplatform/kit'],
      '@nimiplatform/app-tools': packageJson.devDependencies['@nimiplatform/app-tools'],
      '@nimiplatform/nimi-coding': versions.nimicodingVersion,
    },
  };
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return () => writeFileSync(packageJsonPath, original);
}

function relativeCargoPath(fromDir, targetDir) {
  const relative = path.relative(fromDir, targetDir).replaceAll(path.sep, '/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function rewriteCargoForGeneratedSmokeCheck(target) {
  const cargoTomlPath = path.join(target, 'src-tauri', 'Cargo.toml');
  const original = readFileSync(cargoTomlPath, 'utf8');
  const shellPath = relativeCargoPath(path.join(target, 'src-tauri'), path.join(repoRoot, 'kit', 'shell', 'tauri'));
  const rewritten = original.replace(
    /^nimi-shell-tauri\s*=.*$/m,
    `nimi-shell-tauri = { path = "${shellPath}" }`,
  );
  if (rewritten === original) {
    throw new Error(`generated Cargo.toml missing nimi-shell-tauri dependency: ${cargoTomlPath}`);
  }
  writeFileSync(cargoTomlPath, rewritten);
  return () => writeFileSync(cargoTomlPath, original);
}

function replacePackageLink(target, packageName, sourceDir) {
  const packagePathParts = packageName.startsWith('@')
    ? packageName.split('/')
    : [packageName];
  const packagePath = path.join(target, 'node_modules', ...packagePathParts);
  rmSync(packagePath, { recursive: true, force: true });
  mkdirSync(path.dirname(packagePath), { recursive: true });
  symlinkSync(sourceDir, packagePath, process.platform === 'win32' ? 'junction' : 'dir');
}

function writeNimiAppBinShim(target) {
  const binDir = path.join(target, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  const nodePath = process.execPath;
  const appToolsBin = path.join(repoRoot, 'app-tools', 'bin', 'nimi-app.mjs');
  if (process.platform === 'win32') {
    writeFileSync(
      path.join(binDir, 'nimi-app.cmd'),
      [
        '@ECHO off',
        `"${nodePath}" "${appToolsBin}" %*`,
        '',
      ].join('\r\n'),
    );
    return;
  }
  writeFileSync(
    path.join(binDir, 'nimi-app'),
    [
      '#!/usr/bin/env sh',
      `exec "${nodePath}" "${appToolsBin}" "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

function linkStandaloneSmokeToLocalWorkspace(target) {
  replacePackageLink(target, '@nimiplatform/sdk', path.join(repoRoot, 'sdks', 'typescript'));
  replacePackageLink(target, '@nimiplatform/kit', path.join(repoRoot, 'kit'));
  replacePackageLink(target, '@nimiplatform/app-tools', path.join(repoRoot, 'app-tools'));
  writeNimiAppBinShim(target);
}

function runGeneratedInstallInitCheckBuild(target, versions) {
  const restorePackageJson = rewritePackageForGeneratedSmokeInstall(target, versions);
  try {
    runPnpm(target, ['install', '--no-frozen-lockfile'], 'pnpm install --no-frozen-lockfile');
  } finally {
    restorePackageJson();
  }
  linkStandaloneSmokeToLocalWorkspace(target);
  runPnpm(target, ['run', 'init'], 'pnpm run init');
  runPnpm(target, ['run', 'check'], 'pnpm run check');
  runGeneratedNodeTests(target);
  runPnpm(target, ['run', 'build'], 'pnpm run build');
  runGeneratedPack(target);
  assertGeneratedEvidenceBoundary(target);
}

function runGeneratedNodeTests(target) {
  runPnpm(target, ['run', 'test'], 'pnpm run test');
}

function runGeneratedPack(target) {
  runPnpm(target, ['run', 'pack'], 'pnpm run pack');
}

function readGeneratedJson(target, relativePath) {
  return JSON.parse(readFileSync(path.join(target, relativePath), 'utf8'));
}

function assertGeneratedNonTruth(payload, relativePath) {
  for (const field of [
    'publicAdmissionTruth',
    'releaseDescriptorTruth',
    'ordinaryVisibilityTruth',
    'permissionGrantTruth',
    'signingTruth',
    'notarizationTruth',
    'mirrorLicenseClearanceTruth',
  ]) {
    if (payload[field] != null && payload[field] !== 'not-generated') {
      throw new Error(`${relativePath} claims ${field}: ${String(payload[field])}`);
    }
  }
  if (payload.productReadinessClaimAllowed !== false) {
    throw new Error(`${relativePath} must keep productReadinessClaimAllowed=false`);
  }
}

function assertGeneratedEvidenceBoundary(target) {
  const submissionPath = 'dist/nimi-app-submission.json';
  const evidencePath = 'dist/nimi-app-artifact-evidence.json';
  const submission = readGeneratedJson(target, submissionPath);
  const evidence = readGeneratedJson(target, evidencePath);
  assertGeneratedNonTruth(submission, submissionPath);
  assertGeneratedNonTruth(evidence, evidencePath);
  const combined = `${JSON.stringify(submission)}\n${JSON.stringify(evidence)}`;
  for (const forbidden of [
    'community.nimi.fixture.platform-proof',
    'apps/nimi-app-platform-fixture',
    'NIMI_TESTER',
    'nimi.tester',
    'ordinary-visible',
  ]) {
    if (combined.includes(forbidden)) {
      throw new Error(`generated scaffold evidence leaked forbidden product truth: ${forbidden}`);
    }
  }
}

function runGeneratedCargoCheck(target) {
  const restoreCargoToml = rewriteCargoForGeneratedSmokeCheck(target);
  try {
    runCommand(path.join(target, 'src-tauri'), 'cargo check', 'cargo', ['check', '--quiet']);
  } finally {
    restoreCargoToml();
  }
}

function assertPath(target, relativePath, expected) {
  const exists = existsSync(path.join(target, relativePath));
  if (exists !== expected) {
    throw new Error(`${relativePath} ${expected ? 'missing' : 'must not be generated'}`);
  }
}

function assertNoDefaultProfileLeak(target) {
  for (const relativePath of [
    'src/tester',
    'src/shell/ai',
    'src/shell/routes/settings.tsx',
    'src/shell/routes/settings',
    'src-electron',
    'scripts/run-electron-dev.mjs',
    'scripts/check-kit-first-style.mjs',
    'test/electron-acceptance.mjs',
  ]) {
    assertPath(target, relativePath, false);
  }
  const viteConfig = readFileSync(path.join(target, 'vite.config.ts'), 'utf8');
  if (/repoRoot|path\.join\(repoRoot|\.\.\/\.\.\/kit|kit\/ui\/src/.test(viteConfig)) {
    throw new Error('default profile leaked monorepo-only Vite aliases');
  }
  const productArea = readFileSync(path.join(target, 'src', 'shell', 'routes', 'product-area.tsx'), 'utf8');
  if (/TesterWorkbench|WorldTourViewerRoute|tester/i.test(productArea)) {
    throw new Error('default profile leaked tester product route code');
  }
}

function assertTesterReference(target) {
  for (const relativePath of [
    'src/tester/tester-runtime.ts',
    'src/shell/ai/tester-ai-config-settings.tsx',
    'src-electron/main.ts',
    'scripts/run-electron-dev.mjs',
    'test/electron-acceptance.mjs',
  ]) {
    assertPath(target, relativePath, true);
  }
  const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  for (const dependency of ['electron', 'esbuild', 'playwright']) {
    if (!packageJson.devDependencies?.[dependency]) {
      throw new Error(`tester-reference missing ${dependency} devDependency`);
    }
  }
}

function main() {
  const tempRoot = mkdtempSync(path.join(path.parse(repoRoot).root, '.nimi-generated-app-smoke-'));
  const versions = appScaffoldVersions();
  const runners = fakeNimicodingRunners();
  try {
    buildWorkspacePackagePrerequisites();
    for (const profile of profiles) {
      const target = scaffoldProfile(tempRoot, profile, versions, runners, {
        fakeInitAndDoctor: profile !== 'standalone',
      });
      if (profile === 'tester-reference') {
        assertTesterReference(target);
      } else {
        assertNoDefaultProfileLeak(target);
        runGeneratedInstallInitCheckBuild(target, versions);
        runGeneratedCargoCheck(target);
      }
      process.stdout.write(`[generated-app-smoke] ${profile}: OK\n`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[generated-app-smoke] failed: ${message}\n`);
  process.exit(1);
}
