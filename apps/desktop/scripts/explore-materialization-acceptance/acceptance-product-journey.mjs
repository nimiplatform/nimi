import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Runtime } from '@nimiplatform/sdk/runtime';
import { APP_ID, VALID_PERSONA_SOURCE_REF } from './acceptance-constants.mjs';
import {
  delay,
  fetchJson,
  writeJsonFile,
  terminateDaemon,
} from './acceptance-files.mjs';
import {
  captureScreenshot,
  inspectAccessibility,
  inspectLayout,
  normalizeWhitespace,
  openExploreWorlds,
  readAIConfigStorageSnapshot,
  setElectronWindowSize,
} from './acceptance-page.mjs';
import { createAcceptanceAgentClient, startRuntimeDaemon } from './acceptance-runtime.mjs';
import { applyDeterministicMediaRoutes } from './acceptance-media-routes.mjs';

export function createProductJourneySettings({ appRoot }) {
  const artifactsDir = process.env.NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_ARTIFACTS_ROOT
    ? path.resolve(process.env.NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_ARTIFACTS_ROOT)
    : path.join(appRoot, 'reports', 'e2e', 'explore-materialization-acceptance');
  const optionalPath = (name) => process.env[name] ? path.resolve(process.env[name]) : null;
  const productJourneyId = process.env.NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID?.trim() || '';
  return {
    artifactsDir,
    crossAppHandoffPath: optionalPath('NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH'),
    crossAppReleasePath: optionalPath('NIMI_LOCAL_AGENT_PRODUCT_RELEASE_PATH'),
    crossAppProviderRawPath: optionalPath('NIMI_LOCAL_AGENT_PRODUCT_PROVIDER_RAW_PATH'),
    crossAppControlRoot: optionalPath('NIMI_LOCAL_AGENT_PRODUCT_CONTROL_ROOT'),
    productJourneyId,
    fullChainCore: productJourneyId === 'full-chain-core',
    preMaterializationOffline: productJourneyId === 'pre-materialization-offline',
    disabledActionOnly: process.env.NIMI_LOCAL_AGENT_PRODUCT_DISABLED_ACTION_ONLY === '1',
    productSourceKind: process.env.NIMI_LOCAL_AGENT_PRODUCT_SOURCE_KIND?.trim() === 'realmPersona'
      ? 'realmPersona'
      : 'worldCharacter',
    realRealmBaseUrl: process.env.NIMI_LOCAL_AGENT_PRODUCT_REALM_BASE_URL?.trim() || '',
    standardDataRoot: optionalPath('NIMI_LOCAL_AGENT_PRODUCT_STANDARD_DATA_ROOT')
      || path.join(artifactsDir, 'electron-standard-data'),
    desktopChromiumUserDataRoot: optionalPath('NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT')
      || path.join(artifactsDir, 'chromium-user-data'),
    productTrialRuntimeDataRoot: optionalPath('NIMI_LOCAL_AGENT_PRODUCT_RUNTIME_DATA_ROOT'),
  };
}

export function createProviderCheckpointController(fixtureOrigin) {
  async function queue(checkpointId, apml, extra = {}) {
    const response = await fetch(`${fixtureOrigin}/__fixture/control/provider-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkpointId, apml, ...extra }),
    });
    if (!response.ok) throw new Error(`provider plan ${checkpointId} failed with ${response.status}`);
  }

  async function count(checkpointId) {
    const manifest = await fetchJson(`${fixtureOrigin}/__fixture/control/manifest`);
    return (manifest.realmFixture?.providerRequests || []).filter((request) => request.checkpointId === checkpointId).length;
  }

  async function wait(checkpointId, expectedCount = 1) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await count(checkpointId) >= expectedCount) return;
      await delay(200);
    }
    throw new Error(`provider checkpoint ${checkpointId} did not receive ${expectedCount} request(s)`);
  }

  async function waitForFile(file, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(file)) return;
      await delay(200);
    }
    throw new Error(`timed out waiting for control file ${path.basename(file)}`);
  }

  return { queue, count, wait, waitForFile };
}

export async function materializePrimaryPersona(input) {
  const {
    page, electronApp, activeSourceRef, agentClient, observations, journeyAgents,
    desktopScreenshotPath, narrowScreenshotPath, materializationFailureScreenshotPath,
    waitForDiscoveredLocalAgent, runtimeAgentIdentity,
  } = input;
  await page.getByTestId('explore-section-tab-personas').click();
  await page.getByTestId('explore-personas-section').waitFor({ state: 'visible', timeout: 30_000 });
  const personaCard = page.getByTestId(`explore-persona-source-card:${activeSourceRef.sourceId}`);
  try {
    await personaCard.waitFor({ state: 'visible', timeout: 20_000 });
  } catch (error) {
    observations.personaDiscoveryFailure = {
      emptyStateCount: await page.getByTestId('explore-personas-empty').count(),
      bodyText: normalizeWhitespace(await page.locator('body').innerText()).slice(0, 3000),
    };
    throw error;
  }
  observations.sourceDetailSurface = 'realm-persona';
  await captureScreenshot(page, desktopScreenshotPath);
  observations.desktopLayout = await inspectLayout(page);
  assert.equal(observations.desktopLayout.hasHorizontalOverflow, false, `desktop layout overflow: ${JSON.stringify(observations.desktopLayout)}`);
  observations.desktopAccessibility = await inspectAccessibility(page);
  assert.equal(observations.desktopAccessibility.unnamedInteractiveControls.length, 0, 'persona desktop controls require accessible names');
  await setElectronWindowSize(electronApp, 390, 860);
  await captureScreenshot(page, narrowScreenshotPath);
  observations.narrowLayout = await inspectLayout(page);
  assert.equal(observations.narrowLayout.hasHorizontalOverflow, false, `narrow layout overflow: ${JSON.stringify(observations.narrowLayout)}`);
  observations.narrowAccessibility = await inspectAccessibility(page);
  assert.equal(observations.narrowAccessibility.unnamedInteractiveControls.length, 0, 'persona narrow controls require accessible names');
  await setElectronWindowSize(electronApp, 1440, 940);
  const personaAction = page.getByTestId(`explore-persona-source-primary-action:${activeSourceRef.sourceId}`);
  await personaAction.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await personaAction.isEnabled(), true, 'RealmPersona materialization action must be enabled');
  await personaAction.click();
  const discovered = await waitForDiscoveredLocalAgent(agentClient);
  if (discovered.length !== 1) {
    observations.personaMaterializationFailure = { bodyText: normalizeWhitespace(await page.locator('body').innerText()).slice(0, 3000) };
    await captureScreenshot(page, materializationFailureScreenshotPath);
  }
  assert.equal(discovered.length, 1, `expected one Runtime-owned RealmPersona local agent, got ${discovered.length}`);
  const agent = discovered[0];
  observations.localAgentRef = agent.localAgentRef;
  observations.runtimeSourceRef = agent.runtimeSourceRef;
  observations.materializedSourceSnapshotHash = agent.snapshotHash;
  observations.materializedSourceContextState = agent.sourceContextStatus?.state || null;
  assert.equal(agent.sourceContextStatus?.ready, true, 'RealmPersona Runtime source snapshot must be ready');
  assert.match(agent.snapshotHash || '', /^[a-f0-9]{64}$/u, 'RealmPersona Runtime source snapshot hash must be bounded');
  journeyAgents.push({
    sourceKind: 'realmPersona', sourceRef: activeSourceRef, localAgentRef: agent.localAgentRef,
    runtimeSourceRef: agent.runtimeSourceRef, snapshotHash: agent.snapshotHash || null, displayName: 'Solace',
  });
  return { localAgentRef: agent.localAgentRef, agentIdentity: runtimeAgentIdentity(agent.localAgentRef, agent.runtimeSourceRef) };
}

export async function completeDisabledActionAcceptance(input) {
  const {
    page, electronApp, observations, desktopScreenshotPath, narrowScreenshotPath, resultPath,
    runtimeEndpoint, fixtureOrigin, consoleErrors, consoleErrorDetails, pageErrors,
  } = input;
  await captureScreenshot(page, desktopScreenshotPath);
  observations.desktopLayout = await inspectLayout(page);
  assert.equal(observations.desktopLayout.hasHorizontalOverflow, false, `desktop layout overflow: ${JSON.stringify(observations.desktopLayout)}`);
  observations.desktopAccessibility = await inspectAccessibility(page);
  assert.equal(observations.desktopAccessibility.unnamedInteractiveControls.length, 0, 'desktop disabled-action controls require accessible names');
  await setElectronWindowSize(electronApp, 390, 860);
  await captureScreenshot(page, narrowScreenshotPath);
  observations.narrowLayout = await inspectLayout(page);
  assert.equal(observations.narrowLayout.hasHorizontalOverflow, false, `narrow layout overflow: ${JSON.stringify(observations.narrowLayout)}`);
  observations.narrowAccessibility = await inspectAccessibility(page);
  assert.equal(observations.narrowAccessibility.unnamedInteractiveControls.length, 0, 'narrow disabled-action controls require accessible names');
  if (consoleErrors.length || pageErrors.length) throw new Error(`renderer console/page errors observed: ${JSON.stringify({ consoleErrors, pageErrors }, null, 2)}`);
  writeJsonFile(resultPath, {
    ok: true,
    mode: 'disabled-action-only',
    runtimeEndpoint,
    fixtureOrigin,
    observations,
    screenshots: { desktopExplore: desktopScreenshotPath, narrowExplore: narrowScreenshotPath },
    sharedAuth: { disabled: { observed: observations.worldPreviewDisabledActions > 0, visibleDisabledControls: observations.worldPreviewDisabledActions } },
    consoleErrors,
    consoleErrorDetails,
    pageErrors,
  });
  console.log(JSON.stringify({ ok: true, mode: 'disabled-action-only', resultPath, screenshots: [desktopScreenshotPath, narrowScreenshotPath] }, null, 2));
}

export async function runPreMaterializationOfflineJourney(input) {
  let { runtimeContext, runtimeDaemon } = input;
  const {
    page, becomePartnerAction, agentClient: initialAgentClient, productOwnerUserId, fixtureOrigin,
    observations, consoleErrors, consoleErrorDetails, pageErrors, resultPath, productJourneyId,
    paths, restart,
  } = input;
  const initialAgents = await initialAgentClient.listLocalAgents({ ownerUserId: productOwnerUserId });
  assert.equal(initialAgents.length, 0, 'pre-materialization offline Journey must begin without LocalAgents');
  const setRealmRestOnline = async (online) => {
    const response = await fetch(`${fixtureOrigin}/__fixture/control/rest-online`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ online }),
    });
    assert.equal(response.ok, true, `Realm fixture availability control failed with ${response.status}`);
  };
  const waitForFailureFeedback = async (checkpointId) => {
    const feedback = page.locator('[data-feedback-kind="error"]').first();
    await feedback.waitFor({ state: 'visible', timeout: 60_000 });
    const text = normalizeWhitespace(await feedback.innerText());
    assert.ok(text.length > 0, `${checkpointId} must expose a visible recoverable product error`);
    return { feedback, text };
  };

  await setRealmRestOnline(false);
  await becomePartnerAction.click();
  const realmFailure = await waitForFailureFeedback('realm-offline-before-materialize');
  await captureScreenshot(page, paths.realmScreenshot);
  writeJsonFile(paths.realmEvidence, await checkpointEvidence(page, 'realm-offline-before-materialize', paths.realmScreenshot, realmFailure.text, consoleErrors, pageErrors));
  assert.equal((await initialAgentClient.listLocalAgents({ ownerUserId: productOwnerUserId })).length, 0, 'Realm-offline materialization must not create a LocalAgent');
  await setRealmRestOnline(true);
  await realmFailure.feedback.locator('button').last().click();
  await realmFailure.feedback.waitFor({ state: 'hidden', timeout: 10_000 });

  const restartGrpcPort = runtimeContext.grpcPort;
  const restartHttpPort = runtimeContext.httpPort;
  await terminateDaemon(runtimeDaemon);
  await becomePartnerAction.click();
  const runtimeFailure = await waitForFailureFeedback('runtime-offline-before-materialize');
  await captureScreenshot(page, paths.runtimeScreenshot);
  writeJsonFile(paths.runtimeEvidence, await checkpointEvidence(page, 'runtime-offline-before-materialize', paths.runtimeScreenshot, runtimeFailure.text, consoleErrors, pageErrors));

  runtimeContext = await startRuntimeDaemon({ ...restart, grpcPort: restartGrpcPort, httpPort: restartHttpPort, appendLogs: true });
  runtimeDaemon = runtimeContext.daemon;
  observations.processStarts.runtime += 1;
  const runtime = new Runtime({ appId: APP_ID, transport: { type: 'node-grpc', endpoint: runtimeContext.endpoint } });
  const agentClient = createAcceptanceAgentClient(runtime, productOwnerUserId);
  const recoveredAgents = await agentClient.listLocalAgents({ ownerUserId: productOwnerUserId });
  assert.equal(recoveredAgents.length, 0, 'Runtime-offline materialization must leave no recovered LocalAgent');
  observations.preMaterializationOffline = {
    initialAgentCount: initialAgents.length,
    recoveredAgentCount: recoveredAgents.length,
    checkpoints: {
      'realm-offline-before-materialize': { passed: true, feedback: realmFailure.text, screenshot: paths.realmScreenshot },
      'runtime-offline-before-materialize': { passed: true, feedback: runtimeFailure.text, screenshot: paths.runtimeScreenshot },
    },
  };
  if (consoleErrors.length || pageErrors.length) throw new Error(`pre-materialization offline renderer problems: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  writeJsonFile(resultPath, {
    schemaVersion: 'nimi.local-agent-product-desktop-offline-summary/v2',
    ok: true,
    mode: 'pre-materialization-offline',
    journeyId: productJourneyId,
    processStarts: observations.processStarts,
    checkpoints: {
      'realm-offline-before-materialize': { passed: true, evidencePath: path.basename(paths.realmEvidence), screenshot: path.basename(paths.realmScreenshot) },
      'runtime-offline-before-materialize': { passed: true, evidencePath: path.basename(paths.runtimeEvidence), screenshot: path.basename(paths.runtimeScreenshot) },
    },
    observations,
    screenshots: { realmOfflineBeforeMaterialize: paths.realmScreenshot, runtimeOfflineBeforeMaterialize: paths.runtimeScreenshot },
    consoleErrors,
    consoleErrorDetails,
    pageErrors,
    pageProblems: [...consoleErrors, ...pageErrors],
    outcome: 'passed',
  });
  console.log(JSON.stringify({ ok: true, mode: 'pre-materialization-offline', resultPath }, null, 2));
  return { runtimeContext, runtimeDaemon, runtime, agentClient };
}

async function checkpointEvidence(page, checkpointId, screenshot, feedback, consoleErrors, pageErrors) {
  return {
    schemaVersion: 'nimi.local-agent-product-checkpoint-evidence/v2',
    checkpointId,
    screenshot: path.basename(screenshot),
    pageProblems: [...consoleErrors, ...pageErrors],
    dom: {
      url: page.url(),
      title: await page.title(),
      bodyText: normalizeWhitespace(await page.locator('body').innerText()).slice(0, 4_000),
    },
    details: { feedback, localAgentCount: 0 },
  };
}

export async function runDesktopAgentChatJourney(input) {
  const {
    page, localAgentRef, productSourceKind, realRealmSession, chatScreenshotPath,
    observations, agentClient, agentIdentity, readRuntimeAgentAIConfig,
    waitForRuntimeTextGenerateTargetRef, paths, fullChainCore, mediaRoutes,
    artifactsDir, queueProviderPlan, waitForProviderCheckpoint, providerCheckpointCount,
  } = input;
  const agentRailTarget = page.getByTestId(`chat-target:${localAgentRef}`);
  await agentRailTarget.waitFor({ state: 'visible', timeout: 30_000 });
  observations.agentChatLocalAgentRailTargetVisible = await agentRailTarget.isVisible();
  assert.equal(observations.agentChatLocalAgentRailTargetVisible, true, 'Agent Chat rail must list Runtime ListAgents localAgent targets.');
  observations.agentChatLocalAgentRailAvatarImages = await agentRailTarget.locator('img').count();
  if (productSourceKind === 'worldCharacter' && !realRealmSession) {
    await agentRailTarget.locator('img[src*="yan-zhenqing-avatar"]').waitFor({ state: 'visible', timeout: 30_000 });
    assert.ok(observations.agentChatLocalAgentRailAvatarImages > 0, 'Agent Chat rail must render the source-backed avatar image.');
  }
  await captureScreenshot(page, chatScreenshotPath);
  observations.chatAccessibility = await inspectAccessibility(page);
  assert.equal(observations.chatAccessibility.unnamedInteractiveControls.length, 0,
    `chat interactive controls require accessible names: ${JSON.stringify(observations.chatAccessibility)}`);
  observations.agentChatInitialAIConfigStorage = await readAIConfigStorageSnapshot(page);
  observations.agentChatInitialRuntimeAIConfig = await readRuntimeAgentAIConfig(agentClient, agentIdentity);

  const sharedAuthSessionCommands = await inspectDesktopAuthBoundary(page, observations);
  const composerTextarea = page.locator('[data-chat-composer-textarea="true"]').first();
  await composerTextarea.waitFor({ state: 'visible', timeout: 30_000 });
  observations.agentComposerInitiallyDisabled = await composerTextarea.isDisabled();
  observations.agentComposerInitialRouteHintVisible = await page.getByText(/发送消息前请先选择|Choose a local or cloud runtime route|local or cloud runtime route|本地.*云端.*runtime.*路由/i).count();

  const settingsToggle = page.getByTestId('chat-settings-toggle');
  await settingsToggle.waitFor({ state: 'visible', timeout: 30_000 });
  await settingsToggle.click();
  const sourceContextStatus = page.locator('[data-agent-center-source-context-status]').first();
  await sourceContextStatus.waitFor({ state: 'visible', timeout: 30_000 });
  observations.agentCenterInitialSourceContextStatus = await sourceContextStatus.getAttribute('data-agent-center-source-context-status');
  await page.getByTestId('chat-agent-center-section:advanced').click();
  await page.getByText(observations.materializedSourceSnapshotHash, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  observations.agentCenterSourceSnapshotVisible = true;
  assert.equal(observations.agentCenterInitialSourceContextStatus, 'unknown', 'Desktop Agent Center must keep pre-turn aggregate context unprojected');
  await page.getByTestId('chat-agent-center-section:model').click();
  await page.waitForTimeout(2500);
  await captureScreenshot(page, paths.modelSettings);
  observations.agentModelSettingsAIConfigStorage = await readAIConfigStorageSnapshot(page);
  observations.agentModelSettingsRuntimeAIConfig = await readRuntimeAgentAIConfig(agentClient, agentIdentity);
  const modelHub = page.locator('[data-agent-center-model-surface="runtime-model-config-hub"]').first();
  observations.agentModelSettingsEnglishCopyVisible = await modelHub.getByText(/Runtime ready|Needs setup|Import AI Profile|No profile applied|AI Profile/i).count();
  observations.agentModelSettingsEnglishStatusTransitionCopyVisible = await modelHub
    .getByText(/Saving Runtime Agent AI Config|Saved Runtime Agent AI Config|Runtime Agent AI Config adapter unavailable|Runtime Agent AI Config revision unavailable|Runtime Agent AI Config update failed/i).count();
  observations.agentModeUnavailableVisible = await page.getByText(/Agent mode is temporarily unavailable/i).count();
  assert.equal(observations.agentModelSettingsEnglishCopyVisible, 0, 'Agent model settings must not leak English model/profile status copy in zh shell.');
  assert.equal(observations.agentModelSettingsEnglishStatusTransitionCopyVisible, 0, 'Agent model settings must not leak English Runtime AIConfig transition status copy in zh shell.');
  assert.equal(observations.agentModeUnavailableVisible, 0, 'Agent model settings must not fall back to unavailable mode.');
  await selectDesktopAgentTextModel({ page, observations, agentClient, agentIdentity, waitForRuntimeTextGenerateTargetRef, paths });

  let sharedAgentIntents = null;
  if (fullChainCore) {
    const configured = await applyDeterministicMediaRoutes({ agentClient, identity: agentIdentity, routes: mediaRoutes });
    sharedAgentIntents = configured.intents;
    observations.coreMediaRouteStates = Object.fromEntries(
      ['text.generate', 'text.embed', 'image.generate', 'audio.synthesize', 'audio.transcribe']
        .map((capability) => [capability, configured.readiness?.capabilities?.[capability]?.state || configured.intents?.[capability]?.route || null]),
    );
  }

  await settingsToggle.click();
  const sendButton = page.locator('[data-chat-composer-send="true"]').first();
  if (observations.agentModelSelectedRouteUnavailableVisible > 0) {
    observations.agentComposerTextareaDisabledAfterRouteSelection = await composerTextarea.isDisabled();
    observations.agentComposerSendDisabledAfterRouteSelection = await sendButton.isDisabled();
    observations.agentComposerRouteDisabledHintVisible = await page.getByText(/当前选择的 runtime 路由|selected runtime route|健康检查|health check|尚未就绪|not ready/i).count();
    await captureScreenshot(page, paths.chatSendAttempt);
    observations.agentChatAfterSendAIConfigStorage = await readAIConfigStorageSnapshot(page);
    observations.agentChatAfterSendRuntimeAIConfig = await readRuntimeAgentAIConfig(agentClient, agentIdentity);
    observations.agentChatSendSkippedReason = 'runtime_route_unavailable';
    assert.equal(observations.agentComposerTextareaDisabledAfterRouteSelection, true, 'Agent composer textarea must be disabled when Runtime reports the selected route is unavailable.');
    assert.equal(observations.agentComposerSendDisabledAfterRouteSelection, true, 'Agent composer send must be disabled when Runtime reports the selected route is unavailable.');
    assert.ok(observations.agentComposerRouteDisabledHintVisible > 0, 'Agent composer must show a readable route-unavailable hint when Runtime reports the selected route is unavailable.');
  } else {
    const longChineseMessage = '共享账户授权由运行时统一托管；这个长文本用于验证桌面与窄屏布局、中文可读性以及输入框在真实 Desktop Electron 外壳中的可用性。';
    if (fullChainCore) {
      await runDesktopCoreTurns({ page, composerTextarea, sendButton, observations, artifactsDir, queueProviderPlan, waitForProviderCheckpoint, providerCheckpointCount });
    } else {
      await composerTextarea.fill(longChineseMessage);
      observations.agentComposerLongChineseText = await composerTextarea.inputValue();
      await sendButton.click();
      await page.waitForTimeout(2500);
    }
    await captureScreenshot(page, paths.chatSendAttempt);
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

  if (fullChainCore) {
    await settingsToggle.click();
    await page.getByTestId('chat-agent-center-section:overview').click();
    await page.waitForFunction(() => globalThis.document.querySelector('[data-agent-center-source-context-status]')
      ?.getAttribute('data-agent-center-source-context-status') === 'ready', null, { timeout: 30_000 });
    const readyStatus = page.locator('[data-agent-center-source-context-status]').first();
    observations.agentCenterSourceContextStatus = await readyStatus.getAttribute('data-agent-center-source-context-status');
    observations.agentCenterSourceContextText = normalizeWhitespace(await readyStatus.innerText()).slice(0, 500);
    assert.equal(observations.agentCenterSourceContextStatus, 'ready', 'Desktop Agent Center must project bounded source/context ready after real turns');
    await settingsToggle.click();
  }
  return { sharedAuthSessionCommands, sharedAgentIntents };
}

async function inspectDesktopAuthBoundary(page, observations) {
  const sharedAuthSessionCommands = await page.evaluate(async (commands) => {
    const bridge = globalThis.window?.__NIMI_ELECTRON_RUNTIME__;
    if (!bridge || typeof bridge.invoke !== 'function') throw new Error('Desktop Electron Runtime bridge is unavailable');
    return Promise.all(commands.map(async (command) => {
      try { await bridge.invoke(command, {}); return { command, denied: false }; } catch (error) {
        const record = error && typeof error === 'object' ? error : {};
        return { command, denied: true, code: String(record.code || ''), reasonCode: String(record.reasonCode || ''), message: error instanceof Error ? error.message : String(record.message || error || '') };
      }
    }));
  }, ['nimi.shell.auth.session.load', 'nimi.shell.auth.session.save', 'nimi.shell.auth.session.clear']);
  assert.equal(sharedAuthSessionCommands.every((row) => row.denied), true,
    `Desktop Electron auth.session commands must be denied: ${JSON.stringify(sharedAuthSessionCommands)}`);
  observations.sharedAuthSessionCommands = sharedAuthSessionCommands;
  const projection = await page.evaluate(() => {
    const storage = (source) => Object.fromEntries(Array.from({ length: source.length }, (_, index) => source.key(index)).filter(Boolean).map((key) => [key, source.getItem(key)]));
    const windowStrings = Object.fromEntries(Object.getOwnPropertyNames(globalThis).flatMap((key) => {
      try { const value = globalThis[key]; return typeof value === 'string' && value.length < 4096 ? [[key, value]] : []; } catch { return []; }
    }));
    return { html: globalThis.document.documentElement.outerHTML, bodyText: globalThis.document.body?.innerText || '', localStorage: storage(globalThis.localStorage), sessionStorage: storage(globalThis.sessionStorage), windowStrings };
  });
  const raw = JSON.stringify(projection);
  const findings = [];
  if (raw.includes('desktop-acceptance-access-token')) findings.push('Runtime fixture access token projected into Desktop renderer');
  if (raw.includes('e2e-runtime-refresh-')) findings.push('Runtime fixture refresh token projected into Desktop renderer');
  if (/Bearer\s+[A-Za-z0-9._~-]{12,}/u.test(raw)) findings.push('Bearer-shaped credential in Desktop renderer projection');
  if (/refresh[_-]?token["'=:\s]+[A-Za-z0-9._~-]{8,}/iu.test(raw)) findings.push('refresh-token-shaped credential in Desktop renderer projection');
  assert.deepEqual(findings, [], `Desktop renderer credential leak: ${JSON.stringify(findings)}`);
  observations.tokenLeak = { passed: true, findings, inspected: ['DOM', 'localStorage', 'sessionStorage', 'window string globals'] };
  return sharedAuthSessionCommands;
}

async function selectDesktopAgentTextModel({ page, observations, agentClient, agentIdentity, waitForRuntimeTextGenerateTargetRef, paths }) {
  const chatModelSection = page.locator('[data-nimi-model-config-section="chat"]').first();
  if (await chatModelSection.count()) {
    await chatModelSection.click();
    await page.waitForTimeout(1000);
    await captureScreenshot(page, paths.modelChatDetail);
    const detail = page.locator('[data-nimi-model-config-detail-section="chat"]').first();
    observations.agentModelChatDetailVisible = await detail.count();
    observations.agentModelChatDetailEnglishConfigurationVisible = await detail.getByText(/Configuration/i).count();
    observations.agentModelChatDetailEnglishStatusVisible = await detail.getByText(/Runtime ready|Needs setup|Setup required|Model selection required|Not configured|Click to change model/i).count();
    observations.agentModeUnavailableAfterChatDetailVisible = await page.getByText(/Agent mode is temporarily unavailable/i).count();
    assert.equal(observations.agentModelChatDetailEnglishConfigurationVisible, 0, 'Agent chat model detail must not leak English Configuration copy in zh shell.');
    assert.equal(observations.agentModelChatDetailEnglishStatusVisible, 0, 'Agent chat model detail must not leak English status copy in zh shell.');
    assert.equal(observations.agentModeUnavailableAfterChatDetailVisible, 0, 'Agent chat model detail must not fall back to unavailable mode.');
    const textGenerateCard = page.locator('[data-nimi-model-config-capability="text.generate"]').first();
    observations.agentTextGenerateCardVisible = await textGenerateCard.count();
    if (await textGenerateCard.count()) {
      await textGenerateCard.locator('button').first().click();
      await page.waitForTimeout(2500);
      await captureScreenshot(page, paths.modelPicker);
      const dialog = page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: /选择模型|Select Model/u }).first();
      await dialog.waitFor({ state: 'visible', timeout: 30_000 });
      observations.agentModelPickerDialogVisible = await dialog.count();
      observations.agentModelPickerLocalizedTitleVisible = await dialog.getByText('选择模型').count();
      observations.agentModelPickerLocalizedLocalTabVisible = await dialog.getByText('本地').count();
      observations.agentModelPickerLocalizedCloudTabVisible = await dialog.getByText('云端').count();
      observations.agentModelPickerLocalizedSearchVisible = await dialog.getByPlaceholder('搜索模型').count();
      observations.agentModelPickerEnglishCopyVisible = await dialog.getByText(/Select Model|Search models|Text Generation/i).count();
      observations.agentModelPickerNoModelsVisible = await page.getByText(/没有可用模型|当前能力没有可用的本地模型|No models available|No local models available/i).count();
      observations.agentModeUnavailableAfterPickerVisible = await page.getByText(/Agent mode is temporarily unavailable/i).count();
      assert.equal(observations.agentModeUnavailableAfterPickerVisible, 0, 'Agent model picker must not fall back to unavailable mode.');
      assert.equal(observations.agentModelPickerDialogVisible, 1, 'Agent text.generate model picker must open.');
      assert.ok(observations.agentModelPickerLocalizedTitleVisible > 0 && observations.agentModelPickerLocalizedLocalTabVisible > 0
        && observations.agentModelPickerLocalizedCloudTabVisible > 0 && observations.agentModelPickerLocalizedSearchVisible > 0,
      'Agent model picker must render localized Chinese controls.');
      assert.equal(observations.agentModelPickerEnglishCopyVisible, 0, 'Agent model picker must not leak English default copy in zh shell.');
      assert.equal(observations.agentModelPickerNoModelsVisible, 0, 'Agent text.generate picker must expose real Runtime route options.');
      const firstModel = dialog.locator('button').filter({ hasText: /runtime-agent-live-e2e|local\./i }).first();
      await firstModel.waitFor({ state: 'visible', timeout: 30_000 });
      observations.agentModelSelectedButtonText = normalizeWhitespace(await firstModel.innerText());
      await firstModel.click();
      await dialog.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => dialog.waitFor({ state: 'hidden', timeout: 30_000 }));
      const selected = await waitForRuntimeTextGenerateTargetRef(agentClient, agentIdentity);
      observations.agentModelSelectedAIConfigTargetRef = selected.targetRef;
      observations.agentModelSelectedRuntimeAIConfig = selected.snapshot;
      observations.agentModelSelectedAIConfigStorage = await readAIConfigStorageSnapshot(page);
      await page.waitForTimeout(500);
      await captureScreenshot(page, paths.modelSelected);
      observations.agentModelSelectedRouteUnavailableVisible = await page.getByText(/Route unhealthy|Route needs setup|路由不健康|路由需要配置|未通过最近一次健康检查|尚未就绪|latest health check|not ready/i).count();
      observations.agentModelSelectedEnglishStatusTransitionCopyVisible = await page.getByText(/Saving Runtime Agent AI Config|Saved Runtime Agent AI Config|Runtime Agent AI Config adapter unavailable|Runtime Agent AI Config revision unavailable|Runtime Agent AI Config update failed/i).count();
      assert.equal(observations.agentModelSelectedEnglishStatusTransitionCopyVisible, 0, 'Agent model selection must not leak English Runtime AIConfig transition status copy in zh shell.');
    }
  }
  assert.ok(observations.agentModelChatDetailVisible, 'Agent chat model detail must be visible.');
  assert.ok(observations.agentTextGenerateCardVisible, 'Agent chat model detail must expose text.generate.');
  assert.ok(observations.agentModelSelectedAIConfigTargetRef, 'Selecting a model must write a text.generate targetRef.');
}

export async function runDesktopCoreTurns(input) {
  const {
    page, composerTextarea, sendButton, observations, artifactsDir,
    queueProviderPlan, waitForProviderCheckpoint, providerCheckpointCount,
  } = input;
  const longChineseMessage = '共享账户授权由运行时统一托管；这个长文本用于验证桌面与窄屏布局、中文可读性以及输入框在真实 Desktop Electron 外壳中的可用性。';
  const turns = [
    { checkpointId: 'desktop-chat-turn-1', prompt: `${longChineseMessage} DESKTOP_CHARACTER_CANARY_A`, submit: 'click', assistantText: 'Desktop core turn 1 completed.' },
    { checkpointId: 'desktop-chat-turn-2', prompt: '请继续上一轮，并明确记住 DESKTOP_CHARACTER_CANARY_A。', submit: 'enter', assistantText: 'Desktop core turn 2 completed.' },
    { checkpointId: 'desktop-chat-turn-3', prompt: '第三轮先换行再发送，验证历史、键盘和当前伙伴仍然一致。', submit: 'shift-enter', assistantText: 'Desktop core turn 3 completed.' },
  ];
  observations.desktopCoreTurns = [];
  for (const [index, turn] of turns.entries()) {
    await queueProviderPlan(turn.checkpointId, `<message id="${turn.checkpointId}"><emotion>${index === 0 ? 'confused' : 'shy'}</emotion>${turn.assistantText}</message>`);
    await composerTextarea.fill('');
    await composerTextarea.focus();
    await page.keyboard.insertText(turn.prompt);
    assert.equal(await composerTextarea.inputValue(), turn.prompt, `${turn.checkpointId} keyboard input mismatch`);
    if (turn.submit === 'click') await sendButton.click();
    else if (turn.submit === 'enter') await composerTextarea.press('Enter');
    else {
      await composerTextarea.press('Shift+Enter');
      assert.match(await composerTextarea.inputValue(), /\n/u, 'Desktop Shift+Enter must insert a newline');
      await composerTextarea.press('Enter');
    }
    await waitForProviderCheckpoint(turn.checkpointId);
    const assistantTextMatches = page.getByText(turn.assistantText, { exact: true });
    try {
      await assistantTextMatches.filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 60_000 });
    } catch (error) {
      const matchCount = await assistantTextMatches.count().catch(() => 0);
      const matchVisibility = [];
      for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) matchVisibility.push(await assistantTextMatches.nth(matchIndex).isVisible().catch(() => false));
      observations.desktopCoreTurnFailure = {
        checkpointId: turn.checkpointId, assistantText: turn.assistantText, matchCount, matchVisibility,
        conversationPaneText: await page.locator('[data-canonical-conversation-pane="true"]').innerText().catch(() => ''),
      };
      await captureScreenshot(page, path.join(artifactsDir, `desktop-${turn.checkpointId}-failure.png`));
      throw error;
    }
    await page.waitForFunction(() => {
      const textarea = globalThis.document.querySelector('[data-chat-composer-textarea="true"]');
      const chat = globalThis.document.querySelector('[data-chat-agent-state]');
      return textarea?.disabled === false && (!chat || chat.getAttribute('data-chat-agent-state') === 'completed');
    }, null, { timeout: 60_000 });
    observations.desktopCoreTurns.push({
      checkpointId: turn.checkpointId, inputMode: turn.submit, assistantText: turn.assistantText,
      providerRequestCount: await providerCheckpointCount(turn.checkpointId),
    });
  }
  observations.agentComposerLongChineseText = longChineseMessage;
}

export async function materializeJourneyPersona(input) {
  const {
    page, realRealmSession, agentClient, mediaRoutes, sharedAgentIntents,
    journeyAgents, observations, personaMaterializedScreenshotPath,
    waitForDiscoveredLocalAgent, runtimeAgentIdentity,
  } = input;
  const personaSourceRef = realRealmSession?.sourceRefs.realmPersona || VALID_PERSONA_SOURCE_REF;
  await openExploreWorlds(page);
  await page.getByTestId('explore-section-tab-personas').click();
  await page.getByTestId('explore-personas-section').waitFor({ state: 'visible', timeout: 30_000 });
  const personaCard = page.getByTestId(`explore-persona-source-card:${personaSourceRef.sourceId}`);
  await personaCard.waitFor({ state: 'visible', timeout: 30_000 });
  const displayName = normalizeWhitespace(await personaCard.innerText()).split('\n').find(Boolean) || 'Realm Persona';
  const personaAction = page.getByTestId(`explore-persona-source-primary-action:${personaSourceRef.sourceId}`);
  await personaAction.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await personaAction.isEnabled(), true, 'core Journey Persona materialization action must be enabled');
  await personaAction.click();
  const discovered = await waitForDiscoveredLocalAgent(agentClient, personaSourceRef);
  assert.equal(discovered.length, 1, `core Journey expected one RealmPersona LocalAgent, got ${discovered.length}`);
  const persona = discovered[0];
  await applyDeterministicMediaRoutes({
    agentClient,
    identity: runtimeAgentIdentity(persona.localAgentRef, persona.runtimeSourceRef),
    routes: mediaRoutes,
    baseIntents: sharedAgentIntents,
  });
  const record = {
    sourceKind: 'realmPersona', sourceRef: personaSourceRef, localAgentRef: persona.localAgentRef,
    runtimeSourceRef: persona.runtimeSourceRef, snapshotHash: persona.snapshotHash || null, displayName,
  };
  journeyAgents.push(record);
  observations.personaMaterialization = record;
  await captureScreenshot(page, personaMaterializedScreenshotPath);
  return record;
}

export async function holdCrossAppJourney(input) {
  let { runtimeContext, runtimeDaemon } = input;
  const {
    crossAppHandoffPath, crossAppReleasePath, crossAppProviderRawPath, crossAppControlRoot,
    fullChainCore, productJourneyId, fixtureManifest, fixtureOrigin, realtimeFixtureOrigin,
    desktopFixtureOrigin, standardDataRoot, acceptedRuntimeDataRoot, productOwnerUserId,
    agentIdentity, localAgentRef, displayName, activeSourceRef, packetRequest,
    mediaRoutes, journeyAgents, observations, screenshots, materializePersona, waitForControlFile,
    consoleErrors, pageErrors, restart,
  } = input;
  if (!crossAppReleasePath) throw new Error('cross-app Desktop hold requires NIMI_LOCAL_AGENT_PRODUCT_RELEASE_PATH');
  if (fullChainCore && !crossAppControlRoot) throw new Error('full-chain-core requires NIMI_LOCAL_AGENT_PRODUCT_CONTROL_ROOT');
  if (crossAppProviderRawPath) writeJsonFile(crossAppProviderRawPath, fixtureManifest);
  const handoffPayload = () => ({
    schemaVersion: 'nimi.local-agent-product-desktop-handoff/v2',
    journeyId: productJourneyId || null,
    runtimeEndpoint: runtimeContext.endpoint,
    realmBaseUrl: desktopFixtureOrigin,
    providerFixtureBaseUrl: fixtureOrigin,
    realtimeBaseUrl: realtimeFixtureOrigin,
    standardDataRoot,
    runtimeDataRoot: acceptedRuntimeDataRoot,
    ownerUserId: productOwnerUserId,
    runtimeSourceRef: agentIdentity.runtimeSourceRef,
    localAgentRef,
    displayName,
    sourceKind: activeSourceRef.kind,
    sourceRef: activeSourceRef,
    packetRequest,
    providerRawPath: crossAppProviderRawPath,
    controlRoot: crossAppControlRoot,
    mediaRoutes,
    agents: journeyAgents,
    desktopCoreTurns: observations.desktopCoreTurns || [],
    processStarts: observations.processStarts,
    screenshots,
  });
  writeJsonFile(crossAppHandoffPath, handoffPayload());
  let runtime = input.runtime;
  let agentClient = input.agentClient;
  if (fullChainCore) {
    await waitForControlFile(path.join(crossAppControlRoot, 'persona-materialize-request.json'));
    const persona = await materializePersona();
    writeJsonFile(crossAppHandoffPath, handoffPayload());
    writeJsonFile(path.join(crossAppControlRoot, 'persona-materialize-complete.json'), { ok: true, persona, agentCount: journeyAgents.length });

    await waitForControlFile(path.join(crossAppControlRoot, 'runtime-restart-request.json'));
    await terminateDaemon(runtimeDaemon);
    runtimeContext = await startRuntimeDaemon({ ...restart, grpcPort: runtimeContext.grpcPort, httpPort: runtimeContext.httpPort, appendLogs: true });
    runtimeDaemon = runtimeContext.daemon;
    observations.processStarts.runtime += 1;
    runtime = new Runtime({ appId: APP_ID, transport: { type: 'node-grpc', endpoint: runtimeContext.endpoint } });
    agentClient = createAcceptanceAgentClient(runtime, productOwnerUserId);
    const recoveredAgents = await agentClient.listLocalAgents({ ownerUserId: productOwnerUserId });
    assert.equal(recoveredAgents.length, journeyAgents.length, 'Runtime restart must recover every materialized LocalAgent');
    writeJsonFile(crossAppHandoffPath, handoffPayload());
    writeJsonFile(path.join(crossAppControlRoot, 'runtime-restart-complete.json'), { ok: true, localAgentCount: recoveredAgents.length, runtimeEndpoint: runtimeContext.endpoint });

    await waitForControlFile(path.join(crossAppControlRoot, 'realm-offline-request.json'));
    const offlineResponse = await fetch(`${fixtureOrigin}/__fixture/control/rest-online`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ online: false }),
    });
    assert.equal(offlineResponse.ok, true, 'Realm fixture offline control must succeed');
    writeJsonFile(path.join(crossAppControlRoot, 'realm-offline-complete.json'), { ok: true, restOnline: false });

    await waitForControlFile(path.join(crossAppControlRoot, 'realm-online-request.json'));
    const onlineResponse = await fetch(`${fixtureOrigin}/__fixture/control/rest-online`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ online: true }),
    });
    assert.equal(onlineResponse.ok, true, 'Realm fixture recovery control must succeed');
    writeJsonFile(path.join(crossAppControlRoot, 'realm-online-complete.json'), { ok: true, restOnline: true });
  }
  await waitForControlFile(crossAppReleasePath, 600_000);
  if (consoleErrors.length || pageErrors.length) throw new Error(`renderer console/page errors observed after cross-app control: ${JSON.stringify({ consoleErrors, pageErrors }, null, 2)}`);
  return { runtimeContext, runtimeDaemon, runtime, agentClient };
}
