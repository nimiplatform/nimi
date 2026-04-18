#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  isDynamicLive2dSampleScenario,
  profilePathForScenario,
  scenarioEntryForId,
  selectScenarios,
} from '../e2e/helpers/registry.mjs';
import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const CUBISM_WEB_SDK_VERSION = '5-r.5';
const DEFAULT_CUBISM_SAMPLE_MODEL = 'Hiyori';
const LIVE2D_SMOKE_SCENARIO_PREFIX = 'chat.live2d-render-smoke-';
const VRM_SAMPLE_CATALOG = {
  'chat.vrm-lifecycle-smoke': {
    resourceId: 'fixture-vrm-constraint-twist',
    displayName: 'Fixture Constraint Twist VRM',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  },
  'chat.vrm-speaking-smoke': {
    resourceId: 'fixture-vrm-constraint-twist',
    displayName: 'Fixture Constraint Twist VRM',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  },
  'chat.vrm-speaking-smoke-no-viseme': {
    resourceId: 'fixture-vrm-constraint-twist',
    displayName: 'Fixture Constraint Twist VRM',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  },
  'chat.vrm-listening-smoke': {
    resourceId: 'fixture-vrm-constraint-twist',
    displayName: 'Fixture Constraint Twist VRM',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  },
  'chat.vrm-thinking-smoke': {
    resourceId: 'fixture-vrm-constraint-twist',
    displayName: 'Fixture Constraint Twist VRM',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
  },
  'chat.vrm-lifecycle-smoke-avatar-sample-a': {
    resourceId: 'fixture-vrm-avatar-sample-a',
    displayName: 'Fixture Avatar Sample A VRM',
    filename: 'AvatarSample_A.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_A.vrm',
  },
  'chat.vrm-lifecycle-smoke-avatar-sample-b': {
    resourceId: 'fixture-vrm-avatar-sample-b',
    displayName: 'Fixture Avatar Sample B VRM',
    filename: 'AvatarSample_B.vrm',
    sourceUrl: 'https://raw.githubusercontent.com/pixiv/local-chat-vrm/main/public/AvatarSample_B.vrm',
  },
};

function ensureCubismLive2dSample(modelName = DEFAULT_CUBISM_SAMPLE_MODEL) {
  const sampleCacheRoot = path.join(repoRoot, 'apps/desktop/.cache/assets/js');
  const sdkRoot = path.join(sampleCacheRoot, `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}`);
  const zipPath = path.join(sdkRoot, `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`);
  const modelPath = path.join(
    sdkRoot,
    'Samples',
    'Resources',
    modelName,
    `${modelName}.model3.json`,
  );

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Cubism Web SDK zip is missing: ${zipPath}`);
  }
  if (!fs.existsSync(modelPath)) {
    const entry = `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}/Samples/Resources/${modelName}/*`;
    const extract = spawnSync('unzip', ['-oq', zipPath, entry, '-d', sampleCacheRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (extract.error) {
      throw extract.error;
    }
    if (extract.status !== 0) {
      throw new Error(`failed to extract Cubism sample ${modelName}: ${extract.stderr || extract.stdout || 'unknown unzip error'}`);
    }
  }
  return {
    modelName,
    sampleRoot: path.dirname(modelPath),
    modelFileUrl: pathToFileURL(modelPath).toString(),
  };
}

function vrmSampleDefinitionForScenario(scenarioId) {
  return VRM_SAMPLE_CATALOG[scenarioId] || null;
}

async function ensureVrmSample(sampleDefinition) {
  const sampleCacheRoot = path.join(repoRoot, 'apps/desktop/.cache/assets/vrm');
  const samplePath = path.join(sampleCacheRoot, sampleDefinition.filename);
  fs.mkdirSync(sampleCacheRoot, { recursive: true });
  if (!fs.existsSync(samplePath) || fs.statSync(samplePath).size <= 0) {
    const response = await fetch(sampleDefinition.sourceUrl);
    if (!response.ok) {
      throw new Error(`failed to download VRM sample ${sampleDefinition.sourceUrl}: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(samplePath, Buffer.from(arrayBuffer));
  }
  return {
    ...sampleDefinition,
    sampleRoot: sampleCacheRoot,
    sampleFileUrl: pathToFileURL(samplePath).toString(),
  };
}

function cubismSampleModelForScenario(scenarioId) {
  switch (scenarioId) {
    case 'chat.live2d-render-smoke-mark':
    case 'chat.live2d-render-smoke-mark-speaking':
      return 'Mark';
    case 'chat.live2d-render-smoke':
      return DEFAULT_CUBISM_SAMPLE_MODEL;
    default:
      if (scenarioId.startsWith(LIVE2D_SMOKE_SCENARIO_PREFIX)) {
        const suffix = scenarioId.slice(LIVE2D_SMOKE_SCENARIO_PREFIX.length);
        if (suffix) {
          return suffix
            .split('-')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
        }
      }
      return DEFAULT_CUBISM_SAMPLE_MODEL;
  }
}

function cubismSampleProfileTokensForScenario(scenarioId) {
  const modelName = cubismSampleModelForScenario(scenarioId);
  return {
    resourceId: `fixture-live2d-${modelName.toLowerCase()}`,
    displayName: `Fixture ${modelName} Live2D`,
    modelFilename: `${modelName}.model3.json`,
  };
}

function parseArgs(argv) {
  const options = {
    suite: 'all',
    scenario: '',
    skipBuild: false,
    timeoutMs: 45000,
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
    if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[index + 1] || '45000') || 45000;
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function applicationPath() {
  const bundleRoot = path.join(repoRoot, 'apps/desktop/src-tauri/target/release/bundle/macos');
  if (!fs.existsSync(bundleRoot)) {
    throw new Error(`desktop macOS app bundle not found: ${bundleRoot}`);
  }
  const appEntry = fs.readdirSync(bundleRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  if (!appEntry) {
    throw new Error(`desktop macOS app bundle is missing under ${bundleRoot}`);
  }
  const macOsDir = path.join(bundleRoot, appEntry.name, 'Contents', 'MacOS');
  const executable = fs.readdirSync(macOsDir, { withFileTypes: true })
    .find((entry) => entry.isFile());
  if (!executable) {
    throw new Error(`desktop macOS bundle executable is missing under ${macOsDir}`);
  }
  return path.join(macOsDir, executable.name);
}

async function spawnLogged(command, args, options = {}) {
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
  await spawnLogged('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'prepare:runtime-bundle']);
  await spawnLogged('pnpm', [
    '--filter',
    '@nimiplatform/desktop',
    'exec',
    'tauri',
    'build',
    '--bundles',
    'app',
    '--no-sign',
  ]);
}

function ensureSupportedPlatform() {
  if (os.platform() !== 'darwin') {
    throw new Error('desktop macOS smoke only supports darwin hosts');
  }
}

function createLogFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return fs.createWriteStream(filePath, { flags: 'w' });
}

function makeRunRoot() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const root = path.join(repoRoot, '.local', 'report', 'desktop-macos-smoke', runId);
  fs.mkdirSync(root, { recursive: true });
  return { runId, root };
}

async function waitForFixtureHealth(origin, timeoutMs = 15000) {
  const url = new URL('/__fixture/health', origin).toString();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for fixture server ${url}`);
}

async function waitForReport(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw.trim()) {
        return JSON.parse(raw);
      }
    } catch {
      // file not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for smoke report: ${filePath}`);
}

async function waitForBackendLogPattern(filePath, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (pattern.test(raw)) {
        return raw;
      }
    } catch {
      // file not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for backend log pattern ${pattern}: ${filePath}`);
}

function writeSyntheticFailureReport({
  smokeReportPath,
  scenarioId,
  scenarioManifestPath,
  failedStep,
  failurePhase,
  message,
  backendLogPath,
}) {
  const backendLogPresent = Boolean(backendLogPath && fs.existsSync(backendLogPath));
  writeJson(smokeReportPath, {
    generatedAt: new Date().toISOString(),
    ok: false,
    scenarioId,
    steps: [],
    failedStep,
    errorMessage: message,
    route: null,
    htmlSnapshotPath: null,
    fixtureManifestPath: scenarioManifestPath,
    failureSource: 'runner',
    failurePhase,
    backendLogPath: backendLogPath || null,
    backendLogPresent,
  });
}

async function runScenario({ scenarioId, runIndex, runRoot, timeoutMs }) {
  const scenario = scenarioEntryForId(scenarioId);
  if (!scenario) {
    throw new Error(`missing registry entry for ${scenarioId}`);
  }

  const appPath = applicationPath();
  if (!fs.existsSync(appPath)) {
    throw new Error(`desktop macOS smoke application not found: ${appPath}`);
  }

  const artifactsDir = path.join(runRoot, `${String(runIndex).padStart(2, '0')}-${scenarioId}`);
  const backendLogPath = path.join(artifactsDir, 'backend.log');
  const scenarioManifestPath = path.join(artifactsDir, 'scenario-manifest.json');
  const artifactManifestPath = path.join(artifactsDir, 'artifact-manifest.json');
  const smokeReportPath = path.join(artifactsDir, 'macos-smoke-report.json');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const profile = loadProfileDefinition(profilePathForScenario(scenarioId));
  const cubismSample = isDynamicLive2dSampleScenario(scenarioId) || scenarioId.startsWith('chat.live2d-render-smoke')
    ? ensureCubismLive2dSample(cubismSampleModelForScenario(scenarioId))
    : null;
  const cubismProfile = cubismSample
    ? cubismSampleProfileTokensForScenario(scenarioId)
    : null;
  const vrmSampleDefinition = vrmSampleDefinitionForScenario(scenarioId);
  const vrmSample = vrmSampleDefinition
    ? await ensureVrmSample(vrmSampleDefinition)
    : null;
  writeJson(scenarioManifestPath, {
    scenarioId,
    realmFixture: profile.realmFixture || {},
    tauriFixture: profile.tauriFixture || {},
    artifactPolicy: profile.artifactPolicy || {},
  });
  const fixtureServer = await startRealmFixtureServer({ manifestPath: scenarioManifestPath });
  const scenarioManifest = replacePlaceholders({
    ...profile,
    scenarioId,
    tauriFixture: {
      ...(profile.tauriFixture || {}),
      macosSmoke: {
        enabled: true,
        scenarioId,
        reportPath: smokeReportPath,
        artifactsDir,
        disableRuntimeBootstrap: true,
      },
    },
  }, {
    __FIXTURE_ORIGIN__: fixtureServer.origin,
    __REPO_ROOT__: repoRoot,
    __CUBISM_SAMPLE_LIVE2D_ROOT__: cubismSample?.sampleRoot || '',
    __CUBISM_SAMPLE_LIVE2D_MODEL_FILE_URL__: cubismSample?.modelFileUrl || '',
    __CUBISM_SAMPLE_RESOURCE_ID__: cubismProfile?.resourceId || '',
    __CUBISM_SAMPLE_DISPLAY_NAME__: cubismProfile?.displayName || '',
    __CUBISM_SAMPLE_MODEL_FILENAME__: cubismProfile?.modelFilename || '',
    __VRM_SAMPLE_RESOURCE_ID__: vrmSample?.resourceId || '',
    __VRM_SAMPLE_DISPLAY_NAME__: vrmSample?.displayName || '',
    __VRM_SAMPLE_FILENAME__: vrmSample?.filename || '',
    __VRM_SAMPLE_ROOT__: vrmSample?.sampleRoot || '',
    __VRM_SAMPLE_FILE_URL__: vrmSample?.sampleFileUrl || '',
  });
  writeJson(scenarioManifestPath, scenarioManifest);
  writeJson(artifactManifestPath, {
    scenario_id: scenarioId,
    spec_path: scenario.spec,
    suite_bucket: scenario.bucket,
    fixture_profile: path.relative(repoRoot, profilePathForScenario(scenarioId)),
    fixture_manifest: path.relative(repoRoot, scenarioManifestPath),
    backend_log: path.relative(repoRoot, backendLogPath),
    smoke_report: path.relative(repoRoot, smokeReportPath),
    artifact_policy: scenarioManifest.artifactPolicy || {},
  });

  const backendLog = createLogFile(backendLogPath);
  const app = spawn(appPath, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NIMI_RUNTIME_BRIDGE_MODE: 'RELEASE',
      NIMI_REALM_URL: fixtureServer.origin,
      NIMI_E2E_PROFILE: scenarioId,
      NIMI_E2E_FIXTURE_PATH: scenarioManifestPath,
      NIMI_E2E_BACKEND_LOG_PATH: backendLogPath,
      NIMI_DEBUG_BOOT: '1',
      NIMI_VERBOSE_RENDERER_LOGS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.pipe(backendLog);
  app.stderr.pipe(backendLog);

  try {
    await waitForFixtureHealth(fixtureServer.origin);
    try {
      await waitForBackendLogPattern(
        backendLogPath,
        /setup found main window/,
        20000,
      );
    } catch (error) {
      writeSyntheticFailureReport({
        smokeReportPath,
        scenarioId,
        scenarioManifestPath,
        failedStep: 'runner-no-main-window',
        failurePhase: 'bundle_launch',
        message: error instanceof Error ? error.message : String(error || 'unknown error'),
        backendLogPath,
      });
      throw error;
    }
    try {
      await waitForBackendLogPattern(
        backendLogPath,
        /macos_smoke_ping stage=(window-eval-probe|renderer-main-entry|renderer-root-mounted|app-mounted|macos-smoke-context-ready|window-page-error)/,
        20000,
      );
    } catch (error) {
      writeSyntheticFailureReport({
        smokeReportPath,
        scenarioId,
        scenarioManifestPath,
        failedStep: 'runner-no-renderer-ping',
        failurePhase: 'renderer_boot',
        message: error instanceof Error ? error.message : String(error || 'unknown error'),
        backendLogPath,
      });
      throw error;
    }
    let report;
    try {
      report = await waitForReport(smokeReportPath, timeoutMs);
    } catch (error) {
      writeSyntheticFailureReport({
        smokeReportPath,
        scenarioId,
        scenarioManifestPath,
        failedStep: 'runner-no-smoke-report-after-renderer-ping',
        failurePhase: 'scenario_report',
        message: error instanceof Error ? error.message : String(error || 'unknown error'),
        backendLogPath,
      });
      throw error;
    }
    if (report?.ok !== true) {
      throw new Error(report?.errorMessage || `macOS smoke scenario failed: ${scenarioId}`);
    }
  } finally {
    app.kill('SIGTERM');
    backendLog.end();
    await fixtureServer.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureSupportedPlatform();
  const selectedScenarios = selectScenarios(options);
  if (!options.skipBuild) {
    await buildApplication();
  }
  const run = makeRunRoot();
  let runIndex = 0;
  for (const scenarioId of selectedScenarios) {
    runIndex += 1;
    await runScenario({
      scenarioId,
      runIndex,
      runRoot: run.root,
      timeoutMs: options.timeoutMs,
    });
  }
  process.stdout.write(`[desktop-macos-smoke] wrote ${path.relative(repoRoot, run.root)}\n`);
}

main().catch((error) => {
  process.stderr.write(`[desktop-macos-smoke] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
