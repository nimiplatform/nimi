import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';

import { withRuntimeDaemon } from '../../../sdks/typescript/runtime/live-runtime-daemon.test-helper.ts';
import { withRealmFixtureServer } from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-realm-server.test-helper.ts';
import {
  admitDeveloperRegisteredRuntimeAccountCaller,
  admitLocalFirstPartyRuntimeAccountCaller,
  completeRuntimeAccountLogin,
  createFixtureRuntimeAgentClient,
  createRuntimeForEndpoint,
  desktopAccountCaller,
  initializeFixtureLocalAgent,
  logoutRuntimeAccount,
  registerRuntimeApp,
} from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-runtime.test-helper.ts';
import { createFixtureSourceMaterializationPacket } from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-source-packet.test-helper.ts';
import {
  DESKTOP_APP_ID,
  DESKTOP_APP_INSTANCE_ID,
  DESKTOP_DEVICE_ID,
  OWNER_USER_ID,
  RUNTIME_ACCOUNT_ACCESS_TOKEN,
  RUNTIME_ACCOUNT_REFRESH_TOKEN,
  RUNTIME_SOURCE_REF,
  SOURCE_MATERIALIZATION_AUDIENCE,
  SOURCE_PACKET_HMAC_SECRET,
} from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-shared.test-helper.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const evidenceRoot = path.join(repoRoot, '.nimi', 'local', 'evidence', 'runtime-shared-auth-broker');
const forbiddenSessionCommands = [
  'nimi.shell.auth.session.load',
  'nimi.shell.auth.session.save',
  'nimi.shell.auth.session.clear',
];
const brokerCapabilities = [
  'account.session.read',
  'data.scope.read#realm.worlds.read-probe',
];
let runtimeLocalAgentIdentity = null;
const appConfigs = [
  {
    id: 'tester-electron',
    appId: 'nimi.tester',
    root: path.join(repoRoot, 'apps', 'tester'),
    mainEntry: path.join(repoRoot, 'apps', 'tester', 'dist-electron', 'main.js'),
    rendererEnv: 'NIMI_TESTER_ELECTRON_RENDERER_URL',
    endpointEnv: 'NIMI_TESTER_ELECTRON_RUNTIME_ENDPOINT',
    dataRootEnv: 'NIMI_TESTER_ELECTRON_STANDARD_DATA_ROOT',
    hook: '__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__',
    readySelector: '[data-testid="nimi-app-shell"]',
    admission: 'developer',
    appInstanceId: 'nimi.tester.local-developer',
    deviceId: 'nimi-tester-local-developer-device',
    capabilities: [...brokerCapabilities, 'ai.spend.meter'],
  },
  {
    id: 'avatar-electron',
    appId: 'nimi.avatar',
    root: path.join(repoRoot, 'apps', 'avatar'),
    mainEntry: path.join(repoRoot, 'apps', 'avatar', 'dist-electron', 'main.js'),
    rendererEnv: 'NIMI_AVATAR_ELECTRON_RENDERER_URL',
    endpointEnv: 'NIMI_AVATAR_ELECTRON_RUNTIME_ENDPOINT',
    dataRootEnv: 'NIMI_AVATAR_ELECTRON_STANDARD_DATA_ROOT',
    hook: '__NIMI_AVATAR_ELECTRON_SDK_ACCEPTANCE__',
    readySelector: '[data-testid="avatar-root"]',
    admission: 'first-party',
    appInstanceId: 'nimi.avatar.local-first-party',
    deviceId: 'nimi-avatar-local-first-party-device',
    capabilities: [
      ...brokerCapabilities,
      'account.raw-token',
      'runtime.agent.read',
      'runtime.agent.write',
      'runtime.agent.turn.read',
      'runtime.agent.turn.write',
      'runtime.agent.avatar_debug.read',
      'runtime.agent.avatar_debug.write',
    ],
    env: {
      NIMI_AVATAR_ELECTRON_LOCAL_AGENT_OWNER_USER_ID: OWNER_USER_ID,
      NIMI_AVATAR_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF: 'runtime-source:shared-auth-live',
      NIMI_AVATAR_ELECTRON_LOCAL_AGENT_REF: 'local-agent:shared-auth-live',
      NIMI_AVATAR_ELECTRON_RUNTIME_TRUSTED_CALLER_MODE: 'local-first-party-app',
    },
  },
  {
    id: 'zhiyu-electron',
    appId: 'nimi.zhiyu',
    root: path.join(repoRoot, 'apps', 'zhiyu'),
    mainEntry: path.join(repoRoot, 'apps', 'zhiyu', 'dist-electron', 'main.js'),
    rendererEnv: 'NIMI_ZHIYU_ELECTRON_RENDERER_URL',
    endpointEnv: 'NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT',
    dataRootEnv: 'NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT',
    hook: '__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__',
    readySelector: '[data-zhiyu-screen="home"]',
    admission: 'first-party',
    appInstanceId: 'nimi.zhiyu.local-first-party',
    deviceId: 'nimi-zhiyu-local-first-party-device',
    capabilities: [
      ...brokerCapabilities,
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
    ],
    env: {
      NIMI_ZHIYU_ELECTRON_RUNTIME_TRUSTED_CALLER_MODE: 'local-first-party-app',
    },
  },
];

await mkdir(evidenceRoot, { recursive: true });
await withRealmFixtureServer({
  run: async ({ baseUrl, requests }) => {
    await withRuntimeDaemon({
      appId: DESKTOP_APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL: baseUrl,
        NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL: `${baseUrl}/api/auth/oauth/authorize`,
        NIMI_RUNTIME_ACCOUNT_TOKEN_URL: `${baseUrl}/api/auth/oauth/token`,
        NIMI_RUNTIME_ACCOUNT_CUSTODY_PARTITION: `shared-auth-live-${randomUUID()}`,
        NIMI_RUNTIME_APP_REGISTRY_PATH: path.join(
          repoRoot,
          '.nimi',
          'spec',
          'platform',
          'kernel',
          'tables',
          'nimi-app-registry.yaml',
        ),
        SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET: SOURCE_PACKET_HMAC_SECRET,
      },
      run: async ({ endpoint }) => {
        const desktopRuntime = createRuntimeForEndpoint(endpoint, DESKTOP_APP_ID);
        const desktopCaller = desktopAccountCaller();
        await registerRuntimeApp(desktopRuntime, DESKTOP_APP_ID, DESKTOP_APP_INSTANCE_ID, DESKTOP_DEVICE_ID);
        await completeRuntimeAccountLogin(desktopRuntime, desktopCaller);
        const localAgent = await initializeFixtureLocalAgent({
          agentClient: createFixtureRuntimeAgentClient(desktopRuntime),
          sourceMaterializationPacket: createFixtureSourceMaterializationPacket(
            {},
            SOURCE_MATERIALIZATION_AUDIENCE,
          ),
        });
        runtimeLocalAgentIdentity = {
          ownerUserId: OWNER_USER_ID,
          runtimeSourceRef: RUNTIME_SOURCE_REF,
          localAgentRef: localAgent.localAgentRef,
        };
        try {
          for (const config of appConfigs) {
            const report = await runAuthenticatedShell(config, endpoint, requests);
            report.failure = await runUnavailableShell(config);
            const reportPath = path.join(evidenceRoot, `${config.id}.json`);
            await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            process.stdout.write(`[shared-auth-live] ${config.id} passed\n`);
          }
        } finally {
          await logoutRuntimeAccount(desktopRuntime, desktopCaller);
        }
      },
    });
  },
});

async function admitApp(config, endpoint) {
  const runtime = createRuntimeForEndpoint(endpoint, config.appId);
  const input = {
    appId: config.appId,
    appInstanceId: config.appInstanceId,
    deviceId: config.deviceId,
    capabilities: config.capabilities,
  };
  if (config.admission === 'developer') {
    await admitDeveloperRegisteredRuntimeAccountCaller(runtime, input);
    return;
  }
  await admitLocalFirstPartyRuntimeAccountCaller(runtime, input);
}

async function runAuthenticatedShell(config, endpoint, realmRequests) {
  return withTempDir(config.id, async (tempRoot) => {
    const pageProblems = { consoleErrors: [], pageErrors: [] };
    const launched = await launchApp(config, endpoint, tempRoot);
    const { app, page } = launched;
    trackPageProblems(page, pageProblems);
    try {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction((hook) => Boolean(globalThis.window?.[hook]), config.hook, { timeout: 60_000 });
      // The app first registers its host/session identity. Admission then comes
      // from this Runtime-owned fixture, never from an app login RPC.
      await admitApp(config, endpoint);
      const loginRequired = page.locator('[data-testid="nimi-app-runtime-login-required"], [data-testid="zhiyu-runtime-login-required"]');
      if (await loginRequired.count()) {
        await loginRequired.locator('button').first().click();
      }
      try {
        await page.locator(config.readySelector).first().waitFor({ state: 'visible', timeout: 30_000 });
      } catch (error) {
        const diagnostic = await page.evaluate((hook) => ({
          href: location.href,
          bodyText: document.body?.innerText || '',
          html: document.documentElement.outerHTML.slice(0, 12_000),
          hookKeys: Object.keys(globalThis.window?.[hook] || {}),
        }), config.hook);
        const runtimeReadyDiagnostic = await invokeHook(page, config.hook, 'runtimeReady');
        const accountProjectionDiagnostic = config.id === 'tester-electron'
          ? await invokeHook(page, config.hook, 'accountProjection')
          : null;
        const brokerDiagnostic = await invokeHook(page, config.hook, 'sharedAuthBroker');
        throw new Error(`${config.id} did not reach ${config.readySelector}: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({ diagnostic, runtimeReadyDiagnostic, accountProjectionDiagnostic, brokerDiagnostic }, null, 2)}`);
      }

      const runtimeReady = await invokeHook(page, config.hook, 'runtimeReady');
      assert.equal(runtimeReady.ok, true, `${config.id} Runtime must be ready: ${JSON.stringify(runtimeReady)}`);
      const brokerRequestStart = realmRequests.length;
      const sharedAuthBroker = await invokeHook(page, config.hook, 'sharedAuthBroker');
      assert.deepEqual(sharedAuthBroker, {
        ok: true,
        transport: 'electron-ipc',
        status: 'runtime-mediated-realm-ready',
        reason: 0,
      });
      const brokerRequests = realmRequests.slice(brokerRequestStart);
      assert.equal(
        brokerRequests.some((request) => request.method === 'GET' && request.path === '/api/world'),
        true,
        `${config.id} broker call must reach the Realm fixture`,
      );

      const deniedCommands = await probeDeniedSessionCommands(page);
      assert.equal(deniedCommands.every((row) => row.denied === true), true);
      const rawAccessPosture = config.id === 'avatar-electron'
        ? await invokeHook(page, config.hook, 'rawAccessPosture', 'binding-only')
        : null;
      if (rawAccessPosture) {
        assert.equal(rawAccessPosture.ok, true);
        assert.equal(rawAccessPosture.status.accepted, false);
        assert.equal(rawAccessPosture.status.materialPresent, false);
      }

      const disabledStateInspection = await inspectPage(page);
      const interaction = await exercisePrimaryInteraction(config, page);
      const desktopPath = path.join(evidenceRoot, `${config.id}-desktop.png`);
      await setWindowSize(app, 1180, 780);
      await page.screenshot({ path: desktopPath, fullPage: false });
      const desktopInspection = await inspectPage(page);
      const narrowPath = path.join(evidenceRoot, `${config.id}-narrow.png`);
      await setWindowSize(app, 420, 720);
      await page.waitForTimeout(250);
      await page.screenshot({ path: narrowPath, fullPage: false });
      const narrowInspection = await inspectPage(page);

      assert.equal(desktopInspection.unlabeledControls.length, 0, JSON.stringify(desktopInspection.unlabeledControls));
      assert.equal(narrowInspection.unlabeledControls.length, 0, JSON.stringify(narrowInspection.unlabeledControls));
      assert.equal(narrowInspection.horizontalOverflow, false, `${config.id} overflows at narrow width`);
      assert.equal(narrowInspection.smallControls.length, 0, JSON.stringify(narrowInspection.smallControls));
      const observedDisabledControlCount = Math.max(
        disabledStateInspection.disabledControlCount,
        desktopInspection.disabledControlCount,
      );
      const disabledFeatureState = config.id === 'avatar-electron'
        ? await page.locator('[data-testid="avatar-degraded-surface"]').count() > 0
        : false;
      assert.ok(
        observedDisabledControlCount > 0 || disabledFeatureState,
        `${config.id} must expose a real disabled state`,
      );
      assert.equal(desktopInspection.chineseVisible, true, `${config.id} must render readable Chinese acceptance text`);
      assert.equal(desktopInspection.longTextVisible, true, `${config.id} must render a long-text acceptance case`);

      const tokenLeak = await probeTokenLeak(page, [runtimeReady, sharedAuthBroker, deniedCommands, rawAccessPosture]);
      assert.deepEqual(tokenLeak.findings, []);
      await page.waitForTimeout(250);
      assert.deepEqual(pageProblems.consoleErrors, []);
      assert.deepEqual(pageProblems.pageErrors, []);

      return {
        schemaVersion: 1,
        appId: config.appId,
        shell: 'electron',
        endpoint,
        success: {
          runtimeReady,
          sharedAuthBroker,
          brokerRequests: brokerRequests.map((request) => ({
            method: request.method,
            path: request.path,
            query: request.query,
            authorizationPresent: /^Bearer\s+/u.test(String(request.authorization || '')),
          })),
        },
        denied: { sessionCommands: deniedCommands, rawAccessPosture },
        disabled: { visibleDisabledControls: observedDisabledControlCount, disabledFeatureState },
        interaction,
        accessibility: {
          desktop: desktopInspection,
          narrow: narrowInspection,
        },
        tokenLeak,
        consoleErrors: pageProblems.consoleErrors,
        pageErrors: pageProblems.pageErrors,
        screenshots: {
          desktop: relativeToRepo(desktopPath),
          narrow: relativeToRepo(narrowPath),
        },
      };
    } finally {
      await app.close();
    }
  });
}

async function runUnavailableShell(config) {
  return withTempDir(`${config.id}-failure`, async (tempRoot) => {
    const { app, page } = await launchApp(config, '127.0.0.1:1', tempRoot);
    try {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction((hook) => Boolean(globalThis.window?.[hook]), config.hook, { timeout: 30_000 });
      const runtimeReady = await invokeHook(page, config.hook, 'runtimeReady');
      const sharedAuthBroker = await invokeHook(page, config.hook, 'sharedAuthBroker');
      assert.equal(runtimeReady.ok, false);
      assert.equal(sharedAuthBroker.ok, false);
      return { observed: true, runtimeReady, sharedAuthBroker };
    } finally {
      await app.close();
    }
  });
}

async function launchApp(config, endpoint, tempRoot) {
  const dataRoot = path.join(tempRoot, 'standard-data');
  await mkdir(dataRoot, { recursive: true });
  const rendererUrl = `${pathToFileURL(path.join(config.root, 'dist', 'index.html')).toString()}?nimiElectronSdkAcceptance=1`;
  const app = await electron.launch({
    args: [
      config.mainEntry,
      `--user-data-dir=${path.join(tempRoot, 'electron-user-data')}`,
      '--lang=zh-CN',
    ],
    env: {
      ...process.env,
      LANG: 'zh_CN.UTF-8',
      NIMI_RUNTIME_GRPC_ADDR: '',
      [config.rendererEnv]: rendererUrl,
      [config.endpointEnv]: endpoint,
      [config.dataRootEnv]: dataRoot,
      ...(config.env ?? {}),
      ...(config.id === 'avatar-electron' && runtimeLocalAgentIdentity ? {
        NIMI_AVATAR_ELECTRON_LOCAL_AGENT_OWNER_USER_ID: runtimeLocalAgentIdentity.ownerUserId,
        NIMI_AVATAR_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF: runtimeLocalAgentIdentity.runtimeSourceRef,
        NIMI_AVATAR_ELECTRON_LOCAL_AGENT_REF: runtimeLocalAgentIdentity.localAgentRef,
      } : {}),
    },
  });
  return { app, page: await app.firstWindow({ timeout: 60_000 }) };
}

async function invokeHook(page, hook, method, argument) {
  return page.evaluate(async ({ hookName, methodName, methodArgument }) => {
    const target = globalThis.window[hookName];
    return methodArgument === undefined
      ? target[methodName]()
      : target[methodName](methodArgument);
  }, { hookName: hook, methodName: method, methodArgument: argument });
}

async function probeDeniedSessionCommands(page) {
  return page.evaluate(async (commands) => Promise.all(commands.map(async (command) => {
    try {
      await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {});
      return { command, denied: false };
    } catch (error) {
      return {
        command,
        denied: true,
        code: error?.code ?? null,
        reasonCode: error?.reasonCode ?? null,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  })), forbiddenSessionCommands);
}

async function exercisePrimaryInteraction(config, page) {
  const longChinese = '共享账户授权由运行时统一托管；这个长文本用于验证窄屏换行、中文可读性以及输入框在真实桌面外壳中的可用性。';
  if (config.id === 'avatar-electron') {
    const opener = page.locator('button[aria-controls="avatar-companion-composer"]');
    if (await opener.count()) {
      await opener.click();
      const input = page.locator('[data-testid="avatar-companion-composer"] textarea');
      await input.fill(longChinese);
      return { kind: 'composer', value: await input.inputValue(), usable: await input.isEnabled() };
    }
    const degraded = page.locator('[data-testid="avatar-degraded-surface"]');
    await degraded.waitFor({ state: 'visible' });
    const value = await degraded.innerText();
    const reload = degraded.locator('button');
    await reload.focus();
    return {
      kind: 'degraded-recovery-control',
      value,
      usable: await reload.isEnabled(),
      composition: await page.locator('[data-testid="avatar-root"]').getAttribute('data-composition'),
    };
  }
  if (config.id === 'tester-electron') {
    const input = page.locator('textarea:enabled, input[type="text"]:enabled').first();
    await input.waitFor({ state: 'visible', timeout: 30_000 });
    await input.fill(longChinese);
    await page.locator('[data-workbench-account-trigger]').click();
    await page.locator('[data-workbench-account-panel]').waitFor({ state: 'visible' });
    return {
      kind: 'workbench-input-and-account-owner',
      value: await input.inputValue(),
      usable: await input.isEnabled(),
      desktopOwnedAccountControlDisabled: await page.locator('[data-workbench-account-panel] button:disabled').count() > 0,
    };
  }
  const guidance = page.locator('[data-zhiyu-no-local-partner-action="show-guidance"]');
  if (await guidance.count()) {
    await guidance.click();
  } else {
    const candidate = page.locator('[data-zhiyu-local-agent-candidate="true"]').first();
    if (await candidate.count()) {
      await candidate.click();
      await page.locator('[data-zhiyu-local-agent-candidate-active="true"]').first().waitFor({ state: 'visible' });
      const input = page.locator('[data-chat-composer-textarea="true"]');
      await input.fill(longChinese);
      return {
        kind: 'select-local-partner-and-compose',
        value: await input.inputValue(),
        usable: await input.isEnabled(),
        submitEnabled: await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'),
      };
    }
  }
  return {
    kind: 'empty-partner-guidance',
    value: await page.locator('[data-zhiyu-product-shell="workspace"]').innerText(),
    usable: true,
  };
}

async function setWindowSize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(0, 0);
    window.setSize(size.width, size.height);
  }, { width, height });
}

async function inspectPage(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll('button, input, textarea, select, a[href], [role="button"]')]
      .filter(visible);
    const controlName = (element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent || '').join(' ')
        : '';
      const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent || '' : '';
      return [
        element.getAttribute('aria-label'),
        labelledText,
        label,
        element.getAttribute('title'),
        element.getAttribute('placeholder'),
        element.textContent,
      ].map((value) => String(value || '').trim()).find(Boolean) || '';
    };
    const unlabeledControls = controls
      .filter((element) => !controlName(element))
      .map((element) => element.outerHTML.slice(0, 240));
    const smallControls = controls
      .filter((element) => !element.hasAttribute('disabled'))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width < 20 || rect.height < 20)
      .map(({ element, rect }) => ({
        name: controlName(element),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }));
    const bodyText = String(document.body?.innerText || '');
    const inputText = [...document.querySelectorAll('input, textarea')]
      .map((element) => String(element.value || ''))
      .join('\n');
    const readableText = `${bodyText}\n${inputText}`;
    const longTextVisible = [...document.querySelectorAll('p, span, div, input, textarea')]
      .filter(visible)
      .some((element) => {
        const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.value
          : element.textContent;
        return String(value || '').trim().length >= 48;
      });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      lang: document.documentElement.lang || null,
      landmarkCount: document.querySelectorAll('main, [role="main"], section[aria-label]').length,
      visibleControlCount: controls.length,
      disabledControlCount: controls.filter((element) => element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true').length,
      unlabeledControls,
      smallControls,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      chineseVisible: /[\u3400-\u9fff]/u.test(readableText),
      longTextVisible,
    };
  });
}

async function probeTokenLeak(page, resultValues) {
  const browserProjection = await page.evaluate(async () => {
    const local = { ...localStorage };
    const session = { ...sessionStorage };
    const indexedDatabases = typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map((entry) => entry.name || '')
      : [];
    const globals = {};
    for (const key of Object.getOwnPropertyNames(globalThis.window)) {
      let value;
      try {
        value = globalThis.window[key];
      } catch {
        continue;
      }
      if (typeof value === 'string' && value.length < 4096) globals[key] = value;
    }
    return {
      local,
      session,
      indexedDatabases,
      globals,
      html: document.documentElement.outerHTML,
      bodyText: document.body?.innerText || '',
    };
  });
  const raw = JSON.stringify({ browserProjection, resultValues });
  const findings = [];
  for (const secret of [RUNTIME_ACCOUNT_ACCESS_TOKEN, RUNTIME_ACCOUNT_REFRESH_TOKEN]) {
    if (raw.includes(secret)) findings.push(`known fixture credential leaked: ${secret}`);
  }
  for (const pattern of [/Bearer\s+[A-Za-z0-9._~-]{12,}/gu, /refresh[_-]?token["'=:\s]+[A-Za-z0-9._~-]{8,}/giu]) {
    if (pattern.test(raw)) findings.push(`credential-shaped value leaked: ${pattern.source}`);
  }
  return {
    passed: findings.length === 0,
    findings,
    inspected: ['DOM', 'localStorage', 'sessionStorage', 'IndexedDB names', 'window string globals', 'acceptance hook results'],
  };
}

function trackPageProblems(page, target) {
  page.on('console', (message) => {
    if (message.type() === 'error') target.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => target.pageErrors.push(error.message));
}

function relativeToRepo(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-shared-auth-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
