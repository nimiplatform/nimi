import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  isDynamicLive2dSampleScenario,
  profilePathForScenario,
  scenarioEntryForId,
} from '../e2e/helpers/registry.mjs';
import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';
import {
  LIVE2D_AVATAR_PRODUCT_BOOTSTRAP_TIMEOUT_MS,
  LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO,
  applicationPath,
  applyAvatarProductPresentationProfile,
  buildApplication,
  closeWriteStream,
  createAvatarProductSmokeLive2dPackage,
  createLogFile,
  createRuntimeVerifiableE2EJwtFixture,
  cubismSampleModelForScenario,
  cubismSampleProfileTokensForScenario,
  ensureAvatarProductSmokeLaunchTarget,
  ensureCubismLive2dSample,
  ensureSupportedPlatform,
  ensureVrmSample,
  findFreeLoopbackPort,
  loadProfileDefinition,
  makeRunRoot,
  parseArgs,
  readRuntimeLockPid,
  replacePlaceholders,
  repoRoot,
  runtimeProductSmokeTauriFixture,
  startOpenAiCompatibleSmokeProvider,
  terminateAvatarProductResidue,
  terminateChildProcess,
  terminateRuntimeStartedByScenario,
  vrmSampleDefinitionForScenario,
  waitForBackendLogPattern,
  waitForFixtureHealth,
  waitForReport,
  writeAvatarProductRuntimeLocalState,
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

  const baseProfile = loadProfileDefinition(profilePathForScenario(scenarioId));
  const cubismSample = isDynamicLive2dSampleScenario(scenarioId)
    || scenarioId.startsWith('chat.live2d-render-smoke')
    || scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? ensureCubismLive2dSample(cubismSampleModelForScenario(scenarioId))
    : null;
  const avatarProductLive2dPackage = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? createAvatarProductSmokeLive2dPackage(artifactsDir, cubismSample)
    : null;
  const profile = applyAvatarProductPresentationProfile(
    baseProfile,
    scenarioId,
    avatarProductLive2dPackage?.presentationProfile || null,
  );
  const cubismProfile = cubismSample
    ? cubismSampleProfileTokensForScenario(scenarioId)
    : null;
  const vrmSampleDefinition = vrmSampleDefinitionForScenario(scenarioId);
  const vrmSample = vrmSampleDefinition
    ? await ensureVrmSample(vrmSampleDefinition)
    : null;
  const tauriFixture = runtimeProductSmokeTauriFixture(profile, scenarioId);
  const avatarProductSmokeLaunchTarget = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? ensureAvatarProductSmokeLaunchTarget()
    : { appPath: '', binaryPath: '' };
  const disableRuntimeBootstrap = scenarioId !== LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO;
  const bootstrapTimeoutMs = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? LIVE2D_AVATAR_PRODUCT_BOOTSTRAP_TIMEOUT_MS
    : undefined;
  const avatarProductRuntimeStatePath = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? path.join(artifactsDir, 'runtime', 'local-state.json')
    : '';
  const avatarProductRuntimeConfigPath = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? path.join(artifactsDir, 'runtime', 'config.json')
    : '';
  const avatarProductSmokeProvider = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? await startOpenAiCompatibleSmokeProvider()
    : null;
  if (avatarProductRuntimeStatePath) {
    fs.mkdirSync(path.dirname(avatarProductRuntimeStatePath), { recursive: true });
    writeAvatarProductRuntimeLocalState(avatarProductRuntimeStatePath, avatarProductSmokeProvider);
  }
  writeJson(scenarioManifestPath, {
    scenarioId,
    realmFixture: profile.realmFixture || {},
    tauriFixture,
    artifactPolicy: profile.artifactPolicy || {},
  });
  const fixtureServer = await startRealmFixtureServer({ manifestPath: scenarioManifestPath });
  const authUserId = String(profile.realmFixture?.currentUser?.id || 'user-e2e-primary').trim();
  const e2eJwtFixture = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? createRuntimeVerifiableE2EJwtFixture({
        origin: fixtureServer.origin,
        subjectUserId: authUserId,
      })
    : null;
  const runtimeGrpcAddr = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? `127.0.0.1:${await findFreeLoopbackPort()}`
    : '';
  const runtimeHttpAddr = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? `127.0.0.1:${await findFreeLoopbackPort()}`
    : '';
  if (avatarProductRuntimeConfigPath && e2eJwtFixture) {
    writeJson(avatarProductRuntimeConfigPath, {
      schemaVersion: 1,
      grpcAddr: runtimeGrpcAddr,
      httpAddr: runtimeHttpAddr,
      localStatePath: avatarProductRuntimeStatePath,
      auth: {
        jwt: {
          issuer: fixtureServer.origin,
          audience: 'nimi-runtime',
          jwksUrl: new URL('/api/auth/jwks', fixtureServer.origin).toString(),
          revocationUrl: new URL('/api/auth/revocation', fixtureServer.origin).toString(),
        },
      },
    });
  }
  const scenarioManifest = replacePlaceholders({
    ...profile,
    scenarioId,
    realmFixture: {
      ...(profile.realmFixture || {}),
      ...(e2eJwtFixture ? { authJwks: e2eJwtFixture.jwks } : {}),
    },
    tauriFixture: {
      ...tauriFixture,
      macosSmoke: {
        enabled: true,
        scenarioId,
        reportPath: smokeReportPath,
        artifactsDir,
        disableRuntimeBootstrap,
        ...(bootstrapTimeoutMs ? { bootstrapTimeoutMs } : {}),
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
    __E2E_ACCESS_TOKEN__: e2eJwtFixture?.token || '',
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
    runtime_local_state: avatarProductRuntimeStatePath
      ? path.relative(repoRoot, avatarProductRuntimeStatePath)
      : null,
    runtime_config: avatarProductRuntimeConfigPath
      ? path.relative(repoRoot, avatarProductRuntimeConfigPath)
      : null,
    runtime_grpc_addr: runtimeGrpcAddr || null,
    runtime_http_addr: runtimeHttpAddr || null,
    runtime_text_route_provider: avatarProductSmokeProvider
      ? {
          endpoint: avatarProductSmokeProvider.endpoint,
          model_id: avatarProductSmokeProvider.modelId,
          local_asset_id: 'local-e2e-live2d-text-route',
        }
      : null,
    avatar_product_smoke_app: avatarProductSmokeLaunchTarget.appPath
      ? path.relative(repoRoot, avatarProductSmokeLaunchTarget.appPath)
      : null,
    avatar_product_smoke_binary: avatarProductSmokeLaunchTarget.binaryPath
      ? path.relative(repoRoot, avatarProductSmokeLaunchTarget.binaryPath)
      : null,
    avatar_product_live2d_asset: avatarProductLive2dPackage
      ? {
          package_root: path.relative(repoRoot, avatarProductLive2dPackage.packageRoot),
          runtime_link: path.relative(repoRoot, avatarProductLive2dPackage.runtimeLink),
          source_sample_root: path.relative(repoRoot, cubismSample.sampleRoot),
        }
      : null,
    artifact_policy: scenarioManifest.artifactPolicy || {},
  });

  const backendLog = createLogFile(backendLogPath);
  const initialRuntimeLockPid = readRuntimeLockPid();
  const smokeAuthSessionEnv = scenarioId === LIVE2D_AVATAR_PRODUCT_SMOKE_SCENARIO
    ? {
        NIMI_E2E_AUTH_SESSION_STORAGE: 'encrypted-file',
        NIMI_E2E_AUTH_SESSION_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
      }
    : {};
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
      ...(avatarProductSmokeLaunchTarget.appPath ? { NIMI_AVATAR_APP_PATH: avatarProductSmokeLaunchTarget.appPath } : {}),
      ...(avatarProductSmokeLaunchTarget.binaryPath ? { NIMI_AVATAR_BINARY_PATH: avatarProductSmokeLaunchTarget.binaryPath } : {}),
      ...(avatarProductRuntimeStatePath ? {
        NIMI_RUNTIME_LOCAL_STATE_PATH: avatarProductRuntimeStatePath,
        NIMI_RUNTIME_CONFIG_PATH: avatarProductRuntimeConfigPath,
        NIMI_RUNTIME_GRPC_ADDR: runtimeGrpcAddr,
        NIMI_RUNTIME_HTTP_ADDR: runtimeHttpAddr,
        NIMI_RUNTIME_BRIDGE_DEBUG: '1',
      } : {}),
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
    await terminateAvatarProductResidue(smokeReportPath);
    await terminateRuntimeStartedByScenario(initialRuntimeLockPid);
    await closeWriteStream(backendLog);
    await fixtureServer.close();
    if (avatarProductSmokeProvider) {
      await avatarProductSmokeProvider.close();
    }
  }
}
