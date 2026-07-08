#!/usr/bin/env node

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ELECTRON_HOST_RUNNER,
  WDIO_RUNNER,
  isWdioScenarioEntry,
  profilePathForScenario,
  scenarioEntryForId,
  scenarioRunner,
  selectScenarios,
} from '../e2e/helpers/registry.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const CUBISM_WEB_SDK_VERSION = '5-r.5';
const CUBISM_SAMPLE_MODEL = 'Hiyori';
const SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET = String(
  process.env.SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET || 'desktop-e2e-source-materialization-secret',
);

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

function buildScenarioManifest({ scenarioId, profile, fixtureOrigin, artifactsDir }) {
  const profileText = JSON.stringify(profile);
  const cubism = profileText.includes('__CUBISM_SAMPLE_LIVE2D_')
    ? ensureCubismLive2dSample()
    : null;
  return replacePlaceholders({
    ...profile,
    scenarioId,
  }, {
    __FIXTURE_ORIGIN__: fixtureOrigin,
    __REPO_ROOT__: repoRoot,
    __E2E_DATA_ROOT__: path.join(artifactsDir, 'nimi-data'),
    __E2E_RUNTIME_CONFIG_PATH__: path.join(artifactsDir, 'runtime', 'config.json'),
    __CUBISM_SAMPLE_LIVE2D_ROOT__: cubism?.sampleRoot || '',
    __CUBISM_SAMPLE_LIVE2D_MODEL_FILE_URL__: cubism?.modelFileUrl || '',
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

function resetArtifactRoot() {
  const root = path.resolve(repoRoot, 'apps/desktop/reports/e2e');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function resetArtifactDir(artifactsDir) {
  const root = path.resolve(repoRoot, 'apps/desktop/reports/e2e');
  const resolved = path.resolve(artifactsDir);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`refusing to reset E2E artifact directory outside ${root}: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function ensureSupportedPlatform() {
  const platform = os.platform();
  if (platform === 'darwin') {
    throw new Error(
      'desktop E2E via tauri-driver is unsupported on macOS per D-GATE-060; run `pnpm check:desktop-e2e-smoke` or `pnpm check:desktop-e2e-journeys` on Linux/Windows CI, and keep macOS to local/manual smoke only',
    );
  }
}

async function loadRealmFixtureServer() {
  const module = await import('../e2e/fixtures/realm-fixture-server.mjs');
  if (typeof module.startRealmFixtureServer !== 'function') {
    throw new Error('realm fixture server module must export startRealmFixtureServer()');
  }
  return module.startRealmFixtureServer;
}

function ensureTauriDriverAvailable() {
  const probe = spawnSync('tauri-driver', ['--help'], {
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

function hasPathSeparator(input) {
  return /[\\/]/.test(input);
}

function firstOutputLine(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function resolveCommandPath(command) {
  const resolver = os.platform() === 'win32' ? 'where.exe' : 'which';
  const probe = spawnSync(resolver, [command], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (probe.error || probe.status !== 0) {
    return '';
  }
  return firstOutputLine(probe.stdout);
}

function resolveWindowsEdgeVersion() {
  const script = [
    "$paths = @(",
    "  Join-Path ${env:ProgramFiles(x86)} 'Microsoft\\Edge\\Application\\msedge.exe',",
    "  Join-Path ${env:ProgramFiles} 'Microsoft\\Edge\\Application\\msedge.exe'",
    ")",
    "foreach ($path in $paths) {",
    "  if (Test-Path -LiteralPath $path) {",
    "    $version = (Get-Item -LiteralPath $path).VersionInfo.ProductVersion",
    "    if ($version) { Write-Output $version; exit 0 }",
    "  }",
    "}",
    "$beacon = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Edge\\BLBeacon' -ErrorAction SilentlyContinue",
    "if ($beacon.version) { Write-Output $beacon.version; exit 0 }",
    "exit 1",
  ].join('\n');
  const probe = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (probe.error || probe.status !== 0) {
    return '';
  }
  return firstOutputLine(probe.stdout);
}

async function ensureWindowsEdgeDriverPath() {
  const fromPath = resolveCommandPath('msedgedriver.exe');
  if (fromPath) {
    return fromPath;
  }

  const version = resolveWindowsEdgeVersion();
  if (!version) {
    throw new Error('msedgedriver.exe is not on PATH and Microsoft Edge version could not be resolved; set NIMI_E2E_NATIVE_DRIVER to a compatible native WebDriver binary');
  }

  const driverDir = path.join(repoRoot, 'apps/desktop/.cache/tools/msedgedriver', version);
  const driverPath = path.join(driverDir, 'msedgedriver.exe');
  if (fs.existsSync(driverPath)) {
    return driverPath;
  }

  fs.mkdirSync(driverDir, { recursive: true });
  const zipPath = path.join(driverDir, 'edgedriver_win64.zip');
  const url = `https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download Edge WebDriver ${version}: ${response.status} ${response.statusText}`);
  }
  fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
  const extract = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -LiteralPath ${shellSingleQuote(zipPath)} -DestinationPath ${shellSingleQuote(driverDir)} -Force`,
  ], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (extract.error || extract.status !== 0) {
    const detail = [extract.error?.message, extract.stderr, extract.stdout]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' | ');
    throw new Error(detail ? `failed to extract Edge WebDriver ${version}: ${detail}` : `failed to extract Edge WebDriver ${version}`);
  }
  if (!fs.existsSync(driverPath)) {
    throw new Error(`Edge WebDriver ${version} archive did not produce ${driverPath}`);
  }
  return driverPath;
}

async function resolveNativeDriverPath(nativeDriver) {
  const normalized = String(nativeDriver || '').trim();
  if (!normalized) {
    if (os.platform() === 'win32') {
      return ensureWindowsEdgeDriverPath();
    }
    return '';
  }
  if (hasPathSeparator(normalized)) {
    return normalized;
  }

  const resolved = resolveCommandPath(normalized);
  if (!resolved) {
    throw new Error(`native WebDriver binary ${JSON.stringify(normalized)} is not resolvable`);
  }
  return resolved;
}

function requiresShell(command) {
  return os.platform() === 'win32' && command === 'pnpm';
}

function spawnLogged(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...options.env },
      stdio: options.stdio || 'inherit',
      shell: options.shell ?? requiresShell(command),
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
  await spawnLogged('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'prepare:runtime-bundle']);
  await spawnLogged('pnpm', [
    '--filter',
    '@nimiplatform/desktop',
    'run',
    'tauri',
    'build',
    '--config',
    'src-tauri/tauri.conf.json',
    '--no-bundle',
    '--ci',
    '--features',
    'desktop-e2e-fixture',
  ]);
}

async function buildElectronApplication() {
  await spawnLogged('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'build:renderer']);
  await spawnLogged('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'build:electron']);
}

function waitForPort(host, port, timeoutMs = 15000, shouldAbort) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const abortReason = shouldAbort?.();
      if (abortReason) {
        reject(new Error(abortReason));
        return;
      }
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

function waitForPortClosed(host, port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`timed out waiting for ${host}:${port} to close`));
          return;
        }
        setTimeout(tryConnect, 250);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve();
      });
    };
    tryConnect();
  });
}

function parsePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${label} must be an integer TCP port from 1 to 65535`);
  }
  return port;
}

function findFreePort(host, excluded = new Set()) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!address || typeof address === 'string') {
          reject(new Error(`failed to resolve free TCP port on ${host}`));
          return;
        }
        if (excluded.has(address.port)) {
          findFreePort(host, excluded).then(resolve, reject);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function resolveDriverPorts(host) {
  const driverPort = process.env.NIMI_E2E_DRIVER_PORT
    ? parsePort(process.env.NIMI_E2E_DRIVER_PORT, 'NIMI_E2E_DRIVER_PORT')
    : await findFreePort(host);
  const nativeDriverPort = process.env.NIMI_E2E_NATIVE_DRIVER_PORT
    ? parsePort(process.env.NIMI_E2E_NATIVE_DRIVER_PORT, 'NIMI_E2E_NATIVE_DRIVER_PORT')
    : await findFreePort(host, new Set([driverPort]));
  if (driverPort === nativeDriverPort) {
    throw new Error(`tauri-driver port and native WebDriver port must differ: ${driverPort}`);
  }
  return { driverPort, nativeDriverPort };
}

function createLogFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return fs.createWriteStream(filePath, { flags: 'w' });
}

function waitForExit(child, timeoutMs = 10000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error(`process ${child.pid || 'unknown'} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.once('exit', onExit);
  });
}

async function terminateProcessTree(child) {
  if (!child.pid) {
    return;
  }
  if (os.platform() === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
    });
  } else {
    child.kill('SIGTERM');
  }
  try {
    await waitForExit(child, 10000);
  } catch {
    if (os.platform() !== 'win32') {
      child.kill('SIGKILL');
      await waitForExit(child, 5000);
    }
  }
}

async function runScenario(scenarioId, runIndex) {
  const scenario = scenarioEntryForId(scenarioId);
  if (!scenario) {
    throw new Error(`missing registry entry for ${scenarioId}`);
  }
  if (!isWdioScenarioEntry(scenario)) {
    throw new Error(`scenario ${scenarioId} is owned by ${scenarioRunner(scenario)}; use scripts/run-macos-smoke.mjs`);
  }

  const appPath = applicationPath();
  if (!fs.existsSync(appPath)) {
    throw new Error(`desktop E2E application not found: ${appPath}`);
  }

  const nativeDriver = await resolveNativeDriverPath(process.env.NIMI_E2E_NATIVE_DRIVER);
  const driverHost = process.env.NIMI_E2E_DRIVER_HOST || '127.0.0.1';
  const { driverPort, nativeDriverPort } = await resolveDriverPorts(driverHost);
  const artifactsDir = path.join(artifactRoot(), `${String(runIndex).padStart(2, '0')}-${scenarioId}`);
  const e2eHomeDir = path.join(artifactsDir, 'home');
  const desktopSpecPath = path.relative(desktopRoot, path.join(repoRoot, scenario.spec));
  resetArtifactDir(artifactsDir);
  fs.mkdirSync(e2eHomeDir, { recursive: true });
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
  const startRealmFixtureServer = await loadRealmFixtureServer();
  const fixtureServer = await startRealmFixtureServer({
    manifestPath: scenarioManifestPath,
  });
  const scenarioManifest = buildScenarioManifest({
    scenarioId,
    profile,
    fixtureOrigin: fixtureServer.origin,
    artifactsDir,
  });
  writeJson(scenarioManifestPath, scenarioManifest);

  const driverLog = createLogFile(path.join(artifactsDir, 'tauri-driver.log'));
  const driverArgs = [
    '--port',
    String(driverPort),
    '--native-port',
    String(nativeDriverPort),
    ...(nativeDriver ? ['--native-driver', nativeDriver] : []),
  ];
  const driver = spawn('tauri-driver', driverArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      TAURI_WEBVIEW_AUTOMATION: 'true',
      HOME: e2eHomeDir,
      USERPROFILE: e2eHomeDir,
      NIMI_E2E_HOME_DIR: e2eHomeDir,
      NIMI_E2E_PROFILE: scenarioId,
      NIMI_E2E_FIXTURE_PATH: scenarioManifestPath,
      NIMI_E2E_BACKEND_LOG_PATH: backendLogPath,
      SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  driver.stdout.pipe(driverLog);
  driver.stderr.pipe(driverLog);
  let driverExit = null;
  driver.on('exit', (code, signal) => {
    driverExit = { code, signal };
  });

  writeArtifactManifest(artifactManifestPath, {
    scenario_id: scenarioId,
    spec_path: scenario.spec,
    suite_bucket: scenario.bucket,
    fixture_profile: path.relative(repoRoot, profilePathForScenario(scenarioId)),
    fixture_manifest: path.relative(repoRoot, scenarioManifestPath),
    backend_log: path.relative(repoRoot, backendLogPath),
    driver_log: path.relative(repoRoot, path.join(artifactsDir, 'tauri-driver.log')),
    driver_port: driverPort,
    native_driver_port: nativeDriverPort,
    e2e_home_dir: path.relative(repoRoot, e2eHomeDir),
    artifact_policy: scenarioManifest.artifactPolicy || {},
    parity_captures: [],
  });

  try {
    await waitForPort(driverHost, driverPort, 20000, () => {
      if (!driverExit) {
        return '';
      }
      const suffix = driverExit.signal
        ? `signal ${driverExit.signal}`
        : `code ${driverExit.code}`;
      return `tauri-driver exited before opening ${driverHost}:${driverPort} (${suffix}); see ${path.join(artifactsDir, 'tauri-driver.log')}`;
    });
    await spawnLogged(
      'pnpm',
      [
        '--filter',
        '@nimiplatform/desktop',
        'exec',
        'wdio',
        'run',
        'wdio.conf.mjs',
        '--spec',
        desktopSpecPath,
      ],
      {
        cwd: repoRoot,
        env: {
          NIMI_E2E_APPLICATION: appPath,
          NIMI_E2E_ARTIFACT_DIR: artifactsDir,
          NIMI_E2E_PROFILE: scenarioId,
          NIMI_E2E_SCENARIO: scenarioId,
          NIMI_E2E_DRIVER_PORT: String(driverPort),
          NIMI_E2E_DRIVER_HOST: driverHost,
          NIMI_E2E_FIXTURE_CONTROL_URL: fixtureServer.controlUrl,
          NIMI_E2E_FIXTURE_PATH: scenarioManifestPath,
          NIMI_E2E_ARTIFACT_MANIFEST: artifactManifestPath,
          NIMI_E2E_HOME_DIR: e2eHomeDir,
          SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET,
        },
      },
    );
  } finally {
    await terminateProcessTree(driver);
    await waitForPortClosed(driverHost, driverPort, 10000);
    await waitForPortClosed(driverHost, nativeDriverPort, 10000);
    driverLog.end();
    await fixtureServer.close();
  }
}

async function runElectronHostScenario(scenarioId, runIndex) {
  const scenario = scenarioEntryForId(scenarioId);
  if (!scenario) {
    throw new Error(`missing registry entry for ${scenarioId}`);
  }
  if (scenarioRunner(scenario) !== ELECTRON_HOST_RUNNER) {
    throw new Error(`scenario ${scenarioId} is owned by ${scenarioRunner(scenario)}; expected ${ELECTRON_HOST_RUNNER}`);
  }

  const artifactsDir = path.join(artifactRoot(), `${String(runIndex).padStart(2, '0')}-${scenarioId}`);
  resetArtifactDir(artifactsDir);
  const scenarioManifestPath = path.join(artifactsDir, 'scenario-manifest.json');
  const artifactManifestPath = path.join(artifactsDir, 'artifact-manifest.json');
  const profile = loadProfileDefinition(profilePathForScenario(scenarioId));
  const scenarioManifest = buildScenarioManifest({
    scenarioId,
    profile,
    fixtureOrigin: '',
    artifactsDir,
  });
  writeJson(scenarioManifestPath, scenarioManifest);
  writeArtifactManifest(artifactManifestPath, {
    scenario_id: scenarioId,
    spec_path: scenario.spec,
    suite_bucket: scenario.bucket,
    runner: ELECTRON_HOST_RUNNER,
    fixture_profile: path.relative(repoRoot, profilePathForScenario(scenarioId)),
    fixture_manifest: path.relative(repoRoot, scenarioManifestPath),
    artifact_policy: scenarioManifest.artifactPolicy || {},
    parity_captures: [],
  });

  const specPath = path.join(repoRoot, scenario.spec);
  if (!fs.existsSync(specPath)) {
    throw new Error(`desktop Electron host E2E spec is missing: ${scenario.spec}`);
  }
  const module = await import(pathToFileURL(specPath).toString());
  if (typeof module.runElectronHostScenario !== 'function') {
    throw new Error(`${scenario.spec} must export runElectronHostScenario()`);
  }
  await module.runElectronHostScenario({
    scenarioId,
    repoRoot,
    desktopRoot,
    artifactsDir,
    scenarioManifest,
    scenarioManifestPath,
    artifactManifestPath,
    sourceMaterializationPacketHmacSecret: SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET,
  });
}

function isRunE2eRunner(entry) {
  const runner = scenarioRunner(entry);
  return runner === WDIO_RUNNER || runner === ELECTRON_HOST_RUNNER;
}

function selectRunE2eScenarios(options) {
  return selectScenarios(options).filter((scenarioId) => {
    const entry = scenarioEntryForId(scenarioId);
    if (entry && isRunE2eRunner(entry)) {
      return true;
    }
    if (options.scenario) {
      throw new Error(`scenario ${scenarioId} is owned by ${scenarioRunner(entry)}; use the owning runner`);
    }
    return false;
  });
}

function assertSelectedScenarios(options, selectedScenarios) {
  if (selectedScenarios.length > 0) {
    return;
  }
  if (options.suite === 'nimi-app-platform-ordinary') {
    throw new Error(
      'nimi-app-platform-ordinary is blocked until a real ordinary-visible descriptor is admitted; no ordinary descriptor E2E scenario is registered',
    );
  }
  if (options.suite === 'nimi-app-platform-live-sandbox') {
    throw new Error(
      'nimi-app-platform-live-sandbox is blocked until an integrated Runtime install/open/launch E2E starts Runtime, serves a TLS immutable artifact, installs through appinstallgateway, consumes the real OpenApp launch resolution, and captures Runtime/host/app attestations',
    );
  }
  if (options.suite && options.suite !== 'all') {
    throw new Error(`E2E suite ${options.suite} selected no runnable scenarios`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedScenarios = selectRunE2eScenarios(options);
  assertSelectedScenarios(options, selectedScenarios);
  resetArtifactRoot();
  const selectedEntries = selectedScenarios.map((scenarioId) => scenarioEntryForId(scenarioId));
  const hasWdio = selectedEntries.some((entry) => entry && isWdioScenarioEntry(entry));
  const hasElectronHost = selectedEntries.some((entry) => entry && scenarioRunner(entry) === ELECTRON_HOST_RUNNER);
  if (hasWdio) {
    ensureSupportedPlatform();
    ensureTauriDriverAvailable();
  }
  if (!options.skipBuild && hasWdio) {
    await buildApplication();
  }
  if (!options.skipBuild && hasElectronHost) {
    await buildElectronApplication();
  }
  let runIndex = 0;
  for (const scenarioId of selectedScenarios) {
    runIndex += 1;
    const entry = scenarioEntryForId(scenarioId);
    if (isWdioScenarioEntry(entry)) {
      await runScenario(scenarioId, runIndex);
      continue;
    }
    if (scenarioRunner(entry) === ELECTRON_HOST_RUNNER) {
      await runElectronHostScenario(scenarioId, runIndex);
      continue;
    }
    throw new Error(`scenario ${scenarioId} is owned by unsupported runner ${scenarioRunner(entry)}`);
  }
}

main().catch((error) => {
  process.stderr.write(`[desktop-e2e] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
