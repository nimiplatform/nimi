#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import url from 'node:url';
import YAML from 'yaml';
import { chromium } from 'playwright';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AVATAR_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(AVATAR_ROOT, '../..');
const MATRIX_REL = '.nimi/spec/avatar/kernel/tables/acceptance-recording-matrix.yaml';
const MATRIX_PATH = path.join(REPO_ROOT, MATRIX_REL);
const DEFAULT_MIN_DURATION_MS = 6_400;
const VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_OUT_ROOT = path.join(
  REPO_ROOT,
  '.local',
  'evidence',
  'avatar',
  'acceptance-recording-matrix',
);

const REQUIRED_SCENARIO_IDS = [
  'idle_vrm_ready',
  'idle_live2d_ready',
  'hover_body',
  'click_body',
  'drag_stage',
  'foreground_voice_listen',
  'tts_speaking_lipsync',
  'interrupt_active_turn',
  'runtime_degraded',
];

const AUTOMATED_SCENARIOS = new Map([
  ['idle_vrm_ready', {
    evidenceKind: 'fixture_recording',
    viteEnv: { VITE_AVATAR_DRIVER: 'mock', VITE_AVATAR_MOCK_SCENARIO: 'vrm-lifecycle' },
    probeState: 'idle',
    expected: { ready: true, presenceState: 'idle', privacyIndicator: 'mic_idle' },
  }],
  ['hover_body', {
    evidenceKind: 'fixture_recording',
    viteEnv: { VITE_AVATAR_DRIVER: 'mock', VITE_AVATAR_MOCK_SCENARIO: 'vrm-lifecycle' },
    probeState: 'idle',
    interaction: 'hover',
    expected: { ready: true, presenceState: 'idle', privacyIndicator: 'mic_idle' },
  }],
  ['click_body', {
    evidenceKind: 'fixture_recording',
    viteEnv: { VITE_AVATAR_DRIVER: 'mock', VITE_AVATAR_MOCK_SCENARIO: 'vrm-lifecycle' },
    probeState: 'idle',
    interaction: 'click',
    expected: { ready: true, presenceState: 'idle', privacyIndicator: 'mic_idle' },
  }],
  ['drag_stage', {
    evidenceKind: 'fixture_recording',
    viteEnv: { VITE_AVATAR_DRIVER: 'mock', VITE_AVATAR_MOCK_SCENARIO: 'vrm-lifecycle' },
    probeState: 'idle',
    interaction: 'drag',
    expected: { ready: true, presenceState: 'idle', privacyIndicator: 'mic_idle' },
  }],
  ['foreground_voice_listen', {
    evidenceKind: 'fixture_recording',
    viteEnv: { VITE_AVATAR_DRIVER: 'mock', VITE_AVATAR_MOCK_SCENARIO: 'vrm-lifecycle' },
    probeState: 'foreground_listening',
    interaction: 'voice-level',
    expected: {
      ready: true,
      presenceState: 'foreground_listening',
      privacyIndicator: 'mic_active',
    },
  }],
  ['tts_speaking_lipsync', {
    evidenceKind: 'fixture_recording',
    viteEnv: { VITE_AVATAR_DRIVER: 'mock', VITE_AVATAR_MOCK_SCENARIO: 'vrm-lifecycle' },
    probeState: 'assistant_speaking',
    expected: {
      ready: true,
      presenceState: 'assistant_speaking',
      privacyIndicator: 'speaker_active',
      lipsyncActive: 'true',
    },
  }],
  ['interrupt_active_turn', {
    evidenceKind: 'fixture_recording',
    viteEnv: { VITE_AVATAR_DRIVER: 'mock', VITE_AVATAR_MOCK_SCENARIO: 'vrm-lifecycle' },
    probeState: 'assistant_speaking',
    interaction: 'interrupt',
    expected: {
      ready: true,
      presenceState: 'interrupted',
      privacyIndicator: 'speaker_unavailable',
    },
  }],
  ['runtime_degraded', {
    evidenceKind: 'browser_runtime_degraded_recording',
    viteEnv: {},
    expected: {
      ready: false,
      composition: 'degraded_runtime_unavailable',
      degradedMounted: true,
      stageMounted: false,
      companionMounted: false,
    },
  }],
]);

function parseArgs(argv) {
  const args = {
    automatedOnly: false,
    allowManualPending: false,
    checkOnly: false,
    outDir: '',
    evidenceLedger: '',
    scenarioIds: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--automated-only') {
      args.automatedOnly = true;
    } else if (arg === '--allow-manual-pending') {
      args.allowManualPending = true;
    } else if (arg === '--check-only') {
      args.checkOnly = true;
    } else if (arg === '--out') {
      args.outDir = argv[++i] || '';
    } else if (arg === '--evidence-ledger') {
      args.evidenceLedger = argv[++i] || '';
    } else if (arg === '--scenario') {
      args.scenarioIds.push(argv[++i] || '');
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function readMatrix() {
  const raw = fs.readFileSync(MATRIX_PATH, 'utf8');
  return YAML.parse(raw);
}

function validateMatrix(matrix) {
  const errors = [];
  if (matrix?.catalog_id !== 'avatar_acceptance_recording_matrix') {
    errors.push(`catalog_id must be avatar_acceptance_recording_matrix in ${MATRIX_REL}`);
  }
  const scenarios = Array.isArray(matrix?.scenarios) ? matrix.scenarios : [];
  const ids = scenarios.map((scenario) => String(scenario?.id || '').trim()).filter(Boolean);
  for (const requiredId of REQUIRED_SCENARIO_IDS) {
    if (!ids.includes(requiredId)) {
      errors.push(`missing required scenario: ${requiredId}`);
    }
  }
  for (const id of ids) {
    if (!REQUIRED_SCENARIO_IDS.includes(id)) {
      errors.push(`unexpected scenario id in matrix: ${id}`);
    }
  }
  const formats = Array.isArray(matrix?.artifact_requirements?.format)
    ? matrix.artifact_requirements.format.map(String)
    : [];
  if (!formats.includes('webm') && !formats.includes('mp4')) {
    errors.push('artifact_requirements.format must admit webm or mp4');
  }
  if (Number(matrix?.artifact_requirements?.minimum_resolution?.split?.('x')?.[0]) < 1280) {
    errors.push('artifact_requirements.minimum_resolution must be at least 1280x720');
  }
  if (Number(matrix?.artifact_requirements?.minimum_duration_seconds || 0) < 6) {
    errors.push('artifact_requirements.minimum_duration_seconds must be at least 6');
  }
  return { scenarios, errors };
}

function resolvePnpmCommand() {
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', prefixArgs: ['/d', '/s', '/c', 'pnpm.cmd'] };
  }
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && path.basename(npmExecPath).toLowerCase().includes('pnpm')) {
    return { command: process.execPath, prefixArgs: [npmExecPath] };
  }
  return {
    command: 'pnpm',
    prefixArgs: [],
  };
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function httpReady(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1_000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(port, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    if (child.exitCode !== null) {
      throw new Error(`vite exited before serving port ${port}`);
    }
    if (await httpReady(port)) return;
    await delay(250);
  }
  throw new Error(`timed out waiting for vite on http://127.0.0.1:${port}/`);
}

function startViteServer(definition) {
  const pnpm = resolvePnpmCommand();
  const portPromise = findFreePort();
  return portPromise.then(async (port) => {
    const env = {
      ...process.env,
      VITE_AVATAR_ACCEPTANCE_PROBE: '1',
      ...definition.viteEnv,
    };
    if (!definition.viteEnv.VITE_AVATAR_DRIVER) {
      delete env.VITE_AVATAR_DRIVER;
      delete env.VITE_AVATAR_MOCK_SCENARIO;
      delete env.VITE_AVATAR_ACCEPTANCE_PROBE;
    }
    const child = spawn(
      pnpm.command,
      [
        ...pnpm.prefixArgs,
        '--filter',
        '@nimiplatform/avatar',
        'exec',
        'vite',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort',
      ],
      {
        cwd: REPO_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    try {
      await waitForServer(port, child);
      return { child, port, output: () => output };
    } catch (error) {
      stopProcessTree(child);
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`);
    }
  });
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  ];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  return candidates.filter(Boolean).find((candidate) => fs.existsSync(candidate)) || null;
}

async function launchBrowser() {
  const executablePath = findChromeExecutable();
  try {
    return await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
  } catch (error) {
    throw new Error([
      '[avatar-acceptance] unable to launch Chromium for recording.',
      executablePath ? `tried executable: ${executablePath}` : 'no system Chrome/Chromium executable was found.',
      'Install Playwright Chromium with: pnpm --filter @nimiplatform/avatar exec playwright install chromium',
      `cause: ${error instanceof Error ? error.message : String(error)}`,
    ].join('\n'));
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, label) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

async function installOverlay(page, scenarioId, evidenceKind) {
  await page.addStyleTag({
    content: `
      #nimi-avatar-acceptance-overlay {
        position: fixed;
        left: 14px;
        bottom: 14px;
        z-index: 2147483647;
        max-width: min(560px, calc(100vw - 28px));
        border: 1px solid rgba(36, 54, 74, 0.16);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.88);
        color: #152033;
        font: 12px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
        padding: 8px 10px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
        pointer-events: none;
        white-space: pre-wrap;
      }
    `,
  });
  await page.evaluate(({ id, kind }) => {
    const existing = document.getElementById('nimi-avatar-acceptance-overlay');
    existing?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'nimi-avatar-acceptance-overlay';
    overlay.textContent = `scenario: ${id}\nevidence: ${kind}\nstate: booting`;
    document.body.appendChild(overlay);
    window.__NIMI_AVATAR_RECORDING_OVERLAY__ = {
      update(text) {
        overlay.textContent = text;
      },
    };
  }, { id: scenarioId, kind: evidenceKind });
}

async function updateOverlay(page, scenarioId, evidenceKind, observed) {
  await page.evaluate(({ id, kind, state }) => {
    window.__NIMI_AVATAR_RECORDING_OVERLAY__?.update([
      `scenario: ${id}`,
      `evidence: ${kind}`,
      `composition: ${state.composition}`,
      `presence: ${state.presenceState || 'none'}`,
      `privacy: ${state.privacyIndicator || 'none'}`,
      `lipsync: ${state.lipsyncActive || 'false'}`,
    ].join('\n'));
  }, { id: scenarioId, kind: evidenceKind, state: observed });
}

async function waitForProbe(page) {
  await page.waitForFunction(
    () => Boolean(window.__NIMI_AVATAR_ACCEPTANCE_PROBE__),
    null,
    { timeout: 20_000 },
  );
}

async function setProbeState(page, state) {
  await waitForProbe(page);
  await page.evaluate((nextState) => {
    window.__NIMI_AVATAR_ACCEPTANCE_PROBE__?.setPresenceState(nextState);
  }, state);
}

async function bodyBox(page) {
  const box = await page.locator('[data-testid="avatar-body-hit-region"]').boundingBox();
  if (!box) {
    throw new Error('avatar body hit region is not visible');
  }
  return box;
}

async function runInteraction(page, definition) {
  const interaction = definition.interaction;
  if (!interaction) return;
  if (interaction === 'hover') {
    const box = await bodyBox(page);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.38);
    return;
  }
  if (interaction === 'click') {
    const box = await bodyBox(page);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.34);
    return;
  }
  if (interaction === 'drag') {
    const box = await bodyBox(page);
    const startX = box.x + box.width * 0.48;
    const startY = box.y + box.height * 0.46;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 72, startY + 36, { steps: 10 });
    await page.mouse.move(startX + 18, startY + 18, { steps: 8 });
    await page.mouse.up();
    return;
  }
  if (interaction === 'voice-level') {
    for (const level of [0.24, 0.58, 0.86, 0.43]) {
      await page.evaluate((nextLevel) => {
        window.__NIMI_AVATAR_ACCEPTANCE_PROBE__?.setVoiceLevel(nextLevel);
      }, level);
      await delay(450);
    }
    return;
  }
  if (interaction === 'interrupt') {
    await page.waitForSelector('.avatar-companion-surface__interrupt', { timeout: 10_000 });
    await delay(800);
    await page.locator('.avatar-companion-surface__interrupt').click();
    await page.evaluate(() => {
      window.__NIMI_AVATAR_ACCEPTANCE_PROBE__?.setPresenceState('interrupted');
    });
  }
}

async function readObservedState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="avatar-root"]');
    const companion = document.querySelector('[data-testid="avatar-companion-surface"]');
    const stage = document.querySelector('[data-testid="avatar-embodiment-stage"]');
    const degraded = document.querySelector('[data-testid="avatar-degraded-surface"]');
    const canvas = document.querySelector('canvas');
    const probe = window.__NIMI_AVATAR_ACCEPTANCE_PROBE__?.snapshot?.() ?? null;
    return {
      composition: root?.getAttribute('data-composition') || null,
      presenceState: companion?.getAttribute('data-presence-state') || null,
      presenceTone: companion?.getAttribute('data-presence-tone') || null,
      privacyIndicator: companion?.getAttribute('data-privacy-indicator') || null,
      audioPlaybackState: companion?.getAttribute('data-audio-playback-state') || null,
      lipsyncActive: companion?.getAttribute('data-lipsync-active') || null,
      voiceLevel: companion?.getAttribute('data-voice-level') || null,
      stageMounted: Boolean(stage),
      companionMounted: Boolean(companion),
      degradedMounted: Boolean(degraded),
      composerMounted: Boolean(document.querySelector('[data-testid="avatar-companion-composer"]')),
      cueMounted: Boolean(document.querySelector('[data-testid="avatar-companion-bubble"]')),
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      probe,
    };
  });
}

function assertExpectedObserved(scenarioId, expected, observed) {
  const errors = [];
  if (expected.ready === true) {
    if (!observed.stageMounted) errors.push('embodiment-stage is not mounted');
    if (!observed.companionMounted) errors.push('companion-surface is not mounted');
    if (observed.degradedMounted) errors.push('degraded-surface is mounted in a ready scenario');
    if (!observed.canvas || observed.canvas.width < VIEWPORT.width || observed.canvas.height < VIEWPORT.height) {
      errors.push(`ready scenario requires a nonblank backend canvas at least ${VIEWPORT.width}x${VIEWPORT.height}`);
    }
  }
  if (expected.ready === false) {
    if (observed.stageMounted !== expected.stageMounted) errors.push(`stageMounted expected ${expected.stageMounted}, got ${observed.stageMounted}`);
    if (observed.companionMounted !== expected.companionMounted) errors.push(`companionMounted expected ${expected.companionMounted}, got ${observed.companionMounted}`);
    if (observed.degradedMounted !== expected.degradedMounted) errors.push(`degradedMounted expected ${expected.degradedMounted}, got ${observed.degradedMounted}`);
  }
  for (const key of ['composition', 'presenceState', 'privacyIndicator', 'lipsyncActive']) {
    if (expected[key] !== undefined && observed[key] !== expected[key]) {
      errors.push(`${key} expected ${expected[key]}, got ${observed[key]}`);
    }
  }
  if (observed.composerMounted) {
    errors.push('composer tray is mounted in default acceptance posture');
  }
  if (errors.length > 0) {
    throw new Error(`[${scenarioId}] observed state mismatch:\n- ${errors.join('\n- ')}`);
  }
}

async function recordScenario(browser, matrixScenario, definition, outDir) {
  const scenarioId = matrixScenario.id;
  console.log(`[avatar-acceptance] recording ${scenarioId} (${definition.evidenceKind})`);
  const scenarioDir = path.join(outDir, scenarioId);
  const tempVideoDir = path.join(scenarioDir, '.video');
  fs.mkdirSync(tempVideoDir, { recursive: true });
  const server = await startViteServer(definition);
  let context = null;
  let page = null;
  let videoPath = '';
  try {
    context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      recordVideo: {
        dir: tempVideoDir,
        size: VIEWPORT,
      },
    });
    page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForSelector('[data-testid="avatar-root"]', { timeout: 30_000 });

    if (definition.expected.ready) {
      await page.waitForSelector('[data-testid="avatar-embodiment-stage"]', { timeout: 30_000 });
      await page.waitForSelector('[data-testid="avatar-companion-presence-capsule"]', { timeout: 30_000 });
      await setProbeState(page, definition.probeState || 'idle');
    } else {
      await page.waitForSelector('[data-testid="avatar-degraded-surface"]', { timeout: 30_000 });
    }

    await installOverlay(page, scenarioId, definition.evidenceKind);
    await delay(500);
    await runInteraction(page, definition);
    await delay(500);
    const observed = await readObservedState(page);
    assertExpectedObserved(scenarioId, definition.expected, observed);
    await updateOverlay(page, scenarioId, definition.evidenceKind, observed);
    await page.screenshot({
      path: path.join(scenarioDir, `${scenarioId}.png`),
      fullPage: false,
    });
    await delay(DEFAULT_MIN_DURATION_MS);
    const video = page.video();
    await withTimeout(context.close(), 30_000, `[${scenarioId}] video context close`);
    if (!video) {
      throw new Error(`[${scenarioId}] Playwright did not create a video handle`);
    }
    videoPath = await video.path();
    const finalVideoPath = path.join(scenarioDir, `${scenarioId}.webm`);
    fs.copyFileSync(videoPath, finalVideoPath);
    const stat = fs.statSync(finalVideoPath);
    if (stat.size < 10_000) {
      throw new Error(`[${scenarioId}] recording is unexpectedly small: ${stat.size} bytes`);
    }
    console.log(`[avatar-acceptance] recorded ${scenarioId}: ${path.relative(REPO_ROOT, finalVideoPath).replace(/\\/g, '/')}`);
    return {
      id: scenarioId,
      status: 'recorded',
      evidence_kind: definition.evidenceKind,
      backend: matrixScenario.backend,
      mode: matrixScenario.mode,
      viewport: VIEWPORT,
      duration_target_ms: DEFAULT_MIN_DURATION_MS,
      video: path.relative(REPO_ROOT, finalVideoPath).replace(/\\/g, '/'),
      screenshot: path.relative(REPO_ROOT, path.join(scenarioDir, `${scenarioId}.png`)).replace(/\\/g, '/'),
      video_sha256: sha256File(finalVideoPath),
      observed,
    };
  } finally {
    if (context) {
      await withTimeout(context.close(), 5_000, `[${scenarioId}] final context close`).catch(() => {});
    }
    stopProcessTree(server.child);
    fs.rmSync(tempVideoDir, { recursive: true, force: true });
  }
}

function readManualEvidenceLedger(absPath) {
  if (!absPath) return {};
  const parsed = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  return parsed && typeof parsed === 'object' && parsed.recordings && typeof parsed.recordings === 'object'
    ? parsed.recordings
    : {};
}

function validateManualEvidence(scenario, evidence) {
  const artifactPath = String(evidence?.path || '').trim();
  if (!artifactPath) {
    return {
      id: scenario.id,
      status: 'manual_required',
      backend: scenario.backend,
      mode: scenario.mode,
      reason: 'no manual evidence path supplied',
    };
  }
  const resolved = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.resolve(REPO_ROOT, artifactPath);
  if (!fs.existsSync(resolved)) {
    return {
      id: scenario.id,
      status: 'manual_required',
      backend: scenario.backend,
      mode: scenario.mode,
      reason: `manual evidence file does not exist: ${artifactPath}`,
    };
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext !== '.webm' && ext !== '.mp4') {
    return {
      id: scenario.id,
      status: 'manual_required',
      backend: scenario.backend,
      mode: scenario.mode,
      reason: `manual evidence must be .webm or .mp4: ${artifactPath}`,
    };
  }
  return {
    id: scenario.id,
    status: 'recorded',
    evidence_kind: String(evidence.evidence_kind || 'manual_runtime_recording'),
    backend: scenario.backend,
    mode: scenario.mode,
    video: path.relative(REPO_ROOT, resolved).replace(/\\/g, '/'),
    video_sha256: sha256File(resolved),
  };
}

function writeLedger(outDir, rows, completionState, matrix) {
  const ledger = {
    catalog_id: 'avatar_acceptance_recording_matrix_ledger',
    matrix: MATRIX_REL,
    generated_at: new Date().toISOString(),
    completion_state: completionState,
    artifact_requirements: matrix.artifact_requirements,
    rows,
  };
  fs.writeFileSync(path.join(outDir, 'ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  const md = [
    '# Avatar Acceptance Recording Matrix',
    '',
    `Generated at: ${ledger.generated_at}`,
    `Completion state: ${completionState}`,
    '',
    '| Scenario | Status | Evidence | Video |',
    '| --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.id} | ${row.status} | ${row.evidence_kind || row.reason || ''} | ${row.video || ''} |`),
    '',
    'Fixture recordings are development evidence only. Live2D and real Runtime release acceptance must link human-reviewed mp4/webm artifacts.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'ledger.md'), md);
  return ledger;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matrix = readMatrix();
  const { scenarios, errors } = validateMatrix(matrix);
  if (errors.length > 0) {
    throw new Error(`[avatar-acceptance] invalid matrix:\n- ${errors.join('\n- ')}`);
  }
  if (args.checkOnly) {
    console.log(`[avatar-acceptance] matrix ok: ${scenarios.length} scenarios in ${MATRIX_REL}`);
    return;
  }

  const requestedIds = args.scenarioIds.length > 0
    ? new Set(args.scenarioIds)
    : new Set(REQUIRED_SCENARIO_IDS);
  const outDir = args.outDir
    ? path.resolve(REPO_ROOT, args.outDir)
    : path.join(DEFAULT_OUT_ROOT, timestampSlug());
  fs.mkdirSync(outDir, { recursive: true });

  const manualEvidence = readManualEvidenceLedger(
    args.evidenceLedger ? path.resolve(REPO_ROOT, args.evidenceLedger) : '',
  );
  const rows = [];
  const browser = await launchBrowser();
  try {
    for (const scenario of scenarios) {
      if (!requestedIds.has(scenario.id)) continue;
      const definition = AUTOMATED_SCENARIOS.get(scenario.id);
      if (!definition) {
        rows.push(validateManualEvidence(scenario, manualEvidence[scenario.id]));
        continue;
      }
      rows.push(await recordScenario(browser, scenario, definition, outDir));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const manualPending = rows.some((row) => row.status === 'manual_required');
  const selectedAllRequired =
    requestedIds.size === REQUIRED_SCENARIO_IDS.length
    && REQUIRED_SCENARIO_IDS.every((id) => requestedIds.has(id));
  const completionState = !selectedAllRequired
    ? 'partial_selected_scenarios_recorded'
    : manualPending
      ? 'partial_manual_recording_required'
      : 'complete_recording_matrix';
  const ledger = writeLedger(outDir, rows, completionState, matrix);
  console.log(`[avatar-acceptance] ledger: ${path.join(outDir, 'ledger.json')}`);
  console.log(`[avatar-acceptance] completion_state=${ledger.completion_state}`);

  if (manualPending && !args.allowManualPending) {
    const pending = rows
      .filter((row) => row.status === 'manual_required')
      .map((row) => `${row.id}: ${row.reason}`)
      .join('\n- ');
    throw new Error([
      '[avatar-acceptance] manual recording evidence is still required.',
      `- ${pending}`,
      'Pass --allow-manual-pending only for development fixture evidence generation.',
    ].join('\n'));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
