#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { Runtime } from '@nimiplatform/sdk/runtime';
import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';
import {
  APP_ID,
  OWNER_USER_ID,
  VALID_CHARACTER_ID,
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
  terminateDaemon,
  writeJsonFile,
} from './explore-materialization-acceptance/acceptance-files.mjs';
import {
  captureScreenshot,
  inspectAccessibility,
  inspectLayout,
  normalizeWhitespace,
  openExploreWorlds,
  readAIConfigStorageSnapshot,
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
const artifactsDir = path.join(appRoot, 'reports', 'e2e', 'explore-materialization-acceptance');
const sourcePacketSecret = process.env.SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET
  || 'desktop-e2e-source-materialization-secret';
const acceptanceBaseEnv = { ...process.env };
delete acceptanceBaseEnv.SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET;
safeResetDir(artifactsDir, { reportsRoot: path.join(appRoot, 'reports', 'e2e') });
const runtimeStdoutPath = path.join(artifactsDir, 'runtime-stdout.log');
const runtimeStderrPath = path.join(artifactsDir, 'runtime-stderr.log');
const desktopScreenshotPath = path.join(artifactsDir, 'desktop-explore-world-character.png');
const narrowScreenshotPath = path.join(artifactsDir, 'narrow-world-character-detail.png');
const chatScreenshotPath = path.join(artifactsDir, 'desktop-chat-consumption.png');
const sourceDetailOpenPartnerScreenshotPath = path.join(artifactsDir, 'desktop-source-detail-open-partner.png');
const sourceDetailMaterializationFailureScreenshotPath = path.join(artifactsDir, 'desktop-source-detail-materialization-failure.png');
const chatSendAttemptScreenshotPath = path.join(artifactsDir, 'desktop-chat-send-after-model-selection.png');
const agentModelSettingsScreenshotPath = path.join(artifactsDir, 'desktop-agent-model-settings.png');
const agentModelChatDetailScreenshotPath = path.join(artifactsDir, 'desktop-agent-model-chat-detail.png');
const agentModelPickerScreenshotPath = path.join(artifactsDir, 'desktop-agent-model-picker.png');
const agentModelSelectedScreenshotPath = path.join(artifactsDir, 'desktop-agent-model-selected.png');
const firstRunScreenshotPath = path.join(artifactsDir, 'blocked-first-run.png');
const resultPath = path.join(artifactsDir, 'acceptance-result.json');
const manifestPath = path.join(artifactsDir, 'realm-fixture-manifest.json');
const isolatedHome = path.join(artifactsDir, 'home');
const standardDataRoot = path.join(artifactsDir, 'electron-standard-data');
const runtimeStateRoot = path.join(artifactsDir, 'runtime-state');
const runtimeDataRoot = path.join(artifactsDir, 'runtime-data');
const runtimeConfigPath = path.join(runtimeStateRoot, 'config.json');
fs.mkdirSync(isolatedHome, { recursive: true });
fs.mkdirSync(standardDataRoot, { recursive: true });
fs.mkdirSync(runtimeStateRoot, { recursive: true });
fs.mkdirSync(runtimeDataRoot, { recursive: true });
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
let rendererServer;
rendererServer = await startAcceptanceRendererServer({
  distDir: path.join(appRoot, 'dist'),
  apiOrigin: fixtureServer.origin,
});
rendererUrl = `${rendererServer.origin}/index.html?nimiExploreMaterializationAcceptance=1`;
const desktopFixtureOrigin = rendererServer.origin;
const realtimeFixtureOrigin = localhostOrigin(fixtureServer.origin);
writeJsonFile(manifestPath, createRealmFixtureManifest(desktopFixtureOrigin, fixtureServer.origin));

let runtimeDaemon = null;
let electronApp = null;
const consoleErrors = [];
const consoleErrorDetails = [];
const pageErrors = [];
const observations = {};

async function waitForDiscoveredLocalAgent(agentClient) {
  const deadline = Date.now() + 60_000;
  let discovered = [];
  while (Date.now() < deadline) {
    discovered = await agentClient.discoverBySource({
      ownerUserId: OWNER_USER_ID,
      sourceRef: VALID_SOURCE_REF,
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
    ownerUserId: OWNER_USER_ID,
    subjectUserId: OWNER_USER_ID,
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
  const runtimeContext = await startRuntimeDaemon({
    fixtureOrigin: fixtureServer.origin,
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
  const runtime = new Runtime({
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint: runtimeContext.endpoint,
    },
  });
  await completeRuntimeAccountLogin(runtime, observations);
  observations.productControl = await prepareRuntimeProductControl(runtime, runtimeDataRoot).catch((error) => ({
    state: 'setup_failed',
    error: formatError(error),
  }));
  const agentClient = createAcceptanceAgentClient(runtime);

  electronApp = await electron.launch({
    executablePath: electronExecutablePath,
    args: [mainEntry],
    env: {
      ...acceptanceBaseEnv,
      NIMI_REALM_URL: desktopFixtureOrigin,
      NIMI_REALTIME_URL: realtimeFixtureOrigin,
      NIMI_ACCESS_TOKEN: 'desktop-acceptance-access-token',
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
  const worldPreviewPeople = page.getByTestId('world-atlas-preview-people');
  await worldPreviewPeople.waitFor({ state: 'visible', timeout: 60_000 });
  observations.worldPreviewDisabledActions = await worldPreviewPeople.locator('button:disabled').count();
  assert.ok(
    observations.worldPreviewDisabledActions > 0,
    'World preview must expose a disabled/unavailable source action.',
  );

  await captureScreenshot(page, desktopScreenshotPath);
  const desktopLayout = await inspectLayout(page);
  assert.equal(desktopLayout.hasHorizontalOverflow, false, `desktop layout overflow: ${JSON.stringify(desktopLayout)}`);
  observations.desktopAccessibility = await inspectAccessibility(page);
  assert.equal(
    observations.desktopAccessibility.unnamedInteractiveControls.length,
    0,
    `desktop interactive controls require accessible names: ${JSON.stringify(observations.desktopAccessibility)}`,
  );

  const firstWorldCharacterProfileButton = worldPreviewPeople.locator('button[aria-label]').first();
  await firstWorldCharacterProfileButton.waitFor({ state: 'visible', timeout: 60_000 });
  await firstWorldCharacterProfileButton.click();
  await page.getByTestId('world-character-source-detail-page').waitFor({ state: 'visible', timeout: 60_000 });
  assert.equal(
    await page.getByTestId('source-detail-compact-profile-card').count(),
    0,
    'Source Detail must render the world-character page, not the legacy compact page.',
  );
  observations.sourceDetailSurface = 'world-character';
  await page.locator('[data-testid="world-character-hero-avatar"] img[src*="yan-zhenqing-avatar"]').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  observations.worldCharacterHeroAvatarImages = await page
    .locator('[data-testid="world-character-hero-avatar"] img[src*="yan-zhenqing-avatar"]')
    .count();
  await page.getByTestId('world-character-media-section').waitFor({ state: 'visible', timeout: 30_000 });

  await setElectronWindowSize(electronApp, 390, 860);
  await captureScreenshot(page, narrowScreenshotPath);
  const narrowLayout = await inspectLayout(page);
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
  await becomePartnerAction.click();

  const discovered = await waitForDiscoveredLocalAgent(agentClient);
  if (discovered.length !== 1) {
    observations.sourceDetailAfterMaterializationText = normalizeWhitespace(await page.locator('body').innerText())
      .slice(0, 2200);
    await captureScreenshot(page, sourceDetailMaterializationFailureScreenshotPath);
  }
  assert.equal(discovered.length, 1, `expected one Runtime-owned local agent, got ${discovered.length}`);
  const localAgentRef = discovered[0].localAgentRef;
  assert.match(localAgentRef, /^local-agent:runtime-/u, `localAgentRef is not Runtime-owned opaque ref: ${localAgentRef}`);
  assert.ok(!localAgentRef.includes(VALID_CHARACTER_ID), `localAgentRef leaks app source id: ${localAgentRef}`);
  observations.localAgentRef = localAgentRef;
  observations.runtimeSourceRef = discovered[0].runtimeSourceRef;
  const agentIdentity = runtimeAgentIdentity(localAgentRef, discovered[0].runtimeSourceRef);

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
  await page.getByTestId('chat-page').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId(`chat-target:${localAgentRef}`).waitFor({ state: 'visible', timeout: 30_000 });
  observations.sourceDetailOpenPartnerRoutedToAgentChat = true;
  await page.getByTestId('message-timeline').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);

  const agentRailTarget = page.getByTestId(`chat-target:${localAgentRef}`);
  await agentRailTarget.waitFor({ state: 'visible', timeout: 30_000 });
  observations.agentChatLocalAgentRailTargetVisible = await agentRailTarget.isVisible();
  assert.equal(observations.agentChatLocalAgentRailTargetVisible, true, 'Agent Chat rail must list Runtime ListAgents localAgent targets.');
  await agentRailTarget.locator('img[src*="yan-zhenqing-avatar"]').waitFor({ state: 'visible', timeout: 30_000 });
  observations.agentChatLocalAgentRailAvatarImages = await agentRailTarget
    .locator('img[src*="yan-zhenqing-avatar"]')
    .count();
  assert.ok(observations.agentChatLocalAgentRailAvatarImages > 0, 'Agent Chat rail must render the source-backed avatar image.');
  await captureScreenshot(page, chatScreenshotPath);
  observations.chatAccessibility = await inspectAccessibility(page);
  assert.equal(
    observations.chatAccessibility.unnamedInteractiveControls.length,
    0,
    `chat interactive controls require accessible names: ${JSON.stringify(observations.chatAccessibility)}`,
  );
  observations.agentChatInitialAIConfigStorage = await readAIConfigStorageSnapshot(page);
  observations.agentChatInitialRuntimeAIConfig = await readRuntimeAgentAIConfig(agentClient, agentIdentity);

  const composerTextarea = page.locator('[data-chat-composer-textarea="true"]').first();
  await composerTextarea.waitFor({ state: 'visible', timeout: 30_000 });
  observations.agentComposerInitiallyDisabled = await composerTextarea.isDisabled();
  observations.agentComposerInitialRouteHintVisible = await page.getByText(/发送消息前请先选择|Choose a local or cloud runtime route|local or cloud runtime route|本地.*云端.*runtime.*路由/i).count();

  const settingsToggle = page.getByTestId('chat-settings-toggle');
  await settingsToggle.waitFor({ state: 'visible', timeout: 30_000 });
  await settingsToggle.click();
  await page.getByTestId('chat-agent-center-section:model').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('chat-agent-center-section:model').click();
  await page.waitForTimeout(2500);
  await captureScreenshot(page, agentModelSettingsScreenshotPath);
  observations.agentModelSettingsAIConfigStorage = await readAIConfigStorageSnapshot(page);
  observations.agentModelSettingsRuntimeAIConfig = await readRuntimeAgentAIConfig(agentClient, agentIdentity);
  observations.agentModelSettingsEnglishCopyVisible = await page
    .locator('[data-agent-center-model-surface="runtime-model-config-hub"]')
    .first()
    .getByText(/Runtime ready|Needs setup|Import AI Profile|No profile applied|AI Profile/i)
    .count();
  observations.agentModelSettingsEnglishStatusTransitionCopyVisible = await page
    .locator('[data-agent-center-model-surface="runtime-model-config-hub"]')
    .first()
    .getByText(/Saving Runtime Agent AI Config|Saved Runtime Agent AI Config|Runtime Agent AI Config adapter unavailable|Runtime Agent AI Config revision unavailable|Runtime Agent AI Config update failed/i)
    .count();
  observations.agentModeUnavailableVisible = await page.getByText(/Agent mode is temporarily unavailable/i).count();
  assert.equal(observations.agentModelSettingsEnglishCopyVisible, 0, 'Agent model settings must not leak English model/profile status copy in zh shell.');
  assert.equal(observations.agentModelSettingsEnglishStatusTransitionCopyVisible, 0, 'Agent model settings must not leak English Runtime AIConfig transition status copy in zh shell.');
  assert.equal(observations.agentModeUnavailableVisible, 0, 'Agent model settings must not fall back to unavailable mode.');
  const chatModelSection = page.locator('[data-nimi-model-config-section="chat"]').first();
  if (await chatModelSection.count()) {
    await chatModelSection.click();
    await page.waitForTimeout(1000);
    await captureScreenshot(page, agentModelChatDetailScreenshotPath);
    observations.agentModelChatDetailVisible = await page.locator('[data-nimi-model-config-detail-section="chat"]').count();
    observations.agentModelChatDetailEnglishConfigurationVisible = await page
      .locator('[data-nimi-model-config-detail-section="chat"]')
      .first()
      .getByText(/Configuration/i)
      .count();
    observations.agentModelChatDetailEnglishStatusVisible = await page
      .locator('[data-nimi-model-config-detail-section="chat"]')
      .first()
      .getByText(/Runtime ready|Needs setup|Setup required|Model selection required|Not configured|Click to change model/i)
      .count();
    observations.agentModeUnavailableAfterChatDetailVisible = await page.getByText(/Agent mode is temporarily unavailable/i).count();
    assert.equal(observations.agentModelChatDetailEnglishConfigurationVisible, 0, 'Agent chat model detail must not leak English Configuration copy in zh shell.');
    assert.equal(observations.agentModelChatDetailEnglishStatusVisible, 0, 'Agent chat model detail must not leak English status copy in zh shell.');
    assert.equal(observations.agentModeUnavailableAfterChatDetailVisible, 0, 'Agent chat model detail must not fall back to unavailable mode.');
    const textGenerateCard = page.locator('[data-nimi-model-config-capability="text.generate"]').first();
    observations.agentTextGenerateCardVisible = await textGenerateCard.count();
    if (await textGenerateCard.count()) {
      await textGenerateCard.locator('button').first().click();
      await page.waitForTimeout(2500);
      await captureScreenshot(page, agentModelPickerScreenshotPath);
      const modelPickerDialog = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: /选择模型|Select Model/u }).first();
      await modelPickerDialog.waitFor({ state: 'visible', timeout: 30_000 });
      observations.agentModelPickerDialogVisible = await modelPickerDialog.count();
      observations.agentModelPickerLocalizedTitleVisible = await modelPickerDialog.getByText('选择模型').count();
      observations.agentModelPickerLocalizedLocalTabVisible = await modelPickerDialog.getByText('本地').count();
      observations.agentModelPickerLocalizedCloudTabVisible = await modelPickerDialog.getByText('云端').count();
      observations.agentModelPickerLocalizedSearchVisible = await modelPickerDialog.getByPlaceholder('搜索模型').count();
      observations.agentModelPickerEnglishCopyVisible = await modelPickerDialog.getByText(/Select Model|Search models|Text Generation/i).count();
      observations.agentModelPickerNoModelsVisible = await page.getByText(/没有可用模型|当前能力没有可用的本地模型|No models available|No local models available/i).count();
      observations.agentModeUnavailableAfterPickerVisible = await page.getByText(/Agent mode is temporarily unavailable/i).count();
      assert.equal(observations.agentModeUnavailableAfterPickerVisible, 0, 'Agent model picker must not fall back to unavailable mode.');
      assert.equal(observations.agentModelPickerDialogVisible, 1, 'Agent text.generate model picker must open.');
      assert.ok(observations.agentModelPickerLocalizedTitleVisible > 0, 'Agent model picker must render localized Chinese title.');
      assert.ok(observations.agentModelPickerLocalizedLocalTabVisible > 0, 'Agent model picker must render localized Local tab.');
      assert.ok(observations.agentModelPickerLocalizedCloudTabVisible > 0, 'Agent model picker must render localized Cloud tab.');
      assert.ok(observations.agentModelPickerLocalizedSearchVisible > 0, 'Agent model picker must render localized search placeholder.');
      assert.equal(observations.agentModelPickerEnglishCopyVisible, 0, 'Agent model picker must not leak English default copy in zh shell.');
      assert.equal(observations.agentModelPickerNoModelsVisible, 0, 'Agent text.generate picker must expose real Runtime route options.');

      const firstLocalModelButton = modelPickerDialog.locator('button').filter({ hasText: /local\./i }).first();
      await firstLocalModelButton.waitFor({ state: 'visible', timeout: 30_000 });
      observations.agentModelSelectedButtonText = normalizeWhitespace(await firstLocalModelButton.innerText());
      await firstLocalModelButton.click();
      await modelPickerDialog.waitFor({ state: 'detached', timeout: 30_000 }).catch(async () => {
        await modelPickerDialog.waitFor({ state: 'hidden', timeout: 30_000 });
      });
      const selectedAIConfig = await waitForRuntimeTextGenerateTargetRef(agentClient, agentIdentity);
      observations.agentModelSelectedAIConfigTargetRef = selectedAIConfig.targetRef;
      observations.agentModelSelectedRuntimeAIConfig = selectedAIConfig.snapshot;
      observations.agentModelSelectedAIConfigStorage = await readAIConfigStorageSnapshot(page);
      await page.waitForTimeout(500);
      await captureScreenshot(page, agentModelSelectedScreenshotPath);
      observations.agentModelSelectedRouteUnavailableVisible = await page.getByText(/Route unhealthy|Route needs setup|路由不健康|路由需要配置|未通过最近一次健康检查|尚未就绪|latest health check|not ready/i).count();
      observations.agentModelSelectedEnglishStatusTransitionCopyVisible = await page
        .getByText(/Saving Runtime Agent AI Config|Saved Runtime Agent AI Config|Runtime Agent AI Config adapter unavailable|Runtime Agent AI Config revision unavailable|Runtime Agent AI Config update failed/i)
        .count();
      assert.equal(observations.agentModelSelectedEnglishStatusTransitionCopyVisible, 0, 'Agent model selection must not leak English Runtime AIConfig transition status copy in zh shell.');
    }
  }
  assert.ok(observations.agentModelChatDetailVisible, 'Agent chat model detail must be visible.');
  assert.ok(observations.agentTextGenerateCardVisible, 'Agent chat model detail must expose text.generate.');
  assert.ok(observations.agentModelSelectedAIConfigTargetRef, 'Selecting a model must write a text.generate targetRef.');

  await settingsToggle.click();
  await composerTextarea.waitFor({ state: 'visible', timeout: 30_000 });
  const sendButton = page.locator('[data-chat-composer-send="true"]').first();
  if (observations.agentModelSelectedRouteUnavailableVisible > 0) {
    observations.agentComposerTextareaDisabledAfterRouteSelection = await composerTextarea.isDisabled();
    observations.agentComposerSendDisabledAfterRouteSelection = await sendButton.isDisabled();
    observations.agentComposerRouteDisabledHintVisible = await page.getByText(/当前选择的 runtime 路由|selected runtime route|健康检查|health check|尚未就绪|not ready/i).count();
    await captureScreenshot(page, chatSendAttemptScreenshotPath);
    observations.agentChatAfterSendAIConfigStorage = await readAIConfigStorageSnapshot(page);
    observations.agentChatAfterSendRuntimeAIConfig = await readRuntimeAgentAIConfig(agentClient, agentIdentity);
    observations.agentChatSendSkippedReason = 'runtime_route_unavailable';
    assert.equal(
      observations.agentComposerTextareaDisabledAfterRouteSelection,
      true,
      'Agent composer textarea must be disabled when Runtime reports the selected route is unavailable.',
    );
    assert.equal(
      observations.agentComposerSendDisabledAfterRouteSelection,
      true,
      'Agent composer send must be disabled when Runtime reports the selected route is unavailable.',
    );
    assert.ok(
      observations.agentComposerRouteDisabledHintVisible > 0,
      'Agent composer must show a readable route-unavailable hint when Runtime reports the selected route is unavailable.',
    );
  } else {
    await composerTextarea.fill('你好');
    await sendButton.click();
    await page.waitForTimeout(2500);
    await captureScreenshot(page, chatSendAttemptScreenshotPath);
    observations.agentChatAfterSendAIConfigStorage = await readAIConfigStorageSnapshot(page);
    observations.agentChatAfterSendRuntimeAIConfig = await readRuntimeAgentAIConfig(agentClient, agentIdentity);
    observations.agentChatSendRouteErrorVisible = await page.getByText(/A local or cloud runtime route is required before sending a message|local or cloud runtime route|本地.*云端.*runtime.*路由/i).count();
    observations.agentChatTranscriptLocalizedTodayVisible = await page.getByText('今天').count();
    observations.agentChatTranscriptEnglishTodayVisible = await page.getByText(/^Today$/u).count();
    observations.agentChatTranscriptLocalizedThinkingVisible = await page.getByText(/正在思考/u).count();
    observations.agentChatTranscriptEnglishThinkingVisible = await page.getByText(/Thinking(?:\.\.\.|…)?/i).count();
    assert.equal(observations.agentChatSendRouteErrorVisible, 0, 'Agent Chat must not report missing route after selecting a model.');
    assert.ok(observations.agentChatTranscriptLocalizedTodayVisible > 0, 'Agent Chat transcript must render localized today date label in zh shell.');
    assert.equal(observations.agentChatTranscriptEnglishTodayVisible, 0, 'Agent Chat transcript must not leak English Today date label in zh shell.');
    assert.equal(observations.agentChatTranscriptEnglishThinkingVisible, 0, 'Agent Chat transcript must not leak English Thinking pending label in zh shell.');
  }

  const fixtureManifest = await fetchJson(`${fixtureServer.origin}/__fixture/control/manifest`);
  const packetRequests = fixtureManifest.realmFixture?.sourceMaterializationPacketRequests || [];
  const packetRequest = packetRequests.find((item) =>
    item?.sourceRef?.kind === VALID_SOURCE_REF.kind
    && item?.sourceRef?.worldId === VALID_SOURCE_REF.worldId
    && item?.sourceRef?.sourceId === VALID_SOURCE_REF.sourceId
    && item?.sourceRef?.sourceContentHash === VALID_SOURCE_REF.sourceContentHash
  );
  assert.ok(packetRequest, `expected fresh SourceMaterializationPacket request, got ${JSON.stringify(packetRequests)}`);
  observations.packetRequest = packetRequest;

  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`renderer console/page errors observed: ${JSON.stringify({ consoleErrors, pageErrors }, null, 2)}`);
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
