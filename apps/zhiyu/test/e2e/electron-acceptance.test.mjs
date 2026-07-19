import assert from 'node:assert/strict';
import { lstatSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

const root = path.resolve(import.meta.dirname, '..', '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const rendererAcceptanceUrl = withAcceptanceQuery(
  pathToFileURL(path.join(root, 'dist', 'index.html')).toString(),
);

test('unsupervised Zhiyu Electron keeps app-owned SQLite usable and fails closed for Nimi authority', { timeout: 90_000 }, async () => {
  await withTempDir('acceptance', async (tmpRoot) => {
    const requestedUserDataRoot = path.join(tmpRoot, 'profile');
    await mkdir(requestedUserDataRoot, { recursive: true, mode: 0o700 });
    const canonicalUserDataRoot = await realpath(requestedUserDataRoot);

    const firstRun = await launchZhiyu(requestedUserDataRoot);
    try {
      const page = await firstRun.firstWindow();
      const pageProblems = trackPageProblems(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
      await page.waitForSelector('.runtime-unavailable-screen');

      assert.equal(
        await firstRun.evaluate(({ app }) => app.getPath('userData')),
        canonicalUserDataRoot,
      );
      assert.deepEqual(
        await page.evaluate(() => Object.keys(globalThis.window.__NIMI_ELECTRON_RUNTIME__).sort()),
        ['invoke', 'listen'],
      );
      assert.deepEqual(await page.evaluate(() => ({
        electron: 'electron' in globalThis.window,
        ipcRenderer: 'ipcRenderer' in globalThis.window,
        process: 'process' in globalThis.window,
        require: 'require' in globalThis.window,
      })), {
        electron: false,
        ipcRenderer: false,
        process: false,
        require: false,
      });

      await assertVisibleText(page, '织羽 Zhiyu');
      await assertVisibleText(page, '本地运行服务暂未连接');
      await assertVisibleText(page, '重新检查本地服务');
      const unavailableText = await page.locator('.runtime-unavailable-screen').innerText();
      assert.doesNotMatch(unavailableText, /ECONNREFUSED|start_external_runtime_daemon/u);
      assert.doesNotMatch(
        unavailableText,
        /agents\.interact|memory\.(?:read|write)|knowledge\.(?:read|write)|Nimi permission/iu,
      );
      assert.equal(await page.locator('[data-zhiyu-screen="home"]').count(), 0);
      assert.equal(await page.locator('[data-zhiyu-region="capability-studio"]').count(), 0);

      await assertNativeEditMenu(firstRun);
      await assertNativeCopyShortcut(firstRun, page);

      const diagnosticsError = await captureInvokeError(
        page,
        NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe'],
        { stage: 'zhiyu-unsupervised-acceptance' },
      );
      assertProtectedHostSetDenial(diagnosticsError);

      const retiredAuthError = await captureInvokeError(
        page,
        'nimi.shell.auth.session.load',
        {},
      );
      assert.equal(retiredAuthError.code, 'invalid-payload');
      assert.equal(retiredAuthError.reasonCode, 'unsupported-electron-shell-command');
      assert.equal(retiredAuthError.source, 'electron');

      await page.waitForFunction(() => Boolean(
        globalThis.window?.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__,
      ));
      const runtimeReady = await page.evaluate(() =>
        globalThis.window.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__.runtimeReady(),
      );
      assert.equal(runtimeReady.transport, 'electron-ipc');
      assert.equal(runtimeReady.ok, false);
      assertProtectedHostSetDenial(runtimeReady);
      assert.equal(runtimeReady.source, 'runtime');

      const sharedAuthBroker = await page.evaluate(() =>
        globalThis.window.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__.sharedAuthBroker(),
      );
      assert.equal(sharedAuthBroker.transport, 'electron-ipc');
      assert.equal(sharedAuthBroker.ok, false);
      assert.equal(sharedAuthBroker.code, 'SDK_RUNTIME_METHOD_UNAVAILABLE');
      assert.equal(sharedAuthBroker.reasonCode, 'SDK_RUNTIME_METHOD_UNAVAILABLE');
      assert.equal(sharedAuthBroker.actionHint, 'use_admitted_protected_runtime_carrier');

      await page.setViewportSize({ width: 390, height: 900 });
      const narrowState = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth
          - document.documentElement.clientWidth,
        retryDisabled: document.querySelector('.runtime-unavailable-screen button')?.disabled,
        retryRect: (() => {
          const rectangle = document.querySelector('.runtime-unavailable-screen button')
            ?.getBoundingClientRect();
          return rectangle
            ? { height: rectangle.height, width: rectangle.width }
            : null;
        })(),
      }));
      assert.ok(narrowState.horizontalOverflow <= 2, JSON.stringify(narrowState));
      assert.equal(narrowState.retryDisabled, false);
      assert.ok((narrowState.retryRect?.height ?? 0) >= 36, JSON.stringify(narrowState));
      assert.ok((narrowState.retryRect?.width ?? 0) >= 120, JSON.stringify(narrowState));
      assertNoPageProblems(pageProblems);
    } finally {
      await firstRun.close();
    }

    const databasePath = path.join(canonicalUserDataRoot, 'app-owned', 'v1', 'zhiyu.sqlite3');
    assertAppOwnedDatabase(databasePath, 1);

    const secondRun = await launchZhiyu(requestedUserDataRoot);
    try {
      const page = await secondRun.firstWindow();
      const pageProblems = trackPageProblems(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('.runtime-unavailable-screen');
      assertNoPageProblems(pageProblems);
    } finally {
      await secondRun.close();
    }
    assertAppOwnedDatabase(databasePath, 2);
  });
});

async function launchZhiyu(userDataRoot) {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataRoot}`],
    env: acceptanceEnvironment({
      NIMI_ZHIYU_ELECTRON_RENDERER_URL: rendererAcceptanceUrl,
    }),
  });
}

function assertAppOwnedDatabase(databasePath, expectedBootCount) {
  const metadata = lstatSync(databasePath);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  assert.equal(metadata.nlink, 1);
  if (process.platform !== 'win32') {
    assert.equal(metadata.uid, process.getuid());
    assert.equal(metadata.mode & 0o077, 0);
  }

  const database = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false });
  try {
    const rows = Object.fromEntries(
      database.prepare('SELECT key, value FROM app_meta ORDER BY key').all()
        .map((row) => [String(row.key), String(row.value)]),
    );
    assert.equal(rows.app_id, 'nimi.zhiyu');
    assert.equal(Number(rows.boot_count), expectedBootCount);
    assert.equal(Number(database.prepare('PRAGMA user_version').get()?.user_version), 1);
  } finally {
    database.close();
  }
}

function assertProtectedHostSetDenial(error) {
  assert.equal(error.code, 'capability-unavailable', JSON.stringify(error));
  assert.equal(error.reasonCode, 'electron-standard-capability-not-in-host-set');
  assert.equal(
    error.actionHint,
    'use_command_admitted_by_electron_standard_shell_capability_set',
  );
}

async function assertNativeEditMenu(app) {
  const menuState = await app.evaluate(({ Menu }) => {
    const applicationMenu = Menu.getApplicationMenu();
    const roles = [];
    const visit = (items) => {
      for (const item of items) {
        if (item.role) roles.push(item.role);
        if (item.submenu) visit(item.submenu.items);
      }
    };
    if (applicationMenu) visit(applicationMenu.items);
    return { installed: applicationMenu !== null, roles };
  });
  assert.equal(menuState.installed, true);
  assert.deepEqual(
    menuState.roles
      .map((role) => role.toLowerCase())
      .filter((role) => ['undo', 'redo', 'cut', 'copy', 'paste', 'selectall'].includes(role)),
    ['undo', 'redo', 'cut', 'copy', 'paste', 'selectall'],
  );
}

async function assertNativeCopyShortcut(app, page) {
  const copyText = '本地运行服务暂未连接';
  const sentinel = `zhiyu-copy-sentinel-${Date.now()}`;
  const previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), sentinel);
    await page.evaluate((text) => {
      const rootNode = document.querySelector('.runtime-unavailable-screen');
      const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent?.includes(text)) node = walker.nextNode();
      if (!node?.textContent) throw new Error(`copy probe text not found: ${text}`);
      const start = node.textContent.indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, copyText);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), copyText);
  } finally {
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), previousClipboard);
  }
}

async function captureInvokeError(page, command, payload) {
  return page.evaluate(async ({ commandName, commandPayload }) => {
    try {
      await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, commandPayload);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: error?.code,
        reasonCode: error?.reasonCode,
        actionHint: error?.actionHint,
        source: error?.source,
        message: error instanceof Error ? error.message : String(error || ''),
      };
    }
  }, { commandName: command, commandPayload: payload });
}

async function assertVisibleText(page, text) {
  assert.ok(await page.getByText(text, { exact: false }).count() > 0, `expected visible text: ${text}`);
}

function trackPageProblems(page) {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });
  return problems;
}

function assertNoPageProblems(problems) {
  assert.deepEqual(problems, []);
}

function acceptanceEnvironment(overrides) {
  return Object.fromEntries(Object.entries({
    HOME: process.env.HOME,
    LANG: process.env.LANG || 'en_US.UTF-8',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: '/private/tmp',
    ...overrides,
  }).filter(([, value]) => typeof value === 'string' && value.length > 0));
}

async function withTempDir(prefix, run) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), `nimi-zhiyu-electron-${prefix}-`)));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function withAcceptanceQuery(value) {
  const url = new URL(value);
  url.searchParams.set('nimiElectronSdkAcceptance', '1');
  return url.toString();
}
