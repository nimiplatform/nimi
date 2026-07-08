import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { withSdkDistLock } from '../../../../scripts/lib/sdk-dist-lock.mjs';
import { withRuntimeAgentLiveE2EFixture } from '../../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture.test-helper.ts';
import { runtimeAgentLiveE2EChatScenarioPrompt } from '../../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-realm-server.test-helper.ts';
import { createFixtureRuntimeAgentClient } from '../../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-runtime.test-helper.ts';
import {
  assertNoPageProblems,
  createZhiyuLiveRuntimeAcceptanceRendererUrl,
  createZhiyuLiveRuntimeFixtureAcceptanceInitScript,
  resetAcceptanceInputs,
  trackPageProblems,
  waitForEvidence,
} from '../electron-live-runtime-acceptance-helpers.mjs';
import {
  avatarAppId,
  avatarRuntimeProtectedScopes,
  seedLiveRuntimeAvatarPresentationProfile,
} from '../electron-live-runtime-avatar-launch-helpers.mjs';

const zhiyuRoot = path.resolve(import.meta.dirname, '..', '..');
const repoRoot = path.resolve(zhiyuRoot, '..', '..');
const mainEntry = path.join(zhiyuRoot, 'dist-electron', 'main.js');
const zhiyuAppId = 'nimi.zhiyu';
const zhiyuRuntimeProtectedScopes = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.autonomy.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
  'runtime.agent.ai_config.read',
  'runtime.agent.ai_config.write',
  'ai.spend.meter',
];
const scenarioEvidenceRoot = path.join(
  repoRoot,
  '.nimi/local/plan/2026-07-08-zhiyu-voice-emotion-full-auto-test/evidence/scenario',
);

export { runtimeAgentLiveE2EChatScenarioPrompt };
export { waitForEvidence };

export async function withZhiyuScenarioApp(input, run) {
  await withRuntimeAgentLiveE2EFixture({
    localChatCompletionStreamDelayMs: input.localChatCompletionStreamDelayMs ?? 0,
    voiceSpeechStreamDelayMs: input.voiceSpeechStreamDelayMs ?? 0,
    run: async (fixture) => {
      await fixture.admitLocalFirstPartyRuntimeAccountCaller({
        appId: zhiyuAppId,
        appInstanceId: `${zhiyuAppId}.scenario-suite`,
        deviceId: 'nimi-zhiyu-scenario-suite-device',
        capabilities: zhiyuRuntimeProtectedScopes,
      });
      if (input.seedAvatarPresentation === true) {
        await fixture.admitLocalFirstPartyRuntimeAccountCaller({
          appId: avatarAppId,
          appInstanceId: `${avatarAppId}.scenario-suite`,
          deviceId: 'nimi-avatar-scenario-suite-device',
          capabilities: avatarRuntimeProtectedScopes,
        });
        await seedLiveRuntimeAvatarPresentationProfile(fixture);
      }
      await withSdkDistLock(`zhiyu scenario electron app ${input.scenarioId}`, () => withTempDir(`scenario-${input.scenarioId}`, async (tmpRoot) => {
        const dataRoot = path.join(tmpRoot, 'data');
        await mkdir(dataRoot, { recursive: true });
        const app = await launchScenarioApp({ fixture, dataRoot });
        let appClosed = false;
        const closeApp = async () => {
          if (appClosed) return;
          appClosed = true;
          await app.close();
        };
        try {
          const { page, pageProblems } = await openScenarioAppPage({
            app,
            fixture,
            initScript: input.initScript,
          });

          const config = await commitScenarioAIConfig(fixture);
          await waitForEvidence(page, ({ revision }) =>
            globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-agent-ai-config-ready'
            && globalThis.window.__nimiZhiyuEvidence?.route?.configRevision === revision
            && globalThis.window.__nimiZhiyuEvidence?.route?.capabilities?.['image.generate']?.binding?.route === 'cloud'
            && globalThis.window.__nimiZhiyuEvidence?.route?.capabilities?.['audio.synthesize']?.binding?.route === 'cloud'
            && globalThis.window.__nimiZhiyuEvidence?.route?.capabilities?.['audio.transcribe']?.binding?.route === 'cloud',
            'scenario ready Runtime Agent AI Config evidence',
            { revision: config.revision },
          );
          const readyEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          await run({
            fixture,
            page,
            pageProblems,
            readyEvidence,
            config,
            dataRoot,
            app,
            closeApp,
            launchApp: () => launchScenarioApp({ fixture, dataRoot }),
          });
          assertNoPageProblems(pageProblems);
        } finally {
          await closeApp();
        }
      }));
    },
  });
}

export async function openScenarioAppPage({ app, fixture, initScript }) {
  const page = await waitForScenarioWindow(app, 'scenario live Runtime app first window');
  const pageProblems = trackPageProblems(page);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
  await page.waitForSelector('[data-zhiyu-screen="home"]');
  await page.addInitScript(createZhiyuLiveRuntimeFixtureAcceptanceInitScript(fixture));
  if (initScript) {
    await page.addInitScript(initScript);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
  await page.waitForSelector('[data-zhiyu-screen="home"]');
  return { page, pageProblems };
}

export async function withOfflineScenarioApp(input, run) {
  await withSdkDistLock(`zhiyu offline scenario electron app ${input.scenarioId}`, () => withTempDir(`scenario-offline-${input.scenarioId}`, async (tmpRoot) => {
    const dataRoot = path.join(tmpRoot, 'data');
    await mkdir(dataRoot, { recursive: true });
    const app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${path.join(dataRoot, 'electron-user-data')}`],
      env: {
        ...process.env,
        NIMI_RUNTIME_GRPC_ADDR: '',
        NIMI_ZHIYU_ELECTRON_RENDERER_URL: createZhiyuLiveRuntimeAcceptanceRendererUrl(zhiyuRoot),
        NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT: '127.0.0.1:1',
        NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
        NIMI_ZHIYU_AVATAR_ELECTRON_MAIN_PATH: path.join(zhiyuRoot, '..', 'avatar', 'dist-electron', 'main.js'),
      },
    });
    try {
      const page = await waitForScenarioWindow(app, 'scenario offline app first window');
      const pageProblems = trackPageProblems(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
      await run({
        app,
        page,
        pageProblems,
        dataRoot,
      });
      assertNoPageProblems(pageProblems);
    } finally {
      await app.close();
    }
  }));
}

export function assertScenarioPageProblemsClean(pageProblems) {
  assertNoPageProblems(pageProblems);
}

export async function sendScenarioPrompt(context, prompt, label) {
  const page = context.page;
  await resetAcceptanceInputs(page);
  await page.locator('[data-chat-composer-textarea="true"]').fill(prompt);
  try {
    await page.waitForFunction((expectedPrompt) =>
      document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
      && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
      && document.querySelector('[data-chat-composer-textarea="true"]')?.value === expectedPrompt,
    prompt, { timeout: 45_000 });
  } catch (error) {
    const readiness = await page.evaluate((expectedPrompt) => {
      const textarea = document.querySelector('[data-chat-composer-textarea="true"]');
      const send = document.querySelector('[data-chat-composer-send="true"]');
      const submitRoot = document.querySelector('[data-zhiyu-submit-enabled]');
      return {
        expectedPrompt,
        textareaValue: textarea?.value ?? null,
        textareaMatchesExpected: textarea?.value === expectedPrompt,
        sendDisabled: send?.disabled ?? null,
        submitEnabled: submitRoot?.getAttribute('data-zhiyu-submit-enabled') ?? null,
        composerState: submitRoot?.getAttribute('data-zhiyu-composer-state') ?? null,
        evidence: globalThis.window.__nimiZhiyuEvidence ?? null,
      };
    }, prompt).catch((evalError) => ({
      evaluationError: evalError instanceof Error ? evalError.message : String(evalError),
    }));
    throw new Error(`${label} submit readiness timed out: ${JSON.stringify(readiness)}`, { cause: error });
  }
  await page.locator('[data-chat-composer-send="true"]').click();
  await waitForEvidence(page, ({ prompt: submittedPrompt }) =>
    globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'runtime-agent-turn-completed'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === submittedPrompt),
    label,
    { prompt },
  );
  return page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
}

export async function captureScenarioEvidence(context, input) {
  await mkdir(scenarioEvidenceRoot, { recursive: true });
  const safeId = `${input.scenarioId}-r${input.iteration}`.replace(/[^a-zA-Z0-9._-]/gu, '-');
  const screenshot = path.join(scenarioEvidenceRoot, `${safeId}.png`);
  await context.page.screenshot({ path: screenshot, fullPage: true });
  const domEvidence = await context.page.evaluate(() => ({
    url: globalThis.location.href,
    productStage: globalThis.document.querySelector('[data-zhiyu-product-stage]')?.getAttribute('data-zhiyu-product-stage') ?? null,
    chatState: globalThis.document.querySelector('[data-zhiyu-agent-chat-state]')?.getAttribute('data-zhiyu-agent-chat-state') ?? null,
    routeState: globalThis.document.querySelector('[data-zhiyu-route-state]')?.getAttribute('data-zhiyu-route-state') ?? null,
    zhiyuEvidence: globalThis.window.__nimiZhiyuEvidence ?? null,
  }));
  const evidencePath = path.join(scenarioEvidenceRoot, `${safeId}.json`);
  await writeFile(
    evidencePath,
    `${JSON.stringify({
      scenarioId: input.scenarioId,
      iteration: input.iteration,
      screenshot: path.basename(screenshot),
      pageProblems: [...context.pageProblems],
      domEvidence,
      ...(input.extra ?? {}),
    }, null, 2)}\n`,
    'utf8',
  );
  return {
    screenshot,
    evidencePath,
  };
}

export async function assertCompletedTurnEvidence(evidence, input) {
  assert.equal(evidence.chat.ready, true);
  assert.equal(evidence.chat.state, 'completed');
  assert.equal(evidence.chat.reasonCode, 'runtime-agent-turn-completed');
  assert.equal(evidence.chat.conversationAnchorId, input.conversationAnchorId);
  assert.equal(evidence.chat.messages.some((message) => message?.text === input.prompt), true);
  assert.equal(evidence.chat.eventTypes.includes('text-delta'), true);
  assert.equal(evidence.chat.eventTypes.includes('message-sealed'), true);
  assert.equal(evidence.chat.eventTypes.includes('turn-completed'), true);
}

async function commitScenarioAIConfig(fixture) {
  const agentAIConfig = createFixtureRuntimeAgentClient(fixture.runtime).agentAIConfig;
  const identity = {
    ownerUserId: fixture.ownerUserId,
    runtimeSourceRef: fixture.runtimeSourceRef,
    localAgentRef: fixture.localAgentRef,
  };
  const seeded = await agentAIConfig.get(identity);
  return agentAIConfig.upsert({
    ...identity,
    expectedRevision: seeded.revision,
    intents: {
      ...seeded.intents,
      'text.generate': {
        route: fixture.route.executionBinding.route,
        modelId: fixture.route.executionBinding.modelId,
        targetRef: fixture.route.targetRef,
      },
      'image.generate': {
        route: fixture.imageRoute.executionBinding.route,
        modelId: fixture.imageRoute.executionBinding.modelId,
        ...(fixture.imageRoute.executionBinding.connectorId
          ? { connectorId: fixture.imageRoute.executionBinding.connectorId }
          : {}),
        targetRef: fixture.imageRoute.targetRef,
      },
      'audio.synthesize': {
        route: fixture.voiceRoute.executionBinding.route,
        modelId: fixture.voiceRoute.executionBinding.modelId,
        ...(fixture.voiceRoute.executionBinding.connectorId
          ? { connectorId: fixture.voiceRoute.executionBinding.connectorId }
          : {}),
        targetRef: fixture.voiceRoute.targetRef,
      },
      'audio.transcribe': {
        route: fixture.transcriptionRoute.executionBinding.route,
        modelId: fixture.transcriptionRoute.executionBinding.modelId,
        ...(fixture.transcriptionRoute.executionBinding.connectorId
          ? { connectorId: fixture.transcriptionRoute.executionBinding.connectorId }
          : {}),
        targetRef: fixture.transcriptionRoute.targetRef,
      },
    },
  });
}

async function launchScenarioApp({ fixture, dataRoot }) {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${path.join(dataRoot, 'electron-user-data')}`],
    env: {
      ...process.env,
      NIMI_RUNTIME_GRPC_ADDR: '',
      NIMI_ZHIYU_ELECTRON_RENDERER_URL: createZhiyuLiveRuntimeAcceptanceRendererUrl(zhiyuRoot),
      NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT: fixture.endpoint,
      NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
      NIMI_ZHIYU_AVATAR_ELECTRON_MAIN_PATH: path.join(zhiyuRoot, '..', 'avatar', 'dist-electron', 'main.js'),
    },
  });
}

async function waitForScenarioWindow(app, label) {
  const timeoutMs = 120_000;
  const startedAt = Date.now();
  let eventError = null;
  const firstWindowPromise = app.firstWindow({ timeout: timeoutMs })
    .catch((error) => {
      eventError = error;
      return null;
    });

  while (Date.now() - startedAt < timeoutMs) {
    const existing = app.windows()[0] ?? null;
    if (existing) {
      return existing;
    }
    const eventWindow = await Promise.race([
      firstWindowPromise,
      sleep(100).then(() => null),
    ]);
    if (eventWindow) {
      return eventWindow;
    }
  }

  const existing = app.windows()[0] ?? null;
  if (existing) {
    return existing;
  }
  const diagnostics = await readElectronWindowDiagnostics(app);
  throw new Error(
    `${label}: no Electron BrowserWindow after ${timeoutMs}ms; diagnostics=${JSON.stringify(diagnostics)}; firstWindow=${eventError?.stack || eventError?.message || 'timeout'}`,
  );
}

async function readElectronWindowDiagnostics(app) {
  try {
    return await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
      appReady: electronApp.isReady(),
      windows: BrowserWindow.getAllWindows().map((window) => ({
        id: window.id,
        destroyed: window.isDestroyed(),
        visible: window.isVisible(),
        title: window.getTitle(),
        url: window.webContents.getURL(),
        webContentsDestroyed: window.webContents.isDestroyed(),
      })),
    }));
  } catch (error) {
    return {
      diagnosticsError: error instanceof Error ? error.stack || error.message : String(error),
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-zhiyu-electron-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
