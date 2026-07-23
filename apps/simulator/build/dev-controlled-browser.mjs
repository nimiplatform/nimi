#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

import {
  createBrowserTraceQualification,
  installQualificationBindings,
} from './browser-trace-qualification.mjs';
import { loadQualificationInputs } from './qualification.mjs';
import { CONFIG_ROOT, GENERATED_ROOT, REPO_ROOT, SIMULATOR_ROOT } from './paths.mjs';
import { readSimulatorPublicEnvironment } from './public-env.mjs';
import {
  assertDesktopAuthenticatedShells,
  assertNoBrowserAuthPersistence,
  exerciseDesktopAuthIsolation,
  observeDesktopAuthRequests,
} from './desktop-auth-browser-acceptance.mjs';

const RESTART_EXIT_CODE = 75;
const WORKER_ARG = '--controlled-dev-worker';
const DEV_BROWSER_ARGS = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
const DEV_CONTEXT_OPTIONS = Object.freeze({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'dark',
  reducedMotion: 'reduce',
  serviceWorkers: 'block',
});

export function isChromiumAppSpecificDevToolsCspDiagnostic(text, simulatorOrigin) {
  const match = /^Connecting to '([^']+)' violates the following Content Security Policy directive: "connect-src 'none'"\. The request has been blocked\.$/u.exec(text.trim());
  if (!match) return false;
  try {
    const target = new URL(match[1]);
    return target.origin === simulatorOrigin
      && target.pathname === '/.well-known/appspecific/com.chrome.devtools.json'
      && target.search === ''
      && target.hash === '';
  } catch {
    return false;
  }
}

function expectedScenarioInstanceCount() {
  const scenario = JSON.parse(readFileSync(path.join(GENERATED_ROOT, 'evidence', 'scenario.json'), 'utf8'));
  const count = scenario?.scenario?.launch?.length;
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error('SIM_DEV_SCENARIO_LAUNCH_INVALID');
  return count;
}

function canonicalAbsolute(filePath) {
  return path.resolve(filePath).split(path.sep).join('/');
}

function qualificationWatchRoots() {
  const inputs = loadQualificationInputs();
  const roots = new Set([
    CONFIG_ROOT,
    path.join(REPO_ROOT, '.nimi', 'spec', 'platform', 'kernel', 'tables'),
    path.join(REPO_ROOT, 'apps', 'web', 'src'),
    path.join(REPO_ROOT, 'apps', 'web', 'package.json'),
    path.join(REPO_ROOT, 'apps', 'web', 'vite.config.ts'),
    path.join(REPO_ROOT, 'apps', 'web', 'index.html'),
    path.join(REPO_ROOT, 'app-tools', 'lib'),
    path.join(REPO_ROOT, 'app-tools', 'package.json'),
    path.join(REPO_ROOT, 'pnpm-lock.yaml'),
    path.join(SIMULATOR_ROOT, 'build'),
    path.join(SIMULATOR_ROOT, 'index.html'),
    path.join(SIMULATOR_ROOT, 'package.json'),
    path.join(SIMULATOR_ROOT, 'vite.config.ts'),
  ]);
  for (const descriptor of inputs.descriptors) {
    for (const source of descriptor.sources) {
      if (source.kind === 'workspace' && source.repository_key === 'nimi') {
        roots.add(path.join(REPO_ROOT, ...source.root.split('/')));
      }
    }
  }
  return [...roots].map(canonicalAbsolute).sort();
}

function isWithin(filePath, roots) {
  const canonical = canonicalAbsolute(filePath);
  return roots.some((root) => canonical === root || canonical.startsWith(`${root}/`));
}

function serverOrigin(viteServer) {
  const address = viteServer.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('SIM_DEV_SERVER_ADDRESS');
  return `http://127.0.0.1:${address.port}`;
}

async function collectReadinessState(page) {
  if (page.isClosed()) return { pageClosed: true };
  return page.evaluate(() => ({
    url: window.location.href,
    bodyText: document.body.textContent?.slice(0, 500) ?? '',
    surfaces: document.querySelectorAll('.simulator-surface').length,
    usableActiveInstances: Number(
      document.querySelector('.simulator-shell')?.getAttribute('data-usable-active-instance-count'),
    ),
    instances: [...document.querySelectorAll('.simulator-windows__item')].map((node) => ({
      id: node.getAttribute('data-instance-id'),
      status: node.getAttribute('data-instance-status'),
      readiness: node.getAttribute('data-readiness-status'),
    })),
  }));
}

async function waitForUsable(page, expectedCount, traces, diagnostics, evidenceOffset) {
  try {
    await page.waitForFunction((count) => (
      document.querySelectorAll('.simulator-surface').length === count
      && Number(document.querySelector('.simulator-shell')?.getAttribute('data-usable-active-instance-count')) === count
    ), expectedCount, { timeout: 30_000 });
    await traces.whenIdle();
  } catch (error) {
    const state = await collectReadinessState(page);
    throw new Error(`SIM_DEV_READINESS_TIMEOUT:${JSON.stringify({
      expectedCount,
      state,
      traces: traces.evidence.slice(evidenceOffset),
      diagnostics,
      cause: String(error),
    })}`);
  }
  const newEvidence = traces.evidence.slice(evidenceOffset);
  if (newEvidence.length !== expectedCount || newEvidence.some((row) => row.ok !== true)) {
    throw new Error(`SIM_DEV_TRACE_EVIDENCE_INCOMPLETE:${JSON.stringify({ expectedCount, traces: newEvidence })}`);
  }
  if (diagnostics.length > 0) {
    throw new Error(`SIM_DEV_BROWSER_DIAGNOSTICS:${JSON.stringify(diagnostics)}`);
  }
}

export async function startControlledDevSession({
  headless = false,
  watch = true,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const expectedCount = expectedScenarioInstanceCount();
  const qualificationRoots = qualificationWatchRoots();
  const viteServer = await createServer({
    root: SIMULATOR_ROOT,
    configFile: path.join(SIMULATOR_ROOT, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  });
  let browser;
  let context;
  let page;
  let traces;
  let closed = false;
  let completionSettled = false;
  let resolveCompletion;
  const completion = new Promise((resolve) => { resolveCompletion = resolve; });
  const settle = (value) => {
    if (completionSettled) return;
    completionSettled = true;
    resolveCompletion(value);
  };
  const diagnostics = [];
  const warnings = [];
  let reloadTail = Promise.resolve();
  let changeTimer = null;
  let pendingChange = null;

  const close = async (reason = 'closed') => {
    if (closed) return;
    closed = true;
    if (changeTimer) clearTimeout(changeTimer);
    viteServer.watcher.removeAllListeners('all');
    try {
      await traces?.close();
    } finally {
      await page?.close().catch(() => {});
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
      await viteServer.close();
      settle({ reason });
    }
  };

  try {
    await viteServer.listen();
    const origin = serverOrigin(viteServer);
    browser = await chromium.launch({ headless, args: DEV_BROWSER_ARGS });
    context = await browser.newContext(DEV_CONTEXT_OPTIONS);
    await context.addInitScript((publicEnvironment) => {
      globalThis.__NIMI_SIMULATOR_PUBLIC_CONFIG__ = Object.freeze(publicEnvironment);
    }, readSimulatorPublicEnvironment());
    page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        if (isChromiumAppSpecificDevToolsCspDiagnostic(message.text(), origin)) return;
        const location = message.location();
        const source = location.url ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})` : '';
        diagnostics.push(`error:${message.text()}${source}`);
      }
      if (message.type() === 'warning') warnings.push(`warning:${message.text()}`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) diagnostics.push(`http:${response.status()}:${response.url()}`);
    });
    page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.stack ?? error.message}`));
    page.on('crash', () => {
      diagnostics.push('renderer-crash');
      settle({ reason: 'failed', error: new Error('SIM_DEV_RENDERER_CRASH') });
    });
    browser.on('disconnected', () => {
      if (!closed) settle({ reason: 'browser-closed' });
    });
    const requestAudit = observeDesktopAuthRequests(page, origin);
    const cdp = await context.newCDPSession(page);
    traces = createBrowserTraceQualification({
      cdp,
      errorPrefix: 'SIM_DEV',
      tokenPrefix: 'dev-trace',
    });
    await installQualificationBindings(page, traces);
    const evidenceOffset = traces.evidence.length;
    await page.goto(origin, { waitUntil: 'load', timeout: 30_000 });
    await waitForUsable(page, expectedCount, traces, diagnostics, evidenceOffset);
    await exerciseDesktopAuthIsolation(page);
    await assertNoBrowserAuthPersistence(page);
    requestAudit.assertNone();
    const resetTraceOffset = traces.evidence.length;
    await page.locator('button[data-simulator-action="reset"]').click();
    await waitForUsable(page, expectedCount, traces, diagnostics, resetTraceOffset);
    await assertDesktopAuthenticatedShells(page);
    await assertNoBrowserAuthPersistence(page);
    requestAudit.assertNone();

    const reload = async (changedPath = '<manual>') => {
      reloadTail = reloadTail.then(async () => {
        if (closed || page.isClosed()) return;
        await traces.whenIdle();
        const diagnosticsOffset = diagnostics.length;
        const traceOffset = traces.evidence.length;
        log(`simulator-dev: full reload (${path.relative(REPO_ROOT, changedPath) || changedPath})`);
        await page.reload({ waitUntil: 'load', timeout: 30_000 });
        await waitForUsable(page, expectedCount, traces, diagnostics.slice(diagnosticsOffset), traceOffset);
      }).catch((error) => {
        settle({ reason: 'failed', error });
      });
      return reloadTail;
    };

    if (watch) {
      viteServer.watcher.add(qualificationRoots);
      viteServer.watcher.on('all', (_event, changedPath) => {
        if (closed || canonicalAbsolute(changedPath).startsWith(`${canonicalAbsolute(GENERATED_ROOT)}/`)) return;
        const kind = isWithin(changedPath, qualificationRoots) ? 'restart' : 'reload';
        if (!pendingChange || kind === 'restart') pendingChange = { kind, changedPath };
        if (changeTimer) clearTimeout(changeTimer);
        changeTimer = setTimeout(() => {
          const change = pendingChange;
          pendingChange = null;
          changeTimer = null;
          if (!change || closed) return;
          if (change.kind === 'restart') {
            log(`simulator-dev: qualification input changed (${path.relative(REPO_ROOT, change.changedPath)}); restarting`);
            settle({ reason: 'restart', changedPath: change.changedPath });
          } else {
            void reload(change.changedPath);
          }
        }, 100);
      });
    }

    log(`simulator-dev: usable (${expectedCount} instances, ${headless ? 'headless' : 'headed'} Chromium, ${origin})`);
    return { browser, context, page, traces, origin, completion, close, reload, diagnostics, warnings };
  } catch (error) {
    await close('failed').catch(() => {});
    throw error;
  }
}

function runChild(args) {
  const scriptPath = fileURLToPath(import.meta.url);
  return spawn(process.execPath, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: 'inherit',
  });
}

async function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function runWorker() {
  const headless = process.env.NIMI_SIMULATOR_DEV_HEADLESS === '1';
  const session = await startControlledDevSession({ headless, watch: true });
  const onSignal = () => { void session.close('signal'); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const result = await session.completion;
  await session.close(result.reason);
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  if (result.reason === 'failed') throw result.error;
  if (result.reason === 'restart') return RESTART_EXIT_CODE;
  return 0;
}

async function runPreparation() {
  const preparation = spawn(process.execPath, [path.join(SIMULATOR_ROOT, 'build', 'prepare-dev-modules.mjs')], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  const result = await waitForChild(preparation);
  return result.code ?? 1;
}

async function runSupervisor() {
  let child = null;
  let stopping = false;
  const stop = (signal) => {
    stopping = true;
    child?.kill(signal);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  while (!stopping) {
    child = runChild([WORKER_ARG]);
    const result = await waitForChild(child);
    child = null;
    if (stopping || result.signal) return 0;
    if (result.code !== RESTART_EXIT_CODE) return result.code ?? 1;
    const preparationCode = await runPreparation();
    if (preparationCode !== 0) return preparationCode;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = process.argv.includes(WORKER_ARG) ? await runWorker() : await runSupervisor();
  process.exitCode = exitCode;
}
