#!/usr/bin/env node
/* global document, getComputedStyle, innerHeight, innerWidth, location */
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { _electron as electron } from 'playwright';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptRoot, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const zhiyuRoot = path.join(repoRoot, 'apps', 'zhiyu');
const acceptanceRoot = path.join(repoRoot, '.nimi', 'local', 'acceptance');
const defaultEvidenceRoot = path.join(
  acceptanceRoot,
  '2026-07-19-macos-runtime-desktop-zhiyu',
  `real-electron-negative-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}`,
);
const evidenceRoot = resolveEvidenceRoot(process.env.NIMI_MACOS_ACCEPTANCE_EVIDENCE_ROOT || defaultEvidenceRoot);
const packagedLayoutApp = await resolvePackagedLayoutApp(process.env.NIMI_MACOS_LAYOUT_APP);

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('macOS negative Electron acceptance requires a native Apple Silicon host');
}
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

const temporaryRoots = [];
const report = {
  schemaVersion: 'nimi.macos-runtime-desktop-zhiyu-negative-electron/v1',
  capturedAt: new Date().toISOString(),
  posture: 'real_unsigned_electron_fail_closed_not_product_admission',
  evidenceRoot,
  processTreeBefore: relevantProcesses(),
  realm: await probeRealm(),
};

try {
  report.desktop = await captureDesktop();
  report.zhiyu = await captureZhiyu('primary', true);
  report.zhiyuPartitionIsolation = await captureZhiyu('isolated-partition', false);
  if (packagedLayoutApp) report.packagedDesktop = await captureDesktop({ packagedLayoutApp });
  report.processTreeAfter = relevantProcesses();
  report.orphanCheck = {
    desktop: await exited(report.desktop.processIds),
    zhiyu: await exited(report.zhiyu.processIds),
    zhiyuIsolatedPartition: await exited(report.zhiyuPartitionIsolation.processIds),
    ...(report.packagedDesktop ? { packagedDesktop: await exited(report.packagedDesktop.processIds) } : {}),
  };
  report.passed = Object.values(report.orphanCheck).every((value) => value === true)
    && report.desktop.bootstrapSurface === 'error'
    && report.desktop.desktopDom?.bodyText?.includes('protected-carrier-required')
    && report.desktop.runtimeStatus?.error?.reasonCode === 'protected-carrier-required'
    && report.zhiyu.localAppSession?.error?.reasonCode === 'protected-carrier-required'
    && report.zhiyu.appOwnedSQLite?.bootCount === 1
    && report.zhiyuPartitionIsolation.appOwnedSQLite?.bootCount === 1
    && report.zhiyu.appOwnedSQLite?.databasePath !== report.zhiyuPartitionIsolation.appOwnedSQLite?.databasePath
    && (!report.packagedDesktop
      || report.packagedDesktop.runtimeStatus?.error?.reasonCode === 'runtime-service-repair-required');
  await writeJson(path.join(evidenceRoot, 'acceptance-summary.json'), report);
  process.stdout.write(`${JSON.stringify({ evidenceRoot, passed: report.passed, posture: report.posture })}\n`);
  if (!report.passed) process.exitCode = 1;
} finally {
  for (const root of temporaryRoots) await rm(root, { recursive: true, force: true });
}

async function captureDesktop(input = {}) {
  const packaged = typeof input.packagedLayoutApp === 'string';
  const label = packaged ? 'packaged-desktop' : 'desktop';
  const userDataRoot = await privateTempRoot(label);
  const standardDataRoot = path.join(userDataRoot, 'standard-shell-data');
  await mkdir(standardDataRoot, { recursive: true, mode: 0o700 });
  const rendererUrl = new URL(pathToFileURL(path.join(desktopRoot, 'dist', 'index.html')).toString());
  rendererUrl.searchParams.set('nimiDesktopElectronAcceptance', '1');
  const executablePath = packaged
    ? path.join(input.packagedLayoutApp, 'Contents', 'MacOS', 'Nimi')
    : createRequire(path.join(desktopRoot, 'package.json'))('electron');
  const app = await electron.launch({
    executablePath,
    args: [
      ...(packaged ? [] : [path.join(desktopRoot, 'dist-electron', 'main.js')]),
      `--user-data-dir=${userDataRoot}`,
    ],
    env: acceptanceEnvironment(packaged ? {} : {
      NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererUrl.toString(),
      NIMI_DESKTOP_ELECTRON_STANDARD_DATA_ROOT: standardDataRoot,
      NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: standardDataRoot,
      NIMI_REALM_URL: 'http://127.0.0.1:3002',
      NIMI_REALTIME_URL: 'ws://127.0.0.1:3003',
    }),
  });
  const processId = app.process().pid;
  const hostLogs = captureHostLogs(app);
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    const problems = capturePageProblems(page);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
    const bootstrapSurface = await waitForDesktopBootstrapSurface(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(evidenceRoot, `${label}-desktop.png`), fullPage: true });
    const desktopDom = await domSummary(page);
    const accessibility = await cdpAccessibilityTree(app);
    const runtimeStatus = await invokeBridge(page, 'nimi.shell.runtimeLifecycle.status', {});
    const developerMode = await invokeBridge(page, 'developer_mode_status', {});
    const accountStatus = await invokeBridge(page, 'runtime_account_session_status', {});
    const rawGlobals = await page.evaluate(() => ({
      electron: 'electron' in globalThis.window,
      ipcRenderer: 'ipcRenderer' in globalThis.window,
      process: 'process' in globalThis.window,
      require: 'require' in globalThis.window,
      bridgeKeys: Object.keys(globalThis.window.__NIMI_ELECTRON_RUNTIME__ || {}).sort(),
    }));
    const loginTrigger = page.locator('[data-testid="login-logo-trigger"]');
    if (await loginTrigger.count()) {
      await loginTrigger.click();
      await page.getByText(
        /App is still starting|Runtime account service is unavailable|protected carrier|Runtime service/i,
      ).waitFor({ state: 'visible', timeout: 10_000 });
    }
    const interaction = await interactionSummary(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({ path: path.join(evidenceRoot, `${label}-390.png`), fullPage: true });
    const narrowDom = await domSummary(page);
    const tree = processTree(processId);
    await writeJson(path.join(evidenceRoot, `${label}-dom.json`), {
      desktopDom,
      narrowDom,
      accessibility,
      runtimeStatus,
      developerMode,
      accountStatus,
      rawGlobals,
      interaction,
      problems,
    });
    return {
      packaged,
      screenshots: [`${label}-desktop.png`, `${label}-390.png`],
      bootstrapSurface,
      desktopDom,
      narrowDom,
      accessibilityNodeCount: accessibility.length,
      runtimeStatus,
      developerMode,
      accountStatus,
      rawGlobals,
      interaction,
      problems,
      hostLogs,
      processTree: tree,
      processIds: tree.map((row) => row.pid),
    };
  } finally {
    await app.close();
  }
}

async function captureZhiyu(label, screenshots) {
  const userDataRoot = await privateTempRoot(`zhiyu-${label}`);
  const dataRoot = path.join(userDataRoot, 'standard-shell-data');
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const rendererUrl = new URL(pathToFileURL(path.join(zhiyuRoot, 'dist', 'index.html')).toString());
  rendererUrl.searchParams.set('nimiElectronSdkAcceptance', '1');
  const executablePath = createRequire(path.join(zhiyuRoot, 'package.json'))('electron');
  const app = await electron.launch({
    executablePath,
    args: [path.join(zhiyuRoot, 'dist-electron', 'main.js'), `--user-data-dir=${userDataRoot}`],
    env: acceptanceEnvironment({
      NIMI_ZHIYU_ELECTRON_RENDERER_URL: rendererUrl.toString(),
      NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
      NIMI_ZHIYU_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: dataRoot,
    }),
  });
  const processId = app.process().pid;
  const hostLogs = captureHostLogs(app);
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    const problems = capturePageProblems(page);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
    await page.waitForSelector('.runtime-unavailable-screen', { timeout: 60_000 });
    await page.setViewportSize({ width: 1280, height: 900 });
    if (screenshots) await page.screenshot({ path: path.join(evidenceRoot, 'zhiyu-desktop.png'), fullPage: true });
    const desktopDom = await domSummary(page);
    const accessibility = await cdpAccessibilityTree(app);
    const localAppSession = await invokeBridge(page, 'nimi.shell.localApp.sessionStatus', {});
    const runtimeReady = await page.evaluate(async () => {
      const acceptance = globalThis.window.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__;
      return acceptance && typeof acceptance.runtimeReady === 'function'
        ? acceptance.runtimeReady()
        : { unavailable: true };
    });
    const retry = page.locator('.runtime-unavailable-screen button').first();
    if (await retry.count()) {
      await retry.click();
      await page.waitForTimeout(500);
    }
    const interaction = await interactionSummary(page);
    await page.setViewportSize({ width: 390, height: 900 });
    if (screenshots) await page.screenshot({ path: path.join(evidenceRoot, 'zhiyu-390.png'), fullPage: true });
    const narrowDom = await domSummary(page);
    const appOwnedSQLite = await inspectZhiyuSQLite(userDataRoot);
    const tree = processTree(processId);
    const result = {
      label,
      screenshots: screenshots ? ['zhiyu-desktop.png', 'zhiyu-390.png'] : [],
      desktopDom,
      narrowDom,
      accessibilityNodeCount: accessibility.length,
      localAppSession,
      runtimeReady,
      appOwnedSQLite,
      permissionPromptCount: await page.locator('[role="dialog"]:has-text("权限")').count(),
      interaction,
      problems,
      hostLogs,
      processTree: tree,
      processIds: tree.map((row) => row.pid),
    };
    await writeJson(path.join(evidenceRoot, `zhiyu-${label}-dom.json`), { ...result, accessibility });
    return result;
  } finally {
    await app.close();
  }
}

async function domSummary(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    const documentElement = document.documentElement;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll('button,input,textarea,select')]
      .filter(visible)
      .slice(0, 100)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          text: String(element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 160),
          disabled: Boolean(element.disabled),
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      });
    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { width: documentElement.scrollWidth, height: documentElement.scrollHeight },
      horizontalOverflow: documentElement.scrollWidth - documentElement.clientWidth,
      bodyText: bodyText.slice(0, 30_000),
      controls,
      surfaces: {
        bootstrapError: Boolean(document.querySelector('[data-testid="app-bootstrap-error-screen"]')),
        login: Boolean(document.querySelector('[data-testid="login-screen"]')),
        main: Boolean(document.querySelector('[data-testid="main-shell"]')),
        firstRun: Boolean(document.querySelector('[data-testid="desktop-first-run-gate"]')),
        admissionFailed: Boolean(document.querySelector('[data-testid="desktop-admission-failed"]')),
        runtimeUnavailable: Boolean(document.querySelector('.runtime-unavailable-screen')),
      },
    };
  });
}

async function waitForDesktopBootstrapSurface(page) {
  const surface = await page.waitForFunction((selectors) => {
    for (const [name, selector] of Object.entries(selectors)) {
      if (document.querySelector(selector)) return name;
    }
    return null;
  }, {
    error: '[data-testid="app-bootstrap-error-screen"]',
    login: '[data-testid="login-screen"]',
    main: '[data-testid="main-shell"]',
    firstRun: '[data-testid="desktop-first-run-gate"]',
    admissionFailed: '[data-testid="desktop-admission-failed"]',
  }, { timeout: 60_000 });
  return surface.jsonValue();
}

async function interactionSummary(page) {
  return page.evaluate(() => {
    const controls = [...document.querySelectorAll('button,input,textarea,select')];
    const visible = controls.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    return {
      visibleControlCount: visible.length,
      enabledControlCount: visible.filter((element) => !element.disabled).length,
      undersizedControls: visible.map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName.toLowerCase(), width: rect.width, height: rect.height };
      }).filter((row) => row.width < 24 || row.height < 24),
      focusedTag: document.activeElement?.tagName?.toLowerCase() || null,
    };
  });
}

async function cdpAccessibilityTree(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('acceptance window unavailable');
    const client = window.webContents.debugger;
    const owned = !client.isAttached();
    if (owned) client.attach('1.3');
    try {
      await client.sendCommand('Accessibility.enable');
      const tree = await client.sendCommand('Accessibility.getFullAXTree');
      return (tree.nodes || []).slice(0, 500).map((node) => ({
        ignored: Boolean(node.ignored),
        role: node.role?.value || '',
        name: node.name?.value || '',
      }));
    } finally {
      if (owned && client.isAttached()) client.detach();
    }
  });
}

async function invokeBridge(page, command, payload) {
  return page.evaluate(async ({ commandName, commandPayload }) => {
    try {
      return { ok: true, value: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, commandPayload) };
    } catch (error) {
      return {
        ok: false,
        error: {
          name: typeof error?.name === 'string' ? error.name : '',
          message: typeof error?.message === 'string' ? error.message : String(error || ''),
          code: typeof error?.code === 'string' ? error.code : '',
          reasonCode: typeof error?.reasonCode === 'string' ? error.reasonCode : '',
          actionHint: typeof error?.actionHint === 'string' ? error.actionHint : '',
          source: typeof error?.source === 'string' ? error.source : '',
        },
      };
    }
  }, { commandName: command, commandPayload: payload });
}

function capturePageProblems(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || '' }));
  return { consoleErrors, pageErrors, failedRequests };
}

function captureHostLogs(app) {
  const output = { stderr: [], stdout: [] };
  app.process().stderr?.on('data', (chunk) => output.stderr.push(String(chunk).slice(0, 4_000)));
  app.process().stdout?.on('data', (chunk) => output.stdout.push(String(chunk).slice(0, 4_000)));
  return output;
}

async function inspectZhiyuSQLite(userDataRoot) {
  const databasePath = path.join(userDataRoot, 'app-owned', 'v1', 'zhiyu.sqlite3');
  const metadata = await stat(databasePath);
  const query = "SELECT (SELECT value FROM app_meta WHERE key='app_id') || '|' || (SELECT value FROM app_meta WHERE key='boot_count') || '|' || (SELECT user_version FROM pragma_user_version);";
  const result = spawnSync('/usr/bin/sqlite3', ['-readonly', databasePath, query], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Zhiyu app-owned SQLite inspection failed: ${String(result.stderr || '').trim()}`);
  const [appId, bootCount, schemaVersion] = String(result.stdout || '').trim().split('|');
  return {
    databasePath,
    appId,
    bootCount: Number(bootCount),
    schemaVersion: Number(schemaVersion),
    mode: metadata.mode & 0o777,
    uid: metadata.uid,
    sizeBytes: metadata.size,
  };
}

async function probeRealm() {
  try {
    const response = await fetch('http://127.0.0.1:3002/api/auth/jwks', { signal: AbortSignal.timeout(3_000) });
    const body = await response.json();
    return {
      url: 'http://127.0.0.1:3002/api/auth/jwks',
      status: response.status,
      keyCount: Array.isArray(body?.keys) ? body.keys.length : 0,
      reachable: response.ok && Array.isArray(body?.keys) && body.keys.length > 0,
    };
  } catch (error) {
    return { url: 'http://127.0.0.1:3002/api/auth/jwks', reachable: false, error: String(error) };
  }
}

function acceptanceEnvironment(overrides) {
  const env = {
    HOME: process.env.HOME,
    LANG: process.env.LANG || 'en_US.UTF-8',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: '/private/tmp',
    ...overrides,
  };
  return Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string' && value.length > 0));
}

async function privateTempRoot(label) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), `nimi-macos-${label}-`)));
  await chmod(root, 0o700);
  temporaryRoots.push(root);
  return root;
}

function processTree(rootPid) {
  const all = processRows();
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of all) {
      if (ids.has(row.ppid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        changed = true;
      }
    }
  }
  return all.filter((row) => ids.has(row.pid));
}

function relevantProcesses() {
  return processRows().filter((row) => /(?:Electron|Nimi|Zhiyu|vite|esbuild|nimi-runtime|realm)/iu.test(row.command));
}

function processRows() {
  const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,uid=,lstart=,command='], { encoding: 'utf8' });
  return output.split(/\r?\n/u).map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/u);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]), startedAt: match[4], command: match[5] } : null;
  }).filter(Boolean);
}

async function exited(processIds) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const live = new Set(processRows().map((row) => row.pid));
    if (processIds.every((pid) => !live.has(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function resolveEvidenceRoot(value) {
  const candidate = path.resolve(value);
  const relative = path.relative(acceptanceRoot, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('macOS acceptance evidence must remain below .nimi/local/acceptance');
  }
  return candidate;
}

async function resolvePackagedLayoutApp(value) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.trim() !== value || !path.isAbsolute(value)) {
    throw new Error('macOS layout app must be one exact absolute path');
  }
  const candidate = await realpath(path.resolve(value));
  const releaseRoot = await realpath(path.join(repoRoot, '.nimi', 'local', 'macos-electron-release'));
  const relative = path.relative(releaseRoot, candidate);
  if (path.basename(candidate) !== 'Nimi.app' || !relative
    || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('macOS layout app must remain below the local release root');
  }
  const manifest = JSON.parse(await readFile(path.join(path.dirname(candidate), 'layout-manifest.json'), 'utf8'));
  if (manifest?.posture !== 'requirements_only_fail_closed_unsigned_unnotarized_layout'
    || manifest?.acceptanceEligible !== false || manifest?.architecture !== 'arm64') {
    throw new Error('macOS layout app is not a fail-closed local layout');
  }
  const executable = path.join(candidate, 'Contents', 'MacOS', 'Nimi');
  const metadata = await stat(executable);
  if (!metadata.isFile() || await realpath(executable) !== executable) {
    throw new Error('macOS layout executable is not canonical');
  }
  return candidate;
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}
