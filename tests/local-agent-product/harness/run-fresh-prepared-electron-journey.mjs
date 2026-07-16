#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

import { writeFreshPreparedElectronArtifactBinding } from '../../../apps/desktop/scripts/lib/electron-build-mode.mjs';
import { resolvePortableProcessInvocation } from '../../../scripts/lib/portable-process-command.mjs';
import { assertSourceState, captureSourceState } from './source-state.mjs';
import {
  createParentSignalLatch,
  createTerminalEvidenceWriter,
  findBlockingElectronCarriers,
  projectOwnedProcessOutcome,
  recoverAbandonedTerminalEvidence,
  runBoundedOwnedProcess,
  writeOwnedProcessTerminal,
} from './fresh-prepared-electron-runner.mjs';
import { repoRoot } from './registry.mjs';

const targetArgs = process.argv.slice(2);
const target = targetArgs.join(' ');
const allowedTargets = new Set([
  'tests/local-agent-product/harness/run-first-run-connectivity.mjs',
  'tests/local-agent-product/harness/run-owner-minimal.mjs',
  'tests/local-agent-product/harness/run-gate.mjs --gate core',
]);
const targetTimeoutMs = new Map([
  ['tests/local-agent-product/harness/run-first-run-connectivity.mjs', 45 * 60_000],
  ['tests/local-agent-product/harness/run-owner-minimal.mjs', 30 * 60_000],
  ['tests/local-agent-product/harness/run-gate.mjs --gate core', 90 * 60_000],
]);
if (!allowedTargets.has(target)) {
  throw new Error(`fresh-prepared Electron journey target is not admitted: ${target || '<empty>'}`);
}
if (String(process.env.NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE || '').trim()) {
  throw new Error('fresh-prepared Electron journey owns NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE');
}
const sourceState = captureSourceState(repoRoot);
const requireFromDesktop = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
const electronVersion = String(requireFromDesktop('electron/package.json').version || '').trim();
const preparationId = randomBytes(16).toString('hex');
const bindingRoot = path.join(repoRoot, '.nimi', 'local', 'electron-desktop-runtime', electronVersion);
const terminalBaseRoot = path.join(
  repoRoot,
  '.nimi',
  'local',
  'evidence',
  'dev-kernel-runner-terminal',
);
recoverAbandonedTerminalEvidence(terminalBaseRoot);
const terminalRoot = path.join(
  terminalBaseRoot,
  `${sourceState.sourceDigest.slice(0, 12)}-${Date.now()}-${target.includes('first-run') ? 'first-run' : target.includes('owner-minimal') ? 'owner-minimal' : 'core'}`,
);
const terminal = createTerminalEvidenceWriter({
  evidenceRoot: terminalRoot,
  target,
  sourceDigest: sourceState.sourceDigest,
  preparationId,
});
const signalLatch = createParentSignalLatch();
let activeChildPid = 0;
let lastOwnedOutcome = null;
let terminalFailureOutcome = 'failed';

try {
  terminal.phase('carrier-preflight');
  requireElectronCarriersStopped('before fresh carrier preparation');
  terminal.phase('carrier-build');
  const buildInvocation = resolvePortableProcessInvocation('pnpm', ['build:dev-kernel-electron-carrier']);
  const build = await runBoundedOwnedProcess(buildInvocation.command, buildInvocation.args, {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeoutMs: 20 * 60_000,
    signalLatch,
    captureOutput: true,
    onStarted: (pid) => {
      activeChildPid = pid;
      terminal.phase('carrier-build', { child: { pid, owner: 'fresh-prepared-wrapper' } });
    },
  });
  lastOwnedOutcome = build;
  activeChildPid = 0;
  emitCapturedOutput(build);
  terminalFailureOutcome = failureOutcome(build);
  requireCompletedStage(build, 'carrier build');
  terminalFailureOutcome = 'failed';
  assertSourceState(sourceState, repoRoot);

  const artifactFiles = [
    path.join(repoRoot, 'apps', 'desktop', 'dist', 'index.html'),
    path.join(repoRoot, 'apps', 'desktop', 'dist-electron', 'main.js'),
    path.join(repoRoot, 'kit', 'shell', 'protected-local-node', 'npm', 'win32-x64', 'nimi_shell_protected_local.node'),
    path.join(repoRoot, 'apps', 'desktop', 'product-control-node', 'npm', 'win32-x64', 'nimi_desktop_product_control.node'),
    path.join(bindingRoot, 'Nimi Desktop Runtime.exe'),
  ];
  writeFreshPreparedElectronArtifactBinding(artifactFiles, {
    manifestPath: path.join(bindingRoot, 'fresh-prepared-artifact-binding.json'),
    repoRoot,
    sourceDigest: sourceState.sourceDigest,
    preparationId,
  });
  terminal.phase('journey', { child: null });
  const result = await runBoundedOwnedProcess(process.execPath, targetArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE: 'fresh-prepared',
      NIMI_DEV_KERNEL_ELECTRON_PREPARATION_ID: preparationId,
      NIMI_LOCAL_AGENT_PRODUCT_SOURCE_DIGEST: sourceState.sourceDigest,
      NIMI_DEV_KERNEL_PARENT_TERMINAL_EVIDENCE: terminal.evidencePath,
    },
    timeoutMs: targetTimeoutMs.get(target),
    signalLatch,
    captureOutput: true,
    onStarted: (pid) => {
      activeChildPid = pid;
      terminal.phase('journey', { child: { pid, owner: 'fresh-prepared-wrapper' } });
    },
  });
  lastOwnedOutcome = result;
  activeChildPid = 0;
  emitCapturedOutput(result);
  terminalFailureOutcome = failureOutcome(result);
  const projection = projectOwnedProcessOutcome(result);
  terminal.phase('cleanup', { exit: projection.exit });
  requireElectronCarriersStopped('after fresh-prepared journey cleanup');
  const exit = requireCompletedStage(result, 'fresh-prepared Electron journey', { allowNonZero: true });
  writeOwnedProcessTerminal(terminal, result, { child: null });
  process.stdout.write(`fresh-prepared terminal evidence: ${terminal.evidencePath}\n`);
  process.exitCode = exit.code ?? 1;
} catch (error) {
  const signal = signalLatch.current();
  const message = error instanceof Error ? error.message : String(error);
  const projection = lastOwnedOutcome ? projectOwnedProcessOutcome(lastOwnedOutcome) : null;
  const projectedFailure = projection && projection.outcome !== 'completed'
    ? projection.outcome
    : terminalFailureOutcome;
  if (lastOwnedOutcome) {
    writeOwnedProcessTerminal(terminal, lastOwnedOutcome, {
      outcomeOverride: signal ? 'parent-signal' : projectedFailure,
      phase: terminal.snapshot().phase,
      child: activeChildPid ? { pid: activeChildPid, owner: 'fresh-prepared-wrapper' } : null,
      failure: { code: boundedErrorCode(message), message },
    });
  } else {
    terminal.terminal(signal ? 'parent-signal' : terminalFailureOutcome, {
      phase: terminal.snapshot().phase,
      child: activeChildPid ? { pid: activeChildPid, owner: 'fresh-prepared-wrapper' } : null,
      exit: { code: null, signal },
      failure: { code: boundedErrorCode(message), message },
    });
  }
  process.stderr.write(`fresh-prepared terminal evidence: ${terminal.evidencePath}\n`);
  process.stderr.write(`${message}\n`);
  process.exitCode = signal ? 128 + signalNumber(signal) : 1;
} finally {
  signalLatch.dispose();
}

function requireElectronCarriersStopped(stage) {
  const deadline = Date.now() + 10_000;
  let latest = [];
  do {
    const probe = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
    ], { encoding: 'utf8', windowsHide: true });
    if (probe.error) throw probe.error;
    if (probe.status !== 0) throw new Error(`Electron carrier process checkpoint failed ${stage}`);
    const text = String(probe.stdout || '').trim();
    const rows = text ? JSON.parse(text) : [];
    latest = findBlockingElectronCarriers(rows, repoRoot);
    if (latest.length === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  } while (Date.now() < deadline);
  throw new Error(`Electron carrier process checkpoint failed ${stage}: ${JSON.stringify(latest.map((row) => ({
    processId: row.processId,
    name: row.name,
  })))}`);
}

function emitCapturedOutput(outcome) {
  if (outcome?.result?.stdout) process.stdout.write(outcome.result.stdout);
  if (outcome?.result?.stderr) process.stderr.write(outcome.result.stderr);
}

function requireCompletedStage(outcome, label, { allowNonZero = false } = {}) {
  if (outcome.kind === 'timeout') throw new Error(`${label} timed out`);
  if (outcome.kind === 'parent-signal') throw new Error(`${label} interrupted by ${outcome.signal}`);
  if (outcome.kind === 'spawn-error' || outcome.kind === 'owner-callback-error') throw outcome.error;
  const exit = projectExit(outcome);
  if (exit.signal) throw new Error(`${label} terminated by ${exit.signal}`);
  if (!allowNonZero && exit.code !== 0) throw new Error(`${label} failed with ${exit.code}`);
  return exit;
}

function projectExit(outcome) {
  return {
    code: Number.isInteger(outcome?.result?.code) ? outcome.result.code : null,
    signal: typeof outcome?.result?.signal === 'string' ? outcome.result.signal : null,
  };
}

function failureOutcome(outcome) {
  if (outcome?.kind === 'timeout') return 'timed-out';
  if (outcome?.kind === 'parent-signal') return 'parent-signal';
  if (outcome?.kind === 'spawn-error') return 'spawn-failed';
  if (outcome?.kind === 'owner-callback-error') return 'runner-failed';
  if (outcome?.result?.signal) return 'child-signal';
  return 'failed';
}

function boundedErrorCode(message) {
  return String(message || '').match(/^([A-Za-z][A-Za-z0-9_-]{0,127})/u)?.[1] || 'fresh-prepared-runner-failed';
}

function signalNumber(signal) {
  return ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15, SIGBREAK: 21 })[signal] || 1;
}
