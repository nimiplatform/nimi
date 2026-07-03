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
  DISABLED_PERSONA_ID,
  OWNER_USER_ID,
  VALID_PERSONA_ID,
  VALID_SOURCE_REF,
} from './explore-materialization-acceptance/acceptance-constants.mjs';
import { createRealmFixtureManifest } from './explore-materialization-acceptance/acceptance-fixture.mjs';
import {
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
  inspectLayout,
  normalizeWhitespace,
  openExplorePersonas,
  readAIConfigStorageSnapshot,
  setElectronWindowSize,
  waitForAttribute,
  waitForDesktopSurface,
  waitForTextGenerateTargetRef,
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
const desktopScreenshotPath = path.join(artifactsDir, 'desktop-explore-persona.png');
const narrowScreenshotPath = path.join(artifactsDir, 'narrow-explore-persona.png');
const chatScreenshotPath = path.join(artifactsDir, 'desktop-chat-consumption.png');
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
writeJsonFile(manifestPath, createRealmFixtureManifest(desktopFixtureOrigin));

let runtimeDaemon = null;
let electronApp = null;
const consoleErrors = [];
const consoleErrorDetails = [];
const pageErrors = [];
const observations = {};

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
    window.localStorage.setItem('nimi.shell.locale', 'zh');
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
    window.localStorage.setItem('nimi.shell.locale', 'zh');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__), null, { timeout: 30_000 });

  const surface = await waitForDesktopSurface(page);
  observations.initialSurface = surface;
  if (surface !== 'main') {
    await captureScreenshot(page, firstRunScreenshotPath);
    throw new Error(`Desktop Electron did not reach main shell; surface=${surface}. Screenshot: ${firstRunScreenshotPath}`);
  }

  await openExplorePersonas(page);
  const validAction = page.getByTestId(`explore-persona-source-primary-action:${VALID_PERSONA_ID}`);
  const disabledAction = page.getByTestId(`explore-persona-source-primary-action:${DISABLED_PERSONA_ID}`);
  await validAction.waitFor({ state: 'visible', timeout: 60_000 });
  await disabledAction.waitFor({ state: 'visible', timeout: 60_000 });
  await waitForAttribute(validAction, 'data-primary-action', 'become_partner');
  await waitForAttribute(validAction, 'data-source-state', 'source_materialization_available');
  await waitForAttribute(disabledAction, 'data-primary-action', 'source_materialization_unavailable');
  assert.equal(await validAction.isEnabled(), true, 'valid persona CTA must be enabled');
  assert.equal(await disabledAction.isDisabled(), true, 'missing-hash persona CTA must be disabled');
  assert.match(await validAction.innerText(), /成为我的伙伴/u);
  assert.match(await disabledAction.innerText(), /不可用/u);

  await captureScreenshot(page, desktopScreenshotPath);
  const desktopLayout = await inspectLayout(page);
  assert.equal(desktopLayout.hasHorizontalOverflow, false, `desktop layout overflow: ${JSON.stringify(desktopLayout)}`);

  await setElectronWindowSize(electronApp, 390, 860);
  await captureScreenshot(page, narrowScreenshotPath);
  const narrowLayout = await inspectLayout(page);
  assert.equal(narrowLayout.hasHorizontalOverflow, false, `narrow layout overflow: ${JSON.stringify(narrowLayout)}`);

  await setElectronWindowSize(electronApp, 1440, 940);
  await validAction.click();
  await page.getByTestId('chat-page').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByTestId('message-timeline').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  await captureScreenshot(page, chatScreenshotPath);
  observations.agentChatInitialAIConfigStorage = await readAIConfigStorageSnapshot(page);

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
  observations.agentModeUnavailableVisible = await page.getByText(/Agent mode is temporarily unavailable/i).count();
  assert.equal(observations.agentModeUnavailableVisible, 0, 'Agent model settings must not fall back to unavailable mode.');
  const chatModelSection = page.locator('[data-nimi-model-config-section="chat"]').first();
  if (await chatModelSection.count()) {
    await chatModelSection.click();
    await page.waitForTimeout(1000);
    await captureScreenshot(page, agentModelChatDetailScreenshotPath);
    observations.agentModelChatDetailVisible = await page.locator('[data-nimi-model-config-detail-section="chat"]').count();
    observations.agentModeUnavailableAfterChatDetailVisible = await page.getByText(/Agent mode is temporarily unavailable/i).count();
    assert.equal(observations.agentModeUnavailableAfterChatDetailVisible, 0, 'Agent chat model detail must not fall back to unavailable mode.');
    const textGenerateCard = page.locator('[data-nimi-model-config-capability="text.generate"]').first();
    observations.agentTextGenerateCardVisible = await textGenerateCard.count();
    if (await textGenerateCard.count()) {
      await textGenerateCard.locator('button').first().click();
      await page.waitForTimeout(2500);
      await captureScreenshot(page, agentModelPickerScreenshotPath);
      const modelPickerDialog = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Select Model' }).first();
      await modelPickerDialog.waitFor({ state: 'visible', timeout: 30_000 });
      observations.agentModelPickerDialogVisible = await modelPickerDialog.count();
      observations.agentModelPickerNoModelsVisible = await page.getByText(/No models available|No local models available/i).count();
      observations.agentModeUnavailableAfterPickerVisible = await page.getByText(/Agent mode is temporarily unavailable/i).count();
      assert.equal(observations.agentModeUnavailableAfterPickerVisible, 0, 'Agent model picker must not fall back to unavailable mode.');
      assert.equal(observations.agentModelPickerDialogVisible, 1, 'Agent text.generate model picker must open.');
      assert.equal(observations.agentModelPickerNoModelsVisible, 0, 'Agent text.generate picker must expose real Runtime route options.');

      const firstLocalModelButton = modelPickerDialog.locator('button').filter({ hasText: /local\./i }).first();
      await firstLocalModelButton.waitFor({ state: 'visible', timeout: 30_000 });
      observations.agentModelSelectedButtonText = normalizeWhitespace(await firstLocalModelButton.innerText());
      await firstLocalModelButton.click();
      await modelPickerDialog.waitFor({ state: 'detached', timeout: 30_000 }).catch(async () => {
        await modelPickerDialog.waitFor({ state: 'hidden', timeout: 30_000 });
      });
      observations.agentModelSelectedAIConfigTargetRef = await waitForTextGenerateTargetRef(page);
      observations.agentModelSelectedAIConfigStorage = await readAIConfigStorageSnapshot(page);
      await page.waitForTimeout(500);
      await captureScreenshot(page, agentModelSelectedScreenshotPath);
      observations.agentModelSelectedRouteUnavailableVisible = await page.getByText(/Route unhealthy|Route needs setup|路由不健康|路由需要配置|未通过最近一次健康检查|尚未就绪|latest health check|not ready/i).count();
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
    observations.agentChatSendRouteErrorVisible = await page.getByText(/A local or cloud runtime route is required before sending a message|local or cloud runtime route|本地.*云端.*runtime.*路由/i).count();
    assert.equal(observations.agentChatSendRouteErrorVisible, 0, 'Agent Chat must not report missing route after selecting a model.');
  }

  const discovered = await agentClient.discoverBySource({
    ownerUserId: OWNER_USER_ID,
    sourceRef: VALID_SOURCE_REF,
  });
  assert.equal(discovered.length, 1, `expected one Runtime-owned local agent, got ${discovered.length}`);
  const localAgentRef = discovered[0].localAgentRef;
  assert.match(localAgentRef, /^local-agent:runtime-/u, `localAgentRef is not Runtime-owned opaque ref: ${localAgentRef}`);
  assert.ok(!localAgentRef.includes(VALID_PERSONA_ID), `localAgentRef leaks app source id: ${localAgentRef}`);
  observations.localAgentRef = localAgentRef;
  observations.runtimeSourceRef = discovered[0].runtimeSourceRef;

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
    screenshots: [desktopScreenshotPath, narrowScreenshotPath, chatScreenshotPath],
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
