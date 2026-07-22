#!/usr/bin/env node

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { sha256Digest, stableJsonDigest } from '@nimiplatform/app-tools/simulator-conformance';
import { DIST_ROOT, REPO_ROOT } from './paths.mjs';

const require = createRequire(import.meta.url);
const playwrightVersion = require('playwright/package.json').version;
const CHECKPOINT = 'CP5-Z';
const evidenceSlug = 'simulator-cp5-z';
const EVIDENCE_ROOT = path.join(REPO_ROOT, '.nimi', 'local', 'state', evidenceSlug);
const RECEIPT_PATH = path.join(EVIDENCE_ROOT, 'qualification.json');
const SCREENSHOT_PATH = path.join(EVIDENCE_ROOT, 'qualified.png');
const TRACE_CATEGORIES = [
  '-*',
  'blink',
  'cc',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
].join(',');
const PAINT_COMPOSITE_EVENTS = new Set([
  'Paint',
  'PaintImage',
  'CompositeLayers',
  'DrawFrame',
  'RasterTask',
]);

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}:object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}:fields`);
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function serveArtifact() {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (!requested || requested.includes('..') || path.isAbsolute(requested)) {
        response.writeHead(400).end('invalid path');
        return;
      }
      const candidate = path.resolve(DIST_ROOT, ...requested.split('/'));
      if (!candidate.startsWith(`${path.resolve(DIST_ROOT)}${path.sep}`)) {
        response.writeHead(400).end('invalid path');
        return;
      }
      const filePath = statSync(candidate).isFile() ? candidate : path.join(DIST_ROOT, 'index.html');
      const bytes = readFileSync(filePath);
      response.writeHead(200, {
        'content-type': contentType(filePath),
        'cache-control': 'no-store',
        'content-length': bytes.length,
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SIM_CP5_Z_SERVER_ADDRESS');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function readTraceStream(cdp, handle) {
  const chunks = [];
  while (true) {
    const row = await cdp.send('IO.read', { handle });
    chunks.push(row.base64Encoded ? Buffer.from(row.data, 'base64') : Buffer.from(row.data));
    if (row.eof) break;
  }
  await cdp.send('IO.close', { handle });
  return Buffer.concat(chunks);
}

function clockSyncId(event) {
  return event?.args?.sync_id ?? event?.args?.syncId ?? event?.args?.data?.sync_id ?? null;
}

function traceWindowEvidence(events, token, firstFrame, secondFrame) {
  const firstId = `${token}:first`;
  const secondId = `${token}:second`;
  const firstMarker = events.find((event) => event.name === 'clock_sync' && clockSyncId(event) === firstId);
  const secondMarker = events.find((event) => event.name === 'clock_sync' && clockSyncId(event) === secondId);
  if (!firstMarker || !secondMarker || !(secondMarker.ts > firstMarker.ts)) {
    const markerSamples = events
      .filter((event) => JSON.stringify(event).includes(token) || /clock/i.test(event.name ?? ''))
      .slice(0, 12)
      .map((event) => ({ name: event.name, category: event.cat, timestamp: event.ts, args: event.args }));
    return {
      ok: false,
      reason: 'clock-sync-marker-missing',
      firstFrame,
      secondFrame,
      events: [],
      markerSamples,
    };
  }
  const matched = events
    .filter((event) => event.ts >= firstMarker.ts
      && event.ts <= secondMarker.ts
      && PAINT_COMPOSITE_EVENTS.has(event.name))
    .map((event) => event.name)
    .sort();
  return {
    ok: matched.length > 0,
    reason: matched.length > 0 ? null : 'paint-composite-event-missing',
    firstFrame,
    secondFrame,
    markerIntervalMicros: secondMarker.ts - firstMarker.ts,
    events: [...new Set(matched)],
  };
}

function createTraceQualification(cdp) {
  let sequence = 0;
  let tail = Promise.resolve();
  let active = null;
  const evidence = [];

  async function begin(input) {
    exactObject(input, ['instanceId', 'surfaceId'], 'SIM_CP5_Z_TRACE_BEGIN');
    if (typeof input.instanceId !== 'string' || typeof input.surfaceId !== 'string') {
      throw new Error('SIM_CP5_Z_TRACE_BEGIN_VALUE');
    }
    let release;
    const slot = new Promise((resolve) => { release = resolve; });
    const prior = tail;
    tail = prior.then(() => slot);
    await prior;
    if (active) {
      release();
      throw new Error('SIM_CP5_Z_TRACE_OVERLAP');
    }
    const token = `cp5-z-trace-${++sequence}`;
    const completed = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.start', {
      categories: TRACE_CATEGORIES,
      transferMode: 'ReturnAsStream',
    });
    active = { token, input, release, completed, frames: {} };
    return token;
  }

  async function mark(input) {
    exactObject(input, ['observationToken', 'ordinal', 'frame'], 'SIM_CP5_Z_TRACE_MARK');
    if (!active || input.observationToken !== active.token
      || !['first', 'second'].includes(input.ordinal)
      || !Number.isFinite(input.frame)
      || Object.hasOwn(active.frames, input.ordinal)) return false;
    await cdp.send('Tracing.recordClockSyncMarker', { syncId: `${active.token}:${input.ordinal}` });
    active.frames[input.ordinal] = input.frame;
    if (input.ordinal === 'first') {
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      active.probeScreenshotDigest = sha256Digest(Buffer.from(screenshot.data, 'base64'));
    }
    return true;
  }

  async function end(input) {
    exactObject(input, ['observationToken', 'firstFrame', 'secondFrame'], 'SIM_CP5_Z_TRACE_END');
    const current = active;
    if (!current || input.observationToken !== current.token) return false;
    active = null;
    try {
      await cdp.send('Tracing.end');
      const complete = await current.completed;
      if (!complete.stream) throw new Error('SIM_CP5_Z_TRACE_STREAM_MISSING');
      const bytes = await readTraceStream(cdp, complete.stream);
      const trace = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(trace.traceEvents)) throw new Error('SIM_CP5_Z_TRACE_EVENTS_MISSING');
      if (input.firstFrame === null || input.secondFrame === null) {
        evidence.push({
          token: current.token,
          instanceId: current.input.instanceId,
          surfaceId: current.input.surfaceId,
          ok: false,
          reason: 'cancelled',
          traceDigest: sha256Digest(bytes),
        });
        return false;
      }
      if (current.frames.first !== input.firstFrame || current.frames.second !== input.secondFrame) {
        throw new Error('SIM_CP5_Z_TRACE_FRAME_DRIFT');
      }
      const window = traceWindowEvidence(trace.traceEvents, current.token, input.firstFrame, input.secondFrame);
      evidence.push({
        token: current.token,
        instanceId: current.input.instanceId,
        surfaceId: current.input.surfaceId,
        traceDigest: sha256Digest(bytes),
        probeScreenshotDigest: current.probeScreenshotDigest ?? null,
        ...window,
      });
      if (!current.probeScreenshotDigest) {
        evidence[evidence.length - 1].ok = false;
        evidence[evidence.length - 1].reason = 'probe-screenshot-missing';
      }
      return evidence[evidence.length - 1].ok;
    } finally {
      current.release();
    }
  }

  return { begin, mark, end, evidence };
}

async function waitForQualifiedInstances(page, traceEvidence, pageDiagnostics, expectedCount = 2) {
  await page.locator('.simulator-surface').first().waitFor({ state: 'visible', timeout: 30_000 });
  try {
    await page.waitForFunction((count) => (
      document.querySelectorAll('.simulator-surface').length === count
      && document.querySelectorAll('.simulator-windows__item[data-instance-status="active"][data-readiness-status="usable"]').length === count
    ), expectedCount, { timeout: 30_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      surfaces: document.querySelectorAll('.simulator-surface').length,
      instances: [...document.querySelectorAll('.simulator-windows__item')].map((node) => ({
        id: node.getAttribute('data-instance-id'),
        status: node.getAttribute('data-instance-status'),
        readiness: node.getAttribute('data-readiness-status'),
      })),
    }));
    await page.getByRole('link', { name: 'Diagnostics' }).click();
    const diagnostics = await page.locator('.simulator-diagnostics__item').allTextContents();
    throw new Error(`SIM_CP5_Z_READINESS_TIMEOUT:${JSON.stringify({ expectedCount, state: { ...state, diagnostics }, traceEvidence, pageDiagnostics, cause: String(error) })}`);
  }
}

async function replayDigest(page) {
  const value = await page.locator('.simulator-shell').getAttribute('data-replay-digest');
  if (!value || !/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error('SIM_CP5_Z_REPLAY_DIGEST_MISSING');
  return value;
}

async function qualify() {
  const artifactManifest = JSON.parse(readFileSync(path.join(DIST_ROOT, 'simulator-artifact-manifest.json'), 'utf8'));
  if (artifactManifest.schema !== 'nimi.simulator.artifact-manifest/v1'
    || artifactManifest.selectedModuleCount !== 3
    || typeof artifactManifest.scenarioDigest !== 'string') {
    throw new Error('SIM_CP5_Z_ARTIFACT_NOT_QUALIFIABLE');
  }

  const server = await serveArtifact();
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const pageDiagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') pageDiagnostics.push(`${message.type()}:${message.text()}`);
  });
  page.on('pageerror', (error) => pageDiagnostics.push(`pageerror:${error.stack ?? error.message}`));
  const cdp = await context.newCDPSession(page);
  const traces = createTraceQualification(cdp);
  await page.exposeBinding('__NIMI_SIMULATOR_QUALIFICATION_BEGIN_V1__', (_source, input) => traces.begin(input));
  await page.exposeBinding('__NIMI_SIMULATOR_QUALIFICATION_MARK_V1__', (_source, input) => traces.mark(input));
  await page.exposeBinding('__NIMI_SIMULATOR_QUALIFICATION_END_V1__', (_source, input) => traces.end(input));

  const closeDesktopSubset = async () => {
    while (await page.locator('.simulator-windows__item[data-module-id="desktop"]:not([data-instance-status="disposed"])').count() > 0) {
      const before = await page.locator('.simulator-surface').count();
      await page.locator('.simulator-windows__item[data-module-id="desktop"]:not([data-instance-status="disposed"])').first().getByRole('button', { name: 'Close' }).click();
      await page.waitForFunction((count) => document.querySelectorAll('.simulator-surface').length === count, before - 1);
    }
  };

  try {
    await page.goto(server.origin, { waitUntil: 'load', timeout: 30_000 });
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 6);
    await closeDesktopSubset();
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 4);
    const initialReplayDigest = await replayDigest(page);
    const initialStateRevision = Number(await page.locator('.simulator-shell').getAttribute('data-state-revision'));
    if (!Number.isSafeInteger(initialStateRevision) || initialStateRevision <= 0) {
      throw new Error('SIM_CP5_Z_INITIAL_REVISION_MISSING');
    }
    const initialInstanceIds = await page.locator('.simulator-windows__item').evaluateAll((nodes) => (
      nodes.map((node) => node.getAttribute('data-instance-id'))
    ));
    const testerSurfaces = page.locator('.simulator-surface[data-module-id="tester"]');
    const first = testerSurfaces.nth(0);
    const second = testerSurfaces.nth(1);
    const firstPrompt = first.locator('textarea[aria-label="Text Studio request"]');
    const secondPrompt = second.locator('textarea[aria-label="Text Studio request"]');
    const secondBaseline = await secondPrompt.inputValue();
    const isolatedPrompt = 'CP5-Z artifact-bound first-instance prompt';
    await firstPrompt.fill(isolatedPrompt);
    if (await secondPrompt.inputValue() !== secondBaseline) throw new Error('SIM_CP5_Z_TESTER_INSTANCE_ISOLATION_FAILED');
    await first.locator('button[aria-label="Generate text"]').click();
    await first.locator('.studio-result__text').filter({
      hasText: 'Nimi connects apps through one shared, simulated ecosystem state.',
    }).waitFor({ timeout: 30_000 });
    await first.getByText('Simulator result', { exact: true }).waitFor({ timeout: 30_000 });
    const testerActionStateRevision = Number(await page.locator('.simulator-shell').getAttribute('data-state-revision'));
    if (!Number.isSafeInteger(testerActionStateRevision) || testerActionStateRevision <= initialStateRevision) {
      throw new Error('SIM_CP5_Z_TESTER_ACTION_REVISION_NOT_ADVANCED');
    }

    const zhiyuSurfaces = page.locator('.simulator-surface[data-module-id="zhiyu"]');
    if (await zhiyuSurfaces.count() !== 2) throw new Error('SIM_CP5_Z_INSTANCE_COUNT');
    const firstZhiyu = zhiyuSurfaces.nth(0);
    const secondZhiyu = zhiyuSurfaces.nth(1);
    const firstZhiyuComposer = firstZhiyu.locator('textarea[aria-label="和这个伙伴聊点什么..."]');
    const secondZhiyuComposer = secondZhiyu.locator('textarea[aria-label="和这个伙伴聊点什么..."]');
    const secondZhiyuBaseline = await secondZhiyuComposer.inputValue();
    const isolatedZhiyuPrompt = '只在第一个织羽实例中提交这条消息。';
    await firstZhiyuComposer.fill(isolatedZhiyuPrompt);
    if (await secondZhiyuComposer.inputValue() !== secondZhiyuBaseline) {
      throw new Error('SIM_CP5_Z_DRAFT_ISOLATION_FAILED');
    }
    await firstZhiyu.getByRole('button', { name: 'Send' }).click();
    const zhiyuResponse = '我已收到你的消息。这次回复来自同一条可回放的 Nimi 模拟生态状态链。';
    await firstZhiyu.getByText(zhiyuResponse, { exact: true }).waitFor({ timeout: 30_000 });
    if (await secondZhiyu.getByText(zhiyuResponse, { exact: true }).count() !== 0) {
      throw new Error('SIM_CP5_Z_TRANSCRIPT_ISOLATION_FAILED');
    }
    const actionStateRevision = Number(await page.locator('.simulator-shell').getAttribute('data-state-revision'));
    if (!Number.isSafeInteger(actionStateRevision) || actionStateRevision <= testerActionStateRevision) {
      throw new Error('SIM_CP5_Z_ACTION_REVISION_NOT_ADVANCED');
    }

    await page.locator('.simulator-windows__item:not([data-instance-status="disposed"])').first().getByRole('button', { name: 'Close' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.simulator-surface').length === 3);
    await page.locator('button[data-simulator-action="reset"]').click();
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 6);
    await closeDesktopSubset();
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 4);
    const resetInstanceIds = await page.locator('.simulator-windows__item[data-instance-status="active"]').evaluateAll((nodes) => (
      nodes.map((node) => node.getAttribute('data-instance-id'))
    ));
    if (resetInstanceIds.some((id) => initialInstanceIds.includes(id))) throw new Error('SIM_CP5_Z_RESET_INSTANCE_REUSE');
    if (await page.getByText('Simulator result', { exact: true }).count() !== 0) throw new Error('SIM_CP5_Z_TESTER_RESET_VISIBLE_STATE');
    if (await page.getByText(zhiyuResponse, { exact: true }).count() !== 0) throw new Error('SIM_CP5_Z_RESET_VISIBLE_STATE');

    for (let index = 0; index < 4; index += 1) {
      await page.locator('.simulator-windows__item[data-instance-status="active"]').first().getByRole('button', { name: 'Close' }).click();
      await page.waitForFunction((count) => document.querySelectorAll('.simulator-surface').length === count, 3 - index);
    }
    if (await page.locator('.simulator-surface__overlays').count() !== 0) throw new Error('SIM_CP5_Z_OVERLAY_RESOURCE_LEAK');

    await page.getByRole('button', { name: 'Open Nimi Lab' }).click();
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 1);
    await page.locator('.simulator-windows__item[data-instance-status="active"]').getByRole('button', { name: 'Close' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.simulator-surface').length === 0);

    await page.reload({ waitUntil: 'load', timeout: 30_000 });
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 6);
    await closeDesktopSubset();
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 4);
    const reproducedReplayDigest = await replayDigest(page);
    if (reproducedReplayDigest !== initialReplayDigest) throw new Error('SIM_CP5_Z_REPLAY_NOT_REPRODUCIBLE');
    if (pageDiagnostics.length !== 0) {
      throw new Error(`SIM_CP5_Z_BROWSER_DIAGNOSTICS:${JSON.stringify(pageDiagnostics)}`);
    }
    if (await page.locator('.simulator-diagnostics__item').count() !== 0) {
      throw new Error('SIM_CP5_Z_PRODUCT_DIAGNOSTICS');
    }

    mkdirSync(EVIDENCE_ROOT, { recursive: true });
    const screenshot = await page.screenshot({ fullPage: true });
    writeFileSync(SCREENSHOT_PATH, screenshot);
    const browserExecutable = readFileSync(chromium.executablePath());
    const proof = {
      schema: 'nimi.simulator.cp5-z-qualification/v1',
      checkpoint: CHECKPOINT,
      artifactRootDigest: artifactManifest.artifactRootDigest,
      selectedModuleRegistryDigest: artifactManifest.selectedModuleRegistryDigest,
      scenarioDigest: artifactManifest.scenarioDigest,
      browser: {
        engine: 'chromium',
        version: browser.version(),
        playwrightVersion,
        executableDigest: sha256Digest(browserExecutable),
        headless: true,
        viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      },
      interaction: {
        initialInstanceCount: 4,
        testerInstanceCount: 2,
        zhiyuInstanceCount: 2,
        isolatedPrompt,
        secondInstancePromptUnchanged: true,
        visibleGeneratedText: true,
        isolatedZhiyuPrompt,
        secondZhiyuDraftUnchanged: true,
        secondZhiyuTranscriptUnchanged: true,
        visibleZhiyuResponse: true,
        browserDiagnosticCount: 0,
        productDiagnosticCount: 0,
        initialStateRevision,
        resetAllocatedFreshInstanceIds: true,
        closeResourceBaseline: { surfaces: 0, overlayRoots: 0 },
        reopenAndClose: true,
      },
      replay: {
        initialDigest: initialReplayDigest,
        visibleActionStateRevision: actionStateRevision,
        reproducedInitialDigest: reproducedReplayDigest,
        reproduced: true,
      },
      traces: traces.evidence,
      screenshot: {
        path: `.nimi/local/state/${evidenceSlug}/qualified.png`,
        digest: sha256Digest(screenshot),
      },
    };
    if (proof.traces.length < 13 || proof.traces.some((row) => row.ok !== true)) {
      throw new Error('SIM_CP5_Z_TRACE_EVIDENCE_INCOMPLETE');
    }
    const receipt = {
      ...proof,
      receiptDigest: stableJsonDigest('nimi-simulator-cp5-z-qualification-v1', proof),
    };
    writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stdout.write(`${evidenceSlug}: OK (${proof.traces.length} trace windows, receipt ${receipt.receiptDigest})\n`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
}

await qualify();
