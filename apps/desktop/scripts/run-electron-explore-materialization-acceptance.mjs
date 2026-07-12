#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { Runtime } from '@nimiplatform/sdk/runtime';
import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';
import { prepareRealRealmProductSession } from '../e2e/fixtures/real-realm-product-session.mjs';
import {
  APP_ID,
  OWNER_USER_ID,
  VALID_PERSONA_SOURCE_REF,
  VALID_SOURCE_REF,
} from './explore-materialization-acceptance/acceptance-constants.mjs';
import { createRealmFixtureManifest } from './explore-materialization-acceptance/acceptance-fixture.mjs';
import {
  delay,
  fetchJson,
  formatError,
  normalizeOptionalPath,
  safeResetDir,
  seedAdmittedProductControlFromUserHome,
  retargetAdmittedProductControlSeed,
  seedDeterministicAttachedLocalRoutes,
  terminateDaemon,
  writeJsonFile,
} from './explore-materialization-acceptance/acceptance-files.mjs';
import {
  captureScreenshot,
  inspectAccessibility,
  inspectLayout,
  normalizeWhitespace,
  openExploreWorlds,
  setElectronWindowSize,
  waitForDesktopSurface,
} from './explore-materialization-acceptance/acceptance-page.mjs';
import {
  createAcceptanceAgentClient,
  completeRuntimeAccountLogin,
  prepareRuntimeProductControl,
  startRuntimeDaemon,
} from './explore-materialization-acceptance/acceptance-runtime.mjs';
import {
  createDeterministicMediaRoutes,
} from './explore-materialization-acceptance/acceptance-media-routes.mjs';
import {
  completeDisabledActionAcceptance,
  createProductJourneySettings,
  createProviderCheckpointController,
  holdCrossAppJourney,
  materializeJourneyPersona,
  materializePrimaryPersona,
  runDesktopAgentChatJourney,
  runPreMaterializationOfflineJourney,
} from './explore-materialization-acceptance/acceptance-product-journey.mjs';
import {
  localhostOrigin,
  startAcceptanceRendererServer,
} from './explore-materialization-acceptance/acceptance-server.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const require = createRequire(import.meta.url);
const electronExecutablePath = require('electron');
const mainEntry = path.join(appRoot, 'dist-electron', 'main.js');
let rendererUrl;
const {
  artifactsDir,
  crossAppHandoffPath,
  crossAppReleasePath,
  crossAppProviderRawPath,
  crossAppControlRoot,
  productJourneyId,
  fullChainCore,
  preMaterializationOffline,
  disabledActionOnly,
  productSourceKind,
  realRealmBaseUrl,
  standardDataRoot,
  desktopChromiumUserDataRoot,
  productTrialRuntimeDataRoot,
} = createProductJourneySettings({ appRoot });
const acceptanceBaseEnv = { ...process.env };
class AcceptanceCompletedSignal extends Error {}
let productOwnerUserId = OWNER_USER_ID;
let activeSourceRef = productSourceKind === 'realmPersona' ? VALID_PERSONA_SOURCE_REF : VALID_SOURCE_REF;
let realRealmSession = null;
safeResetDir(artifactsDir, {
  reportsRoot: process.env.NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_ARTIFACTS_ROOT
    ? path.dirname(artifactsDir)
    : path.join(appRoot, 'reports', 'e2e'),
});
const runtimeStdoutPath = path.join(artifactsDir, 'runtime-stdout.log');
const runtimeStderrPath = path.join(artifactsDir, 'runtime-stderr.log');
const desktopScreenshotPath = path.join(artifactsDir, 'desktop-explore-world-character.png');
const sourceDetailNavigationFailureScreenshotPath = path.join(artifactsDir, 'desktop-source-detail-navigation-failure.png');
const narrowScreenshotPath = path.join(artifactsDir, 'narrow-world-character-detail.png');
const chatScreenshotPath = path.join(artifactsDir, 'desktop-chat-consumption.png');
const sourceDetailOpenPartnerScreenshotPath = path.join(artifactsDir, 'desktop-source-detail-open-partner.png');
const sourceDetailMaterializationFailureScreenshotPath = path.join(artifactsDir, 'desktop-source-detail-materialization-failure.png');
const realmOfflineBeforeMaterializeScreenshotPath = path.join(artifactsDir, 'realm-offline-before-materialize.png');
const runtimeOfflineBeforeMaterializeScreenshotPath = path.join(artifactsDir, 'runtime-offline-before-materialize.png');
const realmOfflineBeforeMaterializeEvidencePath = path.join(artifactsDir, 'realm-offline-before-materialize.json');
const runtimeOfflineBeforeMaterializeEvidencePath = path.join(artifactsDir, 'runtime-offline-before-materialize.json');
const chatSendAttemptScreenshotPath = path.join(artifactsDir, 'desktop-chat-send-after-model-selection.png');
const agentModelSettingsScreenshotPath = path.join(artifactsDir, 'desktop-agent-model-settings.png');
const agentModelChatDetailScreenshotPath = path.join(artifactsDir, 'desktop-agent-model-chat-detail.png');
const agentModelPickerScreenshotPath = path.join(artifactsDir, 'desktop-agent-model-picker.png');
const agentModelSelectedScreenshotPath = path.join(artifactsDir, 'desktop-agent-model-selected.png');
const personaMaterializedScreenshotPath = path.join(artifactsDir, 'desktop-persona-materialized.png');
const firstRunScreenshotPath = path.join(artifactsDir, 'blocked-first-run.png');
const resultPath = path.join(artifactsDir, 'acceptance-result.json');
const manifestPath = path.join(artifactsDir, 'realm-fixture-manifest.json');
const isolatedHome = path.join(artifactsDir, 'home');
const runtimeStateRoot = path.join(artifactsDir, 'runtime-state');
const runtimeDataRoot = path.join(artifactsDir, 'runtime-data');
const runtimeConfigPath = path.join(runtimeStateRoot, 'config.json');
fs.mkdirSync(isolatedHome, { recursive: true });
fs.mkdirSync(standardDataRoot, { recursive: true });
fs.mkdirSync(runtimeStateRoot, { recursive: true });
fs.mkdirSync(runtimeDataRoot, { recursive: true });
let admittedProductControlSeed = seedAdmittedProductControlFromUserHome({
  homeDir: isolatedHome,
  stateRoot: runtimeStateRoot,
});
if (productTrialRuntimeDataRoot) admittedProductControlSeed = retargetAdmittedProductControlSeed({
  seed: admittedProductControlSeed,
  targetDataRoot: productTrialRuntimeDataRoot,
});
const acceptedRuntimeDataRoot = productTrialRuntimeDataRoot
  || normalizeOptionalPath(admittedProductControlSeed.sourceDataRoot)
  || runtimeDataRoot;
if (realRealmBaseUrl) {
  realRealmSession = await prepareRealRealmProductSession({
    realmBaseUrl: realRealmBaseUrl,
    trialId: process.env.NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ID || `${productSourceKind}-${Date.now()}`,
  });
  productOwnerUserId = realRealmSession.accountId;
  activeSourceRef = realRealmSession.sourceRefs[productSourceKind];
}

writeJsonFile(manifestPath, createRealmFixtureManifest('http://127.0.0.1:0'));
writeJsonFile(runtimeConfigPath, {
  schemaVersion: 1,
  runtimeId: 'runtime-instance-desktop-explore-materialization',
  dataRootRef: acceptedRuntimeDataRoot,
  managedRoots: {
    models: path.join(acceptedRuntimeDataRoot, 'models'),
    dependencies: path.join(acceptedRuntimeDataRoot, 'dependencies'),
    environments: path.join(acceptedRuntimeDataRoot, 'environments'),
    logs: path.join(acceptedRuntimeDataRoot, 'logs'),
    audit: path.join(acceptedRuntimeDataRoot, 'audit'),
  },
});
const fixtureServer = await startRealmFixtureServer({ manifestPath });
let rendererServer;
rendererServer = await startAcceptanceRendererServer({
  distDir: path.join(appRoot, 'dist'),
  apiOrigin: realRealmSession?.realmBaseUrl || fixtureServer.origin,
});
rendererUrl = `${rendererServer.origin}/index.html?nimiExploreMaterializationAcceptance=1`;
const desktopFixtureOrigin = rendererServer.origin;
const realtimeFixtureOrigin = localhostOrigin(fixtureServer.origin);
admittedProductControlSeed = seedDeterministicAttachedLocalRoutes({
  seed: admittedProductControlSeed,
  stateRoot: runtimeStateRoot,
  providerBaseUrl: `${fixtureServer.origin}/v1`,
});
writeJsonFile(manifestPath, createRealmFixtureManifest(desktopFixtureOrigin, fixtureServer.origin));

let runtimeDaemon = null;
let electronApp = null;
const consoleErrors = [];
const consoleErrorDetails = [];
const pageErrors = [];
const observations = {};
observations.processStarts = { provider: 1, realm: 1, runtime: 0, desktop: 1, zhiyu: 0 };
const {
  queue: queueProviderPlan,
  count: providerCheckpointCount,
  wait: waitForProviderCheckpoint,
  waitForFile: waitForControlFile,
} = createProviderCheckpointController(fixtureServer.origin);

async function waitForDiscoveredLocalAgent(agentClient, sourceRef = activeSourceRef) {
  const deadline = Date.now() + (sourceRef.kind === 'realmPersona' ? 20_000 : 60_000);
  let discovered = [];
  while (Date.now() < deadline) {
    discovered = await agentClient.discoverBySource({
      ownerUserId: productOwnerUserId,
      sourceRef,
    });
    if (discovered.length > 0) {
      return discovered;
    }
    await delay(500);
  }
  return discovered;
}

function runtimeAgentIdentity(localAgentRef, runtimeSourceRef) {
  return {
    ownerUserId: productOwnerUserId,
    subjectUserId: productOwnerUserId,
    localAgentRef,
    runtimeSourceRef,
  };
}

async function readRuntimeAgentAIConfig(agentClient, identity) {
  return agentClient.agentAIConfig.get(identity);
}

function textGenerateTargetRefFromRuntimeAIConfig(snapshot) {
  const targetRef = snapshot?.intents?.['text.generate']?.targetRef;
  if (!targetRef || typeof targetRef !== 'object') {
    return null;
  }
  if (targetRef.kind === 'local-runtime' || targetRef.kind === 'cloud-connector') {
    return targetRef;
  }
  return null;
}

async function waitForRuntimeTextGenerateTargetRef(agentClient, identity) {
  const deadline = Date.now() + 30_000;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    lastSnapshot = await readRuntimeAgentAIConfig(agentClient, identity);
    const targetRef = textGenerateTargetRefFromRuntimeAIConfig(lastSnapshot);
    if (targetRef) {
      return { targetRef, snapshot: lastSnapshot };
    }
    await delay(500);
  }
  return { targetRef: null, snapshot: lastSnapshot };
}

try {
  let runtimeContext = await startRuntimeDaemon({
    fixtureOrigin: desktopFixtureOrigin,
    realmIssuerOrigin: realRealmSession?.realmIssuer || desktopFixtureOrigin,
    providerOrigin: fixtureServer.origin,
    homeDir: isolatedHome,
    stateRoot: runtimeStateRoot,
    runtimeDir,
    baseEnv: acceptanceBaseEnv,
    runtimeConfigPath,
    stdoutPath: runtimeStdoutPath,
    stderrPath: runtimeStderrPath,
  });
  observations.admittedProductControlSeed = admittedProductControlSeed;
  runtimeDaemon = runtimeContext.daemon;
  observations.processStarts.runtime += 1;
  let runtime = new Runtime({
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint: runtimeContext.endpoint,
    },
  });
  await completeRuntimeAccountLogin(runtime, observations, realRealmSession);
  observations.productControl = await prepareRuntimeProductControl(runtime, runtimeDataRoot).catch((error) => ({
    state: 'setup_failed',
    error: formatError(error),
  }));
  let agentClient = createAcceptanceAgentClient(runtime, productOwnerUserId);
  const mediaRoutes = fullChainCore
    ? await createDeterministicMediaRoutes(runtime, fixtureServer.origin)
    : null;
  const journeyAgents = [];

  electronApp = await electron.launch({
    executablePath: electronExecutablePath,
    args: [mainEntry, `--user-data-dir=${desktopChromiumUserDataRoot}`],
    env: {
      ...acceptanceBaseEnv,
      NIMI_REALM_URL: desktopFixtureOrigin,
      NIMI_REALTIME_URL: realtimeFixtureOrigin,
      NIMI_REALM_JWKS_URL: `${desktopFixtureOrigin}/api/auth/jwks`,
      NIMI_REALM_REVOCATION_URL: `${desktopFixtureOrigin}/api/auth/sessions/introspect`,
      NIMI_REALM_JWT_ISSUER: realRealmSession?.realmIssuer || desktopFixtureOrigin,
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
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
      void Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => '[unserializable]')))
        .then((args) => {
          consoleErrorDetails.push({
            text: message.text(),
            args,
          });
        })
        .catch(() => undefined);
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    globalThis.localStorage.setItem('nimi.shell.locale', 'zh');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__), null, { timeout: 30_000 });

  const surface = await waitForDesktopSurface(page);
  observations.initialSurface = surface;
  if (surface !== 'main') {
    await captureScreenshot(page, firstRunScreenshotPath);
    throw new Error(`Desktop Electron did not reach main shell; surface=${surface}. Screenshot: ${firstRunScreenshotPath}`);
  }

  await openExploreWorlds(page);
  if (realRealmSession && productSourceKind === 'worldCharacter') {
    const seededWorldCard = page.getByTestId('world-atlas-world-grid').locator('article').filter({ hasText: realRealmSession.displayName }).first();
    await seededWorldCard.waitFor({ state: 'visible', timeout: 60_000 });
    await seededWorldCard.locator('button[aria-pressed]:not([data-testid])').click();
    await page.getByTestId('world-atlas-hero-title').filter({ hasText: realRealmSession.displayName }).waitFor({ state: 'visible', timeout: 30_000 });
  }
  let localAgentRef;
  let agentIdentity;
  if (productSourceKind === 'realmPersona') {
    ({ localAgentRef, agentIdentity } = await materializePrimaryPersona({
      page,
      electronApp,
      activeSourceRef,
      agentClient,
      observations,
      journeyAgents,
      desktopScreenshotPath,
      narrowScreenshotPath,
      materializationFailureScreenshotPath: sourceDetailMaterializationFailureScreenshotPath,
      waitForDiscoveredLocalAgent,
      runtimeAgentIdentity,
    }));
  } else {
  const worldPreviewPeople = page.getByTestId('world-atlas-preview-people');
  await worldPreviewPeople.waitFor({ state: 'visible', timeout: 60_000 });
  if (!realRealmSession || disabledActionOnly) {
    await worldPreviewPeople.locator('button:disabled').first().waitFor({ state: 'visible', timeout: 30_000 });
    observations.worldPreviewDisabledActions = await worldPreviewPeople.locator('button:disabled').count();
    assert.ok(observations.worldPreviewDisabledActions > 0, 'World preview must expose a disabled/unavailable source action.');
  }

  if (disabledActionOnly) {
    assert.equal(realRealmSession, null, 'disabled-action-only acceptance must use the deterministic negative fixture');
    await completeDisabledActionAcceptance({
      page,
      electronApp,
      observations,
      desktopScreenshotPath,
      narrowScreenshotPath,
      resultPath,
      runtimeEndpoint: runtimeContext.endpoint,
      fixtureOrigin: desktopFixtureOrigin,
      consoleErrors,
      consoleErrorDetails,
      pageErrors,
    });
    throw new AcceptanceCompletedSignal('disabled-action-only acceptance completed');
  }

  await captureScreenshot(page, desktopScreenshotPath);
  const desktopLayout = await inspectLayout(page);
  observations.desktopLayout = desktopLayout;
  assert.equal(desktopLayout.hasHorizontalOverflow, false, `desktop layout overflow: ${JSON.stringify(desktopLayout)}`);
  observations.desktopAccessibility = await inspectAccessibility(page);
  assert.equal(
    observations.desktopAccessibility.unnamedInteractiveControls.length,
    0,
    `desktop interactive controls require accessible names: ${JSON.stringify(observations.desktopAccessibility)}`,
  );

  const firstWorldCharacterProfileButton = worldPreviewPeople.locator('button[aria-label]').first();
  await firstWorldCharacterProfileButton.waitFor({ state: 'visible', timeout: 60_000 });
  observations.worldCharacterProfileActionLabel = await firstWorldCharacterProfileButton.getAttribute('aria-label');
  await firstWorldCharacterProfileButton.click();
  try {
    await page.getByTestId('world-character-source-detail-page').waitFor({ state: 'visible', timeout: 60_000 });
  } catch (error) {
    observations.sourceDetailNavigationFailure = {
      bodyText: normalizeWhitespace(await page.locator('body').innerText()).slice(0, 3000),
      sourceDetailSkeletons: await page.getByTestId('source-detail-skeleton').count(),
      activePanels: await page.locator('[data-testid^="panel:"]:visible').evaluateAll((nodes) => (
        nodes.map((node) => node.getAttribute('data-testid'))
      )),
    };
    await captureScreenshot(page, sourceDetailNavigationFailureScreenshotPath);
    throw error;
  }
  assert.equal(
    await page.getByTestId('source-detail-compact-profile-card').count(),
    0,
    'Source Detail must render the world-character page, not the legacy compact page.',
  );
  observations.sourceDetailSurface = 'world-character';
  if (!realRealmSession) {
    await page.locator('[data-testid="world-character-hero-avatar"] img[src*="yan-zhenqing-avatar"]').waitFor({
      state: 'visible', timeout: 30_000,
    });
    observations.worldCharacterHeroAvatarImages = await page
      .locator('[data-testid="world-character-hero-avatar"] img[src*="yan-zhenqing-avatar"]')
      .count();
    await page.getByTestId('world-character-media-section').waitFor({ state: 'visible', timeout: 30_000 });
  }

  await setElectronWindowSize(electronApp, 390, 860);
  await captureScreenshot(page, narrowScreenshotPath);
  const narrowLayout = await inspectLayout(page);
  observations.narrowLayout = narrowLayout;
  assert.equal(narrowLayout.hasHorizontalOverflow, false, `narrow layout overflow: ${JSON.stringify(narrowLayout)}`);
  observations.narrowAccessibility = await inspectAccessibility(page);
  assert.equal(
    observations.narrowAccessibility.unnamedInteractiveControls.length,
    0,
    `narrow interactive controls require accessible names: ${JSON.stringify(observations.narrowAccessibility)}`,
  );

  await setElectronWindowSize(electronApp, 1440, 940);
  const becomePartnerAction = page
    .locator('[data-testid="world-character-hero-actions"] button[data-primary-action="become_partner"]')
    .first();
  await becomePartnerAction.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await becomePartnerAction.isEnabled(), true, 'world-character materialization action must be enabled');

  if (preMaterializationOffline) {
    ({ runtimeContext, runtimeDaemon, runtime, agentClient } = await runPreMaterializationOfflineJourney({
      runtimeContext,
      runtimeDaemon,
      page,
      becomePartnerAction,
      agentClient,
      productOwnerUserId,
      fixtureOrigin: fixtureServer.origin,
      observations,
      consoleErrors,
      consoleErrorDetails,
      pageErrors,
      resultPath,
      productJourneyId,
      paths: {
        realmScreenshot: realmOfflineBeforeMaterializeScreenshotPath,
        runtimeScreenshot: runtimeOfflineBeforeMaterializeScreenshotPath,
        realmEvidence: realmOfflineBeforeMaterializeEvidencePath,
        runtimeEvidence: runtimeOfflineBeforeMaterializeEvidencePath,
      },
      restart: {
        fixtureOrigin: desktopFixtureOrigin,
        realmIssuerOrigin: realRealmSession?.realmIssuer || desktopFixtureOrigin,
        providerOrigin: fixtureServer.origin,
        homeDir: isolatedHome,
        stateRoot: runtimeStateRoot,
        runtimeDir,
        baseEnv: acceptanceBaseEnv,
        runtimeConfigPath,
        stdoutPath: runtimeStdoutPath,
        stderrPath: runtimeStderrPath,
      },
    }));
    throw new AcceptanceCompletedSignal('pre-materialization-offline acceptance completed');
  }
  await becomePartnerAction.click();

  const discovered = await waitForDiscoveredLocalAgent(agentClient);
  if (discovered.length !== 1) {
    observations.sourceDetailAfterMaterializationText = normalizeWhitespace(await page.locator('body').innerText())
      .slice(0, 2200);
    await captureScreenshot(page, sourceDetailMaterializationFailureScreenshotPath);
    observations.sourceMaterializationProxyCapture = rendererServer.capturedRequests
      .filter((item) => item.pathname === '/api/realm/core/source-materialization-packets').at(-1) || null;
    observations.sourceMaterializationJwksCapture = rendererServer.capturedRequests
      .filter((item) => item.pathname === '/api/auth/jwks/source-materialization').at(-1) || null;
  }
  assert.equal(discovered.length, 1, `expected one Runtime-owned local agent, got ${discovered.length}; capture=${JSON.stringify(observations.sourceMaterializationProxyCapture || null)}; jwks=${JSON.stringify(observations.sourceMaterializationJwksCapture || null)}; surface=${observations.sourceDetailAfterMaterializationText}`);
  localAgentRef = discovered[0].localAgentRef;
  assert.match(localAgentRef, /^local-agent:runtime-/u, `localAgentRef is not Runtime-owned opaque ref: ${localAgentRef}`);
  assert.ok(!localAgentRef.includes(activeSourceRef.sourceId), `localAgentRef leaks app source id: ${localAgentRef}`);
  observations.localAgentRef = localAgentRef;
  observations.runtimeSourceRef = discovered[0].runtimeSourceRef;
  observations.materializedSourceSnapshotHash = discovered[0].snapshotHash;
  observations.materializedSourceContextState = discovered[0].sourceContextStatus?.state || null;
  assert.equal(discovered[0].sourceContextStatus?.ready, true, 'Character Runtime source snapshot must be ready');
  assert.match(discovered[0].snapshotHash || '', /^[a-f0-9]{64}$/u, 'Character Runtime source snapshot hash must be bounded');
  agentIdentity = runtimeAgentIdentity(localAgentRef, discovered[0].runtimeSourceRef);
  journeyAgents.push({
    sourceKind: 'worldCharacter',
    sourceRef: activeSourceRef,
    localAgentRef,
    runtimeSourceRef: discovered[0].runtimeSourceRef,
    snapshotHash: discovered[0].snapshotHash || null,
    displayName: observations.sourceDetailDisplayName || observations.agentDisplayName || 'Runtime Live Source',
  });

  await page.getByTestId('world-character-back-button').click();
  await page.getByTestId('nav-tab:agents').waitFor({ state: 'visible', timeout: 30_000 });
  observations.sourceDetailBackRestoredPrimaryRail = true;
  await page.getByTestId('nav-tab:agents').click();
  await page.getByTestId('panel:agents').waitFor({ state: 'visible', timeout: 30_000 });
  const localAgentCard = page.getByTestId(`agents-card:${localAgentRef}`);
  await localAgentCard.waitFor({ state: 'visible', timeout: 30_000 });
  await localAgentCard.click();
  await page.getByTestId('world-character-source-detail-page').waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(
    await page.getByTestId('source-detail-compact-profile-card').count(),
    0,
    'Materialized LocalAgent card must open the world-character page, not the legacy compact page.',
  );
  const openPartnerAction = page.locator('[data-testid="world-character-hero-actions"] button:not([data-primary-action])').first();
  await openPartnerAction.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await openPartnerAction.isEnabled(), true, 'Source Detail Open partner action must be enabled for existing Runtime localAgent.');
  await captureScreenshot(page, sourceDetailOpenPartnerScreenshotPath);
  await openPartnerAction.click();
  }
  await page.getByTestId('chat-page').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId(`chat-target:${localAgentRef}`).waitFor({ state: 'visible', timeout: 30_000 });
  observations.sourceDetailOpenPartnerRoutedToAgentChat = true;
  await page.getByTestId('message-timeline').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);

  const { sharedAuthSessionCommands, sharedAgentIntents } = await runDesktopAgentChatJourney({
    page,
    localAgentRef,
    productSourceKind,
    realRealmSession,
    chatScreenshotPath,
    observations,
    agentClient,
    agentIdentity,
    readRuntimeAgentAIConfig,
    waitForRuntimeTextGenerateTargetRef,
    paths: {
      modelSettings: agentModelSettingsScreenshotPath,
      modelChatDetail: agentModelChatDetailScreenshotPath,
      modelPicker: agentModelPickerScreenshotPath,
      modelSelected: agentModelSelectedScreenshotPath,
      chatSendAttempt: chatSendAttemptScreenshotPath,
    },
    fullChainCore,
    mediaRoutes,
    artifactsDir,
    queueProviderPlan,
    waitForProviderCheckpoint,
    providerCheckpointCount,
  });

  const fixtureManifest = await fetchJson(`${fixtureServer.origin}/__fixture/control/manifest`);
  const packetRequests = realRealmSession
    ? rendererServer.capturedRequests.filter((item) => item.pathname === '/api/realm/core/source-materialization-packets')
    : fixtureManifest.realmFixture?.sourceMaterializationPacketRequests || [];
  const packetRequest = packetRequests.find((item) =>
    item?.sourceRef?.kind === activeSourceRef.kind
    && item?.sourceRef?.worldId === activeSourceRef.worldId
    && item?.sourceRef?.sourceId === activeSourceRef.sourceId
    && item?.sourceRef?.sourceContentHash === activeSourceRef.sourceContentHash
  );
  assert.ok(packetRequest, `expected fresh SourceMaterializationPacket request, got ${JSON.stringify(packetRequests)}`);
  observations.packetRequest = packetRequest;

  const materializePersonaForJourney = () => materializeJourneyPersona({
    page,
    realRealmSession,
    agentClient,
    mediaRoutes,
    sharedAgentIntents,
    journeyAgents,
    observations,
    personaMaterializedScreenshotPath,
    waitForDiscoveredLocalAgent,
    runtimeAgentIdentity,
  });

  if (!crossAppHandoffPath) {
    const accountMenuTrigger = page.getByTestId('desktop-account-menu-trigger');
    await accountMenuTrigger.waitFor({ state: 'visible', timeout: 30_000 });
    await accountMenuTrigger.click();
    const switchAccountButton = page.getByTestId('desktop-account-switch');
    await switchAccountButton.waitFor({ state: 'visible', timeout: 30_000 });
    observations.desktopAccountSwitchEnabled = await switchAccountButton.isEnabled();
    assert.equal(observations.desktopAccountSwitchEnabled, true, 'Desktop Switch account control must be enabled');
    await switchAccountButton.click();
    await page.getByTestId('login-screen').waitFor({ state: 'visible', timeout: 30_000 });
    observations.desktopAccountSwitchReachedLoginRequired = true;

    const reauthObservations = {};
    await completeRuntimeAccountLogin(runtime, reauthObservations);
    observations.desktopRuntimeFixtureReauthentication = reauthObservations.runtimeAccount;
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await waitForDesktopSurface(page), 'main', 'Desktop must restore the main shell after Runtime-owned fixture re-authentication');

    const restoredAccountMenuTrigger = page.getByTestId('desktop-account-menu-trigger');
    await restoredAccountMenuTrigger.waitFor({ state: 'visible', timeout: 30_000 });
    await restoredAccountMenuTrigger.click();
    const logoutButton = page.getByTestId('desktop-account-logout');
    await logoutButton.waitFor({ state: 'visible', timeout: 30_000 });
    observations.desktopAccountLogoutEnabled = await logoutButton.isEnabled();
    assert.equal(observations.desktopAccountLogoutEnabled, true, 'Desktop Log out control must be enabled');
    await logoutButton.click();
    await page.getByTestId('login-screen').waitFor({ state: 'visible', timeout: 30_000 });
    observations.desktopAccountLogoutReachedLoginRequired = true;
  }

  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`renderer console/page errors observed: ${JSON.stringify({ consoleErrors, pageErrors }, null, 2)}`);
  }

  if (crossAppHandoffPath) {
    ({ runtimeContext, runtimeDaemon, runtime, agentClient } = await holdCrossAppJourney({
      runtimeContext,
      runtimeDaemon,
      runtime,
      agentClient,
      crossAppHandoffPath,
      crossAppReleasePath,
      crossAppProviderRawPath,
      crossAppControlRoot,
      fullChainCore,
      productJourneyId,
      fixtureManifest,
      fixtureOrigin: fixtureServer.origin,
      realtimeFixtureOrigin,
      desktopFixtureOrigin,
      standardDataRoot,
      acceptedRuntimeDataRoot,
      productOwnerUserId,
      agentIdentity,
      localAgentRef,
      displayName: observations.sourceDetailDisplayName || observations.agentDisplayName || (productSourceKind === 'realmPersona' ? 'Solace' : 'Runtime Live Source'),
      activeSourceRef,
      packetRequest,
      mediaRoutes,
      journeyAgents,
      observations,
      screenshots: [desktopScreenshotPath, narrowScreenshotPath, chatScreenshotPath],
      materializePersona: materializePersonaForJourney,
      waitForControlFile,
      consoleErrors,
      pageErrors,
      restart: {
        fixtureOrigin: desktopFixtureOrigin,
        realmIssuerOrigin: realRealmSession?.realmIssuer || desktopFixtureOrigin,
        providerOrigin: fixtureServer.origin,
        homeDir: isolatedHome,
        stateRoot: runtimeStateRoot,
        runtimeDir,
        baseEnv: acceptanceBaseEnv,
        runtimeConfigPath,
        stdoutPath: runtimeStdoutPath,
        stderrPath: runtimeStderrPath,
      },
    }));
  }

  writeJsonFile(resultPath, {
    ok: true,
    runtimeEndpoint: runtimeContext.endpoint,
    fixtureOrigin: desktopFixtureOrigin,
    realtimeOrigin: realtimeFixtureOrigin,
    observations,
    screenshots: {
      desktopExplore: desktopScreenshotPath,
      narrowExplore: narrowScreenshotPath,
      desktopChat: chatScreenshotPath,
      sourceDetailMaterializationFailure: fs.existsSync(sourceDetailMaterializationFailureScreenshotPath)
        ? sourceDetailMaterializationFailureScreenshotPath
        : null,
      sourceDetailOpenPartner: sourceDetailOpenPartnerScreenshotPath,
      chatSendAfterModelSelection: chatSendAttemptScreenshotPath,
      agentModelSettings: agentModelSettingsScreenshotPath,
      agentModelChatDetail: agentModelChatDetailScreenshotPath,
      agentModelPicker: agentModelPickerScreenshotPath,
      agentModelSelected: agentModelSelectedScreenshotPath,
      personaMaterialized: fs.existsSync(personaMaterializedScreenshotPath) ? personaMaterializedScreenshotPath : null,
    },
    sharedAuth: {
      success: {
        observed: observations.runtimeAccount?.stage === 'authenticated',
        runtimeAccount: observations.runtimeAccount,
        realmBrokerConsumption: observations.sourceDetailSurface === 'world-character',
      },
      failure: {
        observed: observations.desktopAccountSwitchReachedLoginRequired === true
          && observations.desktopAccountLogoutReachedLoginRequired === true,
        switchAccountReachedLoginRequired: observations.desktopAccountSwitchReachedLoginRequired === true,
        logoutReachedLoginRequired: observations.desktopAccountLogoutReachedLoginRequired === true,
      },
      denied: {
        observed: sharedAuthSessionCommands.every((row) => row.denied),
        sessionCommands: sharedAuthSessionCommands,
      },
      disabled: {
        observed: observations.worldPreviewDisabledActions > 0,
        visibleDisabledControls: observations.worldPreviewDisabledActions,
      },
      tokenLeak: observations.tokenLeak,
    },
    consoleErrors,
    consoleErrorDetails,
    pageErrors,
  });
  console.log(JSON.stringify({
    ok: true,
    resultPath,
    screenshots: [desktopScreenshotPath, narrowScreenshotPath, chatScreenshotPath, sourceDetailOpenPartnerScreenshotPath],
    localAgentRef,
  }, null, 2));
} catch (error) {
  if (!(error instanceof AcceptanceCompletedSignal)) {
  writeJsonFile(resultPath, {
    ok: false,
    error: formatError(error),
    observations,
    screenshots: {
      firstRunOrFailure: fs.existsSync(firstRunScreenshotPath) ? firstRunScreenshotPath : null,
      desktopExplore: fs.existsSync(desktopScreenshotPath) ? desktopScreenshotPath : null,
      narrowExplore: fs.existsSync(narrowScreenshotPath) ? narrowScreenshotPath : null,
      desktopChat: fs.existsSync(chatScreenshotPath) ? chatScreenshotPath : null,
      sourceDetailMaterializationFailure: fs.existsSync(sourceDetailMaterializationFailureScreenshotPath)
        ? sourceDetailMaterializationFailureScreenshotPath
        : null,
      sourceDetailOpenPartner: fs.existsSync(sourceDetailOpenPartnerScreenshotPath) ? sourceDetailOpenPartnerScreenshotPath : null,
      chatSendAfterModelSelection: fs.existsSync(chatSendAttemptScreenshotPath) ? chatSendAttemptScreenshotPath : null,
      agentModelSettings: fs.existsSync(agentModelSettingsScreenshotPath) ? agentModelSettingsScreenshotPath : null,
      agentModelChatDetail: fs.existsSync(agentModelChatDetailScreenshotPath) ? agentModelChatDetailScreenshotPath : null,
      agentModelPicker: fs.existsSync(agentModelPickerScreenshotPath) ? agentModelPickerScreenshotPath : null,
      agentModelSelected: fs.existsSync(agentModelSelectedScreenshotPath) ? agentModelSelectedScreenshotPath : null,
    },
    consoleErrors,
    consoleErrorDetails,
    pageErrors,
  });
  throw error;
  }
} finally {
  if (electronApp) {
    await electronApp.close().catch(() => undefined);
  }
  if (runtimeDaemon) {
    await terminateDaemon(runtimeDaemon);
  }
  await rendererServer?.close().catch(() => undefined);
  await fixtureServer.close().catch(() => undefined);
}
