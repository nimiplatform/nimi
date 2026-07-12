import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import {
  profilePathForScenario,
  scenarioEntryForId,
} from '../e2e/helpers/registry.mjs';
import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';
import {
  applicationPath,
  buildApplication,
  closeWriteStream,
  createLogFile,
  ensureSupportedPlatform,
  loadProfileDefinition,
  makeRunRoot,
  parseArgs,
  repoRoot,
  replacePlaceholders,
  terminateChildProcess,
  waitForBackendLogPattern,
  waitForFixtureHealth,
  waitForReport,
  writeJson,
  writeSyntheticFailureReport,
} from './run-macos-smoke-helpers.mjs';

export {
  buildApplication,
  ensureSupportedPlatform,
  makeRunRoot,
  parseArgs,
  repoRoot,
};

export async function runScenario({ scenarioId, runIndex, runRoot, timeoutMs }) {
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

  const profilePath = profilePathForScenario(scenarioId);
  const baseProfile = loadProfileDefinition(profilePath);
  writeJson(scenarioManifestPath, {
    scenarioId,
    realmFixture: baseProfile.realmFixture || {},
    tauriFixture: baseProfile.tauriFixture || {},
    artifactPolicy: baseProfile.artifactPolicy || {},
  });
  const fixtureServer = await startRealmFixtureServer({ manifestPath: scenarioManifestPath });
  const scenarioManifest = replacePlaceholders({
    ...baseProfile,
    scenarioId,
    tauriFixture: {
      ...(baseProfile.tauriFixture || {}),
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
  });
  writeJson(scenarioManifestPath, scenarioManifest);
  writeJson(artifactManifestPath, {
    scenario_id: scenarioId,
    spec_path: scenario.spec,
    suite_bucket: scenario.bucket,
    fixture_profile: path.relative(repoRoot, profilePath),
    fixture_manifest: path.relative(repoRoot, scenarioManifestPath),
    backend_log: path.relative(repoRoot, backendLogPath),
    smoke_report: path.relative(repoRoot, smokeReportPath),
    artifact_policy: scenarioManifest.artifactPolicy || {},
  });

  const backendLog = createLogFile(backendLogPath);
  const smokeAuthSessionEnv = {
    NIMI_E2E_AUTH_SESSION_STORAGE: 'encrypted-file',
    NIMI_E2E_AUTH_SESSION_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  };
  const app = spawn(appPath, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...smokeAuthSessionEnv,
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
    await terminateChildProcess(app, 'Desktop macOS smoke app');
    await closeWriteStream(backendLog);
    await fixtureServer.close();
  }
}
