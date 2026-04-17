#!/usr/bin/env node

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { profilePathForScenario, scenarioRegistry, selectScenarios } from '../e2e/helpers/registry.mjs';
import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const CUBISM_WEB_SDK_VERSION = '5-r.5';
const CUBISM_SAMPLE_MODEL = 'Hiyori';

function ensureCubismLive2dSample() {
  const sampleCacheRoot = path.join(repoRoot, 'apps/desktop/.cache/assets/js');
  const sdkRoot = path.join(sampleCacheRoot, `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}`);
  const zipPath = path.join(sdkRoot, `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`);
  const modelPath = path.join(
    sdkRoot,
    'Samples',
    'Resources',
    CUBISM_SAMPLE_MODEL,
    `${CUBISM_SAMPLE_MODEL}.model3.json`,
  );

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Cubism Web SDK zip is missing: ${zipPath}`);
  }
  if (!fs.existsSync(modelPath)) {
    const entry = `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}/Samples/Resources/${CUBISM_SAMPLE_MODEL}/*`;
    const extract = spawnSync('unzip', ['-oq', zipPath, entry, '-d', sampleCacheRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (extract.error) {
      throw extract.error;
    }
    if (extract.status !== 0) {
      throw new Error(`failed to extract Cubism sample ${CUBISM_SAMPLE_MODEL}: ${extract.stderr || extract.stdout || 'unknown unzip error'}`);
    }
  }
  return {
    sampleRoot: path.dirname(modelPath),
    modelFileUrl: pathToFileURL(modelPath).toString(),
  };
}

function parseArgs(argv) {
  const options = {
    suite: 'all',
    scenario: '',
    skipBuild: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--suite') {
      options.suite = String(argv[index + 1] || 'all');
      index += 1;
      continue;
    }
    if (arg === '--scenario') {
      options.scenario = String(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg === '--skip-build') {
      options.skipBuild = true;
    }
  }
  return options;
}

function mergeDeep(baseValue, overrideValue) {
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return overrideValue === undefined ? baseValue : overrideValue;
  }
  if (baseValue && typeof baseValue === 'object' && overrideValue && typeof overrideValue === 'object') {
    const merged = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
      merged[key] = mergeDeep(baseValue[key], value);
    }
    return merged;
  }
  return overrideValue === undefined ? baseValue : overrideValue;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadProfileDefinition(filePath, seen = new Set()) {
  const normalizedPath = path.resolve(filePath);
  if (seen.has(normalizedPath)) {
    throw new Error(`E2E profile extends cycle detected: ${normalizedPath}`);
  }
  seen.add(normalizedPath);
  const current = readJson(normalizedPath);
  const parentName = String(current.extends || '').trim();
  if (!parentName) {
    return current;
  }
  const parentPath = path.resolve(path.dirname(normalizedPath), parentName);
  const parent = loadProfileDefinition(parentPath, seen);
  const rest = { ...current };
  delete rest.extends;
  return mergeDeep(parent, rest);
}

function replacePlaceholders(value, replacements) {
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, replacements));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, replacements)]));
  }
  if (typeof value === 'string') {
    return Object.entries(replacements).reduce(
      (result, [token, replacement]) => result.replaceAll(token, replacement),
      value,
    );
  }
  return value;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildScenarioManifest({ scenarioId, profile, fixtureOrigin }) {
  return replacePlaceholders({
    ...profile,
    scenarioId,
  }, {
    __FIXTURE_ORIGIN__: fixtureOrigin,
    __REPO_ROOT__: repoRoot,
    __CUBISM_SAMPLE_LIVE2D_ROOT__: ensureCubismLive2dSample().sampleRoot,
    __CUBISM_SAMPLE_LIVE2D_MODEL_FILE_URL__: ensureCubismLive2dSample().modelFileUrl,
  });
}

function writeArtifactManifest(filePath, value) {
  writeJson(filePath, value);
}

function applicationPath() {
  const platform = os.platform();
  const binaryBase = path.join(repoRoot, 'apps/desktop/src-tauri/target/release');
  if (platform === 'win32') {
    return path.join(binaryBase, 'nimiplatform-desktop.exe');
  }
  return path.join(binaryBase, 'nimiplatform-desktop');
}

function artifactRoot() {
  const root = path.join(repoRoot, 'apps/desktop/reports/e2e');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function ensureSupportedPlatform() {
  const platform = os.platform();
  if (platform === 'darwin') {
    throw new Error(
      'desktop E2E via tauri-driver is unsupported on macOS per D-GATE-060; run `pnpm check:desktop-e2e-smoke` or `pnpm check:desktop-e2e-journeys` on Linux/Windows CI, and keep macOS to local/manual smoke only',
    );
  }
}

function ensureTauriDriverAvailable() {
  const probe = spawnSync('tauri-driver', ['--version'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (probe.error) {
    throw new Error('`tauri-driver` not found; install it with `cargo install tauri-driver --locked`');
  }
  if (probe.status !== 0) {
    const detail = [probe.stdout, probe.stderr]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' | ');
    throw new Error(detail ? `tauri-driver is not runnable: ${detail}` : 'tauri-driver is not runnable in the current environment');
  }
}

function spawnLogged(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...options.env },
      stdio: options.stdio || 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function buildApplication() {
  await spawnLogged('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'build:renderer']);
  await spawnLogged('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'prepare:runtime-bundle']);
  await spawnLogged('cargo', ['build', '--release', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml']);
}

function waitForPort(host, port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(tryConnect, 250);
      });
    };
    tryConnect();
  });
}

function createLogFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return fs.createWriteStream(filePath, { flags: 'w' });
}

async function runScenario(scenarioId, runIndex) {
  const scenario = scenarioRegistry.get(scenarioId);
  if (!scenario) {
    throw new Error(`missing registry entry for ${scenarioId}`);
  }

  const appPath = applicationPath();
  if (!fs.existsSync(appPath)) {
    throw new Error(`desktop E2E application not found: ${appPath}`);
  }

  const nativeDriver = String(process.env.NIMI_E2E_NATIVE_DRIVER || '').trim();
  const driverPort = Number(process.env.NIMI_E2E_DRIVER_PORT || '4444');
  const driverHost = process.env.NIMI_E2E_DRIVER_HOST || '127.0.0.1';
  const artifactsDir = path.join(artifactRoot(), `${String(runIndex).padStart(2, '0')}-${scenarioId}`);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const backendLogPath = path.join(artifactsDir, 'backend.log');
  const scenarioManifestPath = path.join(artifactsDir, 'scenario-manifest.json');
  const artifactManifestPath = path.join(artifactsDir, 'artifact-manifest.json');

  const profile = loadProfileDefinition(profilePathForScenario(scenarioId));
  writeJson(scenarioManifestPath, {
    scenarioId,
    realmFixture: profile.realmFixture || {},
    tauriFixture: profile.tauriFixture || {},
    artifactPolicy: profile.artifactPolicy || {},
  });
  const fixtureServer = await startRealmFixtureServer({
    manifestPath: scenarioManifestPath,
  });
  const scenarioManifest = buildScenarioManifest({
    scenarioId,
    profile,
    fixtureOrigin: fixtureServer.origin,
  });
  writeJson(scenarioManifestPath, scenarioManifest);

  const driverLog = createLogFile(path.join(artifactsDir, 'tauri-driver.log'));
  const driverArgs = nativeDriver ? ['--native-driver', nativeDriver] : [];
  const driver = spawn('tauri-driver', driverArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      TAURI_WEBVIEW_AUTOMATION: 'true',
      NIMI_E2E_PROFILE: scenarioId,
      NIMI_E2E_FIXTURE_PATH: scenarioManifestPath,
      NIMI_E2E_BACKEND_LOG_PATH: backendLogPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  driver.stdout.pipe(driverLog);
  driver.stderr.pipe(driverLog);

  writeArtifactManifest(artifactManifestPath, {
    scenario_id: scenarioId,
    spec_path: scenario.spec,
    suite_bucket: scenario.bucket,
    fixture_profile: path.relative(repoRoot, profilePathForScenario(scenarioId)),
    fixture_manifest: path.relative(repoRoot, scenarioManifestPath),
    backend_log: path.relative(repoRoot, backendLogPath),
    driver_log: path.relative(repoRoot, path.join(artifactsDir, 'tauri-driver.log')),
    artifact_policy: scenarioManifest.artifactPolicy || {},
    parity_captures: [],
  });

  try {
    await waitForPort(driverHost, driverPort, 20000);
    await spawnLogged(
      'pnpm',
      [
        'exec',
        'wdio',
        'run',
        'apps/desktop/wdio.conf.mjs',
        '--spec',
        scenario.spec,
      ],
      {
        cwd: repoRoot,
        env: {
          NIMI_E2E_APPLICATION: appPath,
          NIMI_E2E_ARTIFACT_DIR: artifactsDir,
          NIMI_E2E_SCENARIO: scenarioId,
          NIMI_E2E_DRIVER_PORT: String(driverPort),
          NIMI_E2E_DRIVER_HOST: driverHost,
          NIMI_E2E_FIXTURE_CONTROL_URL: fixtureServer.controlUrl,
          NIMI_E2E_FIXTURE_PATH: scenarioManifestPath,
          NIMI_E2E_ARTIFACT_MANIFEST: artifactManifestPath,
        },
      },
    );
  } finally {
    driver.kill('SIGTERM');
    driverLog.end();
    await fixtureServer.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureSupportedPlatform();
  ensureTauriDriverAvailable();
  const selectedScenarios = selectScenarios(options);
  if (!options.skipBuild) {
    await buildApplication();
  }
  let runIndex = 0;
  for (const scenarioId of selectedScenarios) {
    runIndex += 1;
    await runScenario(scenarioId, runIndex);
  }
}

main().catch((error) => {
  process.stderr.write(`[desktop-e2e] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
