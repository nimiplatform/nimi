import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import {
  Runtime,
  createNimiLocalFirstPartyRuntimeAccountCaller,
  withNimiRuntimeIdempotencyMetadata,
} from '@nimiplatform/sdk/runtime';
import {
  AppMode,
  WorldRelation,
} from '@nimiplatform/sdk/runtime/generated';
import {
  Realm,
  createNimiRealmSourceMaterializationPacket,
} from '@nimiplatform/sdk/realm';
import { startRealmFixtureServer } from '../../e2e/fixtures/realm-fixture-server.mjs';
import { createRealmFixtureManifest } from '../explore-materialization-acceptance/acceptance-fixture.mjs';
import {
  fetchJson,
  formatError,
  normalizeOptionalPath,
  safeResetDir,
  seedAdmittedProductControlFromUserHome,
  terminateDaemon,
  writeJsonFile,
} from '../explore-materialization-acceptance/acceptance-files.mjs';
import {
  captureDesktopRuntimeLocalAgentCenterEvidence,
  openDesktopAgentCenter,
  probeDesktopRuntimeAvailable,
  projectExecutionConfigForEvidence,
  trackRuntimeLocalAgentCenterPageProblems,
  visitDesktopAgentCenterTabs,
} from './runtime-local-agent-center-evidence.mjs';
import {
  APP_ID,
  OWNER_USER_ID,
  VALID_SOURCE_REF,
} from '../explore-materialization-acceptance/acceptance-constants.mjs';
import {
  waitForDesktopSurface,
} from '../explore-materialization-acceptance/acceptance-page.mjs';
import {
  createAcceptanceAgentClient,
  completeRuntimeAccountLogin,
  prepareRuntimeProductControl,
  startRuntimeDaemon,
} from '../explore-materialization-acceptance/acceptance-runtime.mjs';
import {
  localhostOrigin,
  startAcceptanceRendererServer,
} from '../explore-materialization-acceptance/acceptance-server.mjs';

const appRoot = path.resolve(import.meta.dirname, '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const platformAppRegistryPath = path.join(repoRoot, '.nimi', 'spec', 'platform', 'kernel', 'tables', 'nimi-app-registry.yaml');
const require = createRequire(import.meta.url);
const electronExecutablePath = require('electron');
const mainEntry = path.join(appRoot, 'dist-electron', 'main.js');
const REALM_WORLD_STUDIO_APP_ID = 'nimi.realm-world-studio';
const REALM_WORLD_STUDIO_APP_INSTANCE_ID = 'nimi.realm-world-studio.local-first-party';
const REALM_WORLD_STUDIO_DEVICE_ID = 'device-1';

export async function runDesktopRuntimeLocalAgentCenterAcceptance({
  scenario,
  evidenceRoot = process.env.NIMI_RLA_EVIDENCE_ROOT,
  checkpoint,
} = {}) {
  const resolvedScenario = normalizeScenario(scenario);
  const resolvedEvidenceRoot = path.resolve(repoRoot, normalizeText(evidenceRoot) || defaultEvidenceRoot(resolvedScenario));
  const resolvedCheckpoint = normalizeText(checkpoint) || `runtime-local-agent-center-rla0b-desktop-${resolvedScenario}`;
  const artifactsDir = path.join(appRoot, 'reports', 'e2e', 'runtime-local-agent-center', resolvedScenario);
  const sourcePacketSecret = process.env.SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET
    || 'desktop-e2e-source-materialization-secret';
  const acceptanceBaseEnv = { ...process.env };
  delete acceptanceBaseEnv.SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET;

  safeResetDir(artifactsDir, { reportsRoot: path.join(appRoot, 'reports', 'e2e') });
  fs.mkdirSync(resolvedEvidenceRoot, { recursive: true });
  const runtimeStdoutPath = path.join(artifactsDir, 'runtime-stdout.log');
  const runtimeStderrPath = path.join(artifactsDir, 'runtime-stderr.log');
  const resultPath = path.join(artifactsDir, 'runtime-local-agent-center-result.json');
  const manifestPath = path.join(artifactsDir, 'realm-fixture-manifest.json');
  const isolatedHome = path.join(artifactsDir, 'home');
  const standardDataRoot = path.join(artifactsDir, 'electron-standard-data');
  const runtimeStateRoot = path.join(artifactsDir, 'runtime-state');
  const runtimeDataRoot = path.join(artifactsDir, 'runtime-data');
  const runtimeConfigPath = path.join(runtimeStateRoot, 'config.json');
  for (const dir of [isolatedHome, standardDataRoot, runtimeStateRoot, runtimeDataRoot]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const admittedProductControlSeed = seedAdmittedProductControlFromUserHome({
    homeDir: isolatedHome,
    stateRoot: runtimeStateRoot,
  });
  const acceptedRuntimeDataRoot = normalizeOptionalPath(admittedProductControlSeed.sourceDataRoot) || runtimeDataRoot;
  writeJsonFile(manifestPath, createRealmFixtureManifest('http://127.0.0.1:0'));
  writeJsonFile(runtimeConfigPath, {
    schemaVersion: 1,
    dataRootRef: acceptedRuntimeDataRoot,
    managedRoots: {
      models: path.join(acceptedRuntimeDataRoot, 'models'),
      dependencies: path.join(acceptedRuntimeDataRoot, 'dependencies'),
      environments: path.join(acceptedRuntimeDataRoot, 'environments'),
      logs: path.join(acceptedRuntimeDataRoot, 'logs'),
      audit: path.join(acceptedRuntimeDataRoot, 'audit'),
    },
    sourceMaterializationPacketHmacSecret: sourcePacketSecret,
  });

  const fixtureServer = await startRealmFixtureServer({ manifestPath });
  let rendererServer = null;
  let runtimeDaemon = null;
  let electronApp = null;
  const observations = {};

  try {
    rendererServer = await startAcceptanceRendererServer({
      distDir: path.join(appRoot, 'dist'),
      apiOrigin: fixtureServer.origin,
    });
    const rendererUrl = `${rendererServer.origin}/index.html?nimiDesktopRuntimeLocalAgentCenterAcceptance=1`;
    const desktopFixtureOrigin = rendererServer.origin;
    const realtimeFixtureOrigin = localhostOrigin(fixtureServer.origin);
    writeJsonFile(manifestPath, createRealmFixtureManifest(desktopFixtureOrigin));

    const runtimeContext = await startRuntimeDaemon({
      fixtureOrigin: fixtureServer.origin,
      homeDir: isolatedHome,
      stateRoot: runtimeStateRoot,
      runtimeDir,
      baseEnv: {
        ...acceptanceBaseEnv,
        NIMI_RUNTIME_APP_REGISTRY_PATH: platformAppRegistryPath,
      },
      runtimeConfigPath,
      stdoutPath: runtimeStdoutPath,
      stderrPath: runtimeStderrPath,
    });
    runtimeDaemon = runtimeContext.daemon;
    observations.runtimeEndpoint = runtimeContext.endpoint;
    observations.admittedProductControlSeed = admittedProductControlSeed;

    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: runtimeContext.endpoint,
      },
    });
    const realmWorldStudioRuntime = new Runtime({
      appId: REALM_WORLD_STUDIO_APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: runtimeContext.endpoint,
      },
    });
    await completeRuntimeAccountLogin(runtime, observations);
    observations.productControl = await prepareRuntimeProductControl(runtime, runtimeDataRoot);
    const agentClient = createAcceptanceAgentClient(runtime);
    const realmWorldStudioCaller = await registerRealmWorldStudioRuntimeApp(realmWorldStudioRuntime);
    const sourceMaterializationPacket = await createRuntimeMediatedSourceMaterializationPacket({
      runtime: realmWorldStudioRuntime,
      caller: realmWorldStudioCaller,
      realmBaseUrl: fixtureServer.origin,
      sourceRef: VALID_SOURCE_REF,
    });
    const initializedAgent = await agentClient.initialize({
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: runtimeSourceRefForSource(VALID_SOURCE_REF),
      displayName: 'Runtime Local Agent Center Fixture',
      sourceMaterializationPacket,
    });
    const localAgentRef = initializedAgent.localAgentRef;
    const runtimeSourceRef = initializedAgent.runtimeSourceRef;
    await agentClient.openConversation({
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef,
      localAgentRef,
      metadata: {
        appId: APP_ID,
        surface: 'desktop.runtime-local-agent-center.rla0b',
      },
    });
    observations.localAgentRef = localAgentRef;
    observations.runtimeSourceRef = runtimeSourceRef;

    electronApp = await electron.launch({
      executablePath: electronExecutablePath,
      args: [mainEntry],
      env: {
        ...acceptanceBaseEnv,
        NIMI_REALM_URL: desktopFixtureOrigin,
        NIMI_REALTIME_URL: realtimeFixtureOrigin,
        NIMI_ACCESS_TOKEN: 'desktop-rla-agent-center-access-token',
        NIMI_REALM_JWKS_URL: `${desktopFixtureOrigin}/api/auth/jwks`,
        NIMI_REALM_REVOCATION_URL: `${desktopFixtureOrigin}/api/auth/sessions/introspect`,
        NIMI_REALM_JWT_ISSUER: desktopFixtureOrigin,
        NIMI_REALM_JWT_AUDIENCE: 'nimi-runtime',
        NIMI_RUNTIME_GRPC_ADDR: runtimeContext.endpoint,
        NIMI_DESKTOP_ELECTRON_RUNTIME_ENDPOINT: runtimeContext.endpoint,
        NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererUrl,
        NIMI_DESKTOP_ELECTRON_STANDARD_DATA_ROOT: standardDataRoot,
        NIMI_DEBUG_BOOT: '1',
        NIMI_VERBOSE_RENDERER_LOGS: '1',
      },
    });
    const context = electronApp.context();
    await context.addInitScript(() => {
      globalThis.localStorage.setItem('nimi.shell.locale', 'zh');
    });
    const page = await electronApp.firstWindow();
    const pageProblems = trackRuntimeLocalAgentCenterPageProblems(page);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      globalThis.localStorage.setItem('nimi.shell.locale', 'zh');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__), null, { timeout: 30_000 });

    const surface = await waitForDesktopSurface(page);
    observations.initialSurface = surface;
    assert.equal(surface, 'main', `Desktop RLA evidence requires main shell, got ${surface}`);

    await page.getByTestId('nav-tab:chat').click();
    await page.getByTestId('chat-page').waitFor({ state: 'visible', timeout: 60_000 });
    await page.getByTestId(`chat-target:${localAgentRef}`).waitFor({ state: 'visible', timeout: 60_000 });
    await openDesktopAgentCenter(page, { localAgentRef });
    const tabsVisited = await visitDesktopAgentCenterTabs(page);

    let committedConfig = null;
    let readiness = null;
    let staleRevisionConflict = null;
    let runtimeAvailableProbe = await probeDesktopRuntimeAvailable(page);
    if (resolvedScenario === 'live-runtime') {
      committedConfig = await agentClient.executionConfig.get();
      readiness = await agentClient.executionConfig.readiness();
      staleRevisionConflict = await proveRuntimeExecutionConfigStaleConflict(agentClient.executionConfig, committedConfig);
      committedConfig = await agentClient.executionConfig.get();
      readiness = await agentClient.executionConfig.readiness();
    } else {
      await terminateDaemon(runtimeDaemon);
      runtimeDaemon = null;
      runtimeAvailableProbe = await probeDesktopRuntimeAvailable(page);
    }

    const executionConfig = resolvedScenario === 'live-runtime'
      ? projectExecutionConfigForEvidence(committedConfig, readiness)
      : { revision: null, textGenerate: { state: 'unavailable', reason: 'runtime-unavailable' } };
    const runtimeEvidence = resolvedScenario === 'live-runtime'
      ? {
        available: true,
        endpoint: runtimeContext.endpoint,
        authState: 'bound',
        sdkState: 'ready',
        runtimeSourceRef,
        localAgentRef,
      }
      : {
        available: false,
        endpoint: runtimeContext.endpoint,
        authState: 'runtime-loss-after-bound-auth',
        sdkState: 'unavailable',
        runtimeSourceRef,
        localAgentRef,
        unavailableProbe: runtimeAvailableProbe,
      };

    const { evidenceFile } = await captureDesktopRuntimeLocalAgentCenterEvidence({
      app: electronApp,
      page,
      evidenceRoot: resolvedEvidenceRoot,
      checkpoint: resolvedCheckpoint,
      scenario: resolvedScenario,
      stage: resolvedScenario === 'live-runtime' ? 'rla0b-live-agent-center' : 'rla0b-no-runtime-agent-center',
      runtime: runtimeEvidence,
      executionConfig,
      diagnostics: resolvedScenario === 'live-runtime'
        ? {
          source: 'runtime-accepted-projection',
          runtimeConfigRevision: executionConfig.revision,
          acceptedTurnRef: null,
        }
        : { source: 'absent' },
      localAgentRef,
      pageProblems,
      tabsVisited,
      staleRevisionConflict,
    });

    if (pageProblems.consoleErrors.length || pageProblems.pageErrors.length) {
      throw new Error(`Desktop RLA renderer console/page errors observed: ${JSON.stringify(pageProblems, null, 2)}`);
    }

    const fixtureManifest = await fetchJson(`${fixtureServer.origin}/__fixture/control/manifest`);
    observations.packetRequestCount = fixtureManifest.realmFixture?.sourceMaterializationPacketRequests?.length ?? 0;
    observations.evidenceFile = evidenceFile;
    writeJsonFile(resultPath, {
      ok: true,
      scenario: resolvedScenario,
      evidenceFile,
      runtimeEndpoint: runtimeContext.endpoint,
      observations,
      consoleErrors: pageProblems.consoleErrors,
      consoleErrorDetails: pageProblems.consoleErrorDetails,
      pageErrors: pageProblems.pageErrors,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, scenario: resolvedScenario, evidenceFile }, null, 2)}\n`);
  } catch (error) {
    writeJsonFile(resultPath, {
      ok: false,
      scenario: resolvedScenario,
      error: formatError(error),
      observations,
    });
    throw error;
  } finally {
    if (electronApp) {
      await electronApp.close().catch(() => undefined);
    }
    if (runtimeDaemon) {
      await terminateDaemon(runtimeDaemon).catch(() => undefined);
    }
    await rendererServer?.close().catch(() => undefined);
    await fixtureServer.close().catch(() => undefined);
  }
}

async function proveRuntimeExecutionConfigStaleConflict(executionConfig, seededConfig) {
  const seededText = seededConfig?.bindings?.['text.generate'] || null;
  if (!seededText) {
    throw new Error('Desktop RLA stale conflict evidence requires committed text.generate binding');
  }
  const committed = await executionConfig.upsert({
    expectedRevision: seededConfig.revision,
    bindings: {
      'text.generate': seededText,
    },
  });
  try {
    await executionConfig.upsert({
      expectedRevision: seededConfig.revision,
      bindings: {
        'text.generate': seededText,
      },
    });
  } catch (error) {
    const reasonCode = normalizeErrorField(error, 'reasonCode');
    const actionHint = normalizeErrorField(error, 'actionHint');
    if (reasonCode !== 'RUNTIME_AGENT_EXECUTION_CONFIG_CONCURRENT_MODIFICATION') {
      throw new Error(`Desktop RLA stale conflict evidence expected Runtime SDK conflict, got ${reasonCode || formatError(error).message}`, { cause: error });
    }
    const afterConflict = await executionConfig.get();
    if (afterConflict.revision !== committed.revision) {
      throw new Error(`Desktop RLA stale conflict mutated config revision: expected ${committed.revision}, got ${afterConflict.revision}`, { cause: error });
    }
    return {
      observed: true,
      source: 'runtime-sdk-upsert-conflict',
      reasonCode,
      actionHint,
      staleExpectedRevision: seededConfig.revision,
      committedRevision: committed.revision,
      postConflictRevision: afterConflict.revision,
    };
  }
  throw new Error('Desktop RLA stale conflict evidence expected Runtime SDK upsert to reject stale revision');
}

function normalizeErrorField(error, field) {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const value = error[field];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeScenario(value) {
  const scenario = normalizeText(value || process.env.NIMI_RLA_SCENARIO || 'live-runtime');
  if (scenario !== 'live-runtime' && scenario !== 'no-runtime') {
    throw new Error(`unsupported Desktop RLA scenario: ${scenario}`);
  }
  return scenario;
}

function defaultEvidenceRoot(scenario) {
  return `.nimi/local/evidence/runtime-local-agent-center/rla0b/${scenario === 'live-runtime' ? 'desktop-live' : 'desktop-no-runtime'}`;
}

async function createRuntimeMediatedSourceMaterializationPacket({ runtime, caller, realmBaseUrl, sourceRef }) {
  const realm = new Realm({
    transport: {
      async unary(request) {
        const response = await runtime.account.invokeRealmUnary({
          caller,
          methodId: request.methodId,
          realmBaseUrl,
          requestJson: JSON.stringify(request.body ?? {}),
          timeoutMs: request.timeoutMs ?? 30_000,
        }, withNimiRuntimeIdempotencyMetadata({
          metadata: request.metadata,
          timeoutMs: request.timeoutMs,
          signal: request.signal,
          responseMetadataObserver: request.responseMetadataObserver,
        }, `desktop-rla-realm:${request.methodId}`));
        if (!response.accepted) {
          throw new Error(`Runtime Realm mediation failed for ${request.methodId}: ${JSON.stringify(response)}`);
        }
        return JSON.parse(response.responseJson || '{}');
      },
      async *serverStream(request) {
        yield* [];
        throw new Error(`Desktop RLA Realm fixture does not support streams: ${request.methodId}`);
      },
    },
  });
  return createNimiRealmSourceMaterializationPacket(
    realm,
    () => {},
    sourceRef,
    'nimi.desktop.local-agent.materialization',
  );
}

async function registerRealmWorldStudioRuntimeApp(runtime) {
  const caller = createNimiLocalFirstPartyRuntimeAccountCaller({
    appId: REALM_WORLD_STUDIO_APP_ID,
    appInstanceId: REALM_WORLD_STUDIO_APP_INSTANCE_ID,
    deviceId: REALM_WORLD_STUDIO_DEVICE_ID,
  });
  const response = await runtime.auth.registerApp({
    appId: REALM_WORLD_STUDIO_APP_ID,
    appInstanceId: REALM_WORLD_STUDIO_APP_INSTANCE_ID,
    deviceId: REALM_WORLD_STUDIO_DEVICE_ID,
    appVersion: 'desktop-runtime-local-agent-center-rla0b',
    capabilities: [],
    modeManifest: {
      appMode: AppMode.FULL,
      runtimeRequired: true,
      realmRequired: true,
      worldRelation: WorldRelation.NONE,
    },
    developerRegistration: false,
  }, withNimiRuntimeIdempotencyMetadata({}, 'desktop-rla-register-realm-world-studio'));
  if (!response.accepted) {
    throw new Error(`Runtime RegisterApp failed for ${REALM_WORLD_STUDIO_APP_ID}: ${JSON.stringify(response)}`);
  }
  return caller;
}

function runtimeSourceRefForSource(sourceRef) {
  return [
    'runtime-source',
    sourceRef.kind,
    sourceRef.worldId,
    sourceRef.sourceId,
    sourceRef.sourceContentHash,
  ].map(normalizeText).join(':');
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
