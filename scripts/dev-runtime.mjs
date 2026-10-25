#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = realpathSync(path.resolve(scriptDir, '..'));
const runtimeRoot = path.join(repoRoot, 'runtime');
const desktopManifest = path.join(repoRoot, 'apps', 'desktop', 'package.json');
const requireFromDesktop = createRequire(desktopManifest);
const SOURCE_RUNTIME_REALM_URL = 'http://127.0.0.1:3002';

export function parseSourceRuntimeArguments(argv = []) {
  const remaining = argv.filter((argument) => argument !== '--');
  if (remaining.length > 0) {
    throw sourceRuntimeError(
      `Unsupported dev:runtime argument: ${remaining[0]}`,
      'source-runtime-argument-invalid',
      'run_pnpm_dev_runtime_without_overrides',
    );
  }
  return {};
}

export function resolveSourceRuntimeLaunch(input = {}) {
  const platform = input.platform ?? process.platform;
  const architecture = input.architecture ?? process.arch;
  const root = realpathSync(input.repoRoot ?? repoRoot);
  const admitted = (platform === 'win32' && architecture === 'x64')
    || (platform === 'darwin' && architecture === 'arm64');
  if (!admitted) {
    throw sourceRuntimeError(
      `source Runtime development is unavailable for ${platform}/${architecture}`,
      'source-runtime-platform-unsupported',
      'use_an_admitted_windows_x64_or_macos_arm64_development_host',
    );
  }
  const electronExecutable = realpathSync(
    input.electronExecutable ?? requireFromDesktop('electron'),
  );
  const tempRoot = input.tempRoot ?? path.join(
    os.tmpdir(),
    `nimi-source-runtime-supervisor-${process.pid}-${Date.now()}`,
  );
  const supervisorExecutable = path.join(
    tempRoot,
    platform === 'win32' ? 'nimi-source-runtime-supervisor.exe' : 'nimi-source-runtime-supervisor',
  );
  return {
    repoRoot: root,
    runtimeRoot: path.join(root, 'runtime'),
    electronExecutable,
    tempRoot,
    supervisorExecutable,
    build: {
      command: 'go',
      args: ['build', '-o', supervisorExecutable, './cmd/nimi-source-supervisor'],
    },
    run: {
      command: supervisorExecutable,
      args: [
        '--repo-root', root,
        '--desktop-executable', electronExecutable,
        '--realm-url', SOURCE_RUNTIME_REALM_URL,
      ],
    },
  };
}

export async function runSourceRuntimeDevelopment(input = {}) {
  parseSourceRuntimeArguments(input.argv ?? process.argv.slice(2));
  input.signal?.throwIfAborted();
  const tempRoot = input.tempRoot ?? (input.createTemp ?? (() => (
    mkdtempSync(path.join(os.tmpdir(), 'nimi-source-runtime-supervisor-'))
  )))();
  const plan = resolveSourceRuntimeLaunch({ ...input, tempRoot });
  const makeTemp = input.makeTemp ?? (() => {
    mkdirSync(plan.tempRoot, { recursive: true, mode: 0o700 });
  });
  const removeTemp = input.removeTemp ?? (() => rmSync(plan.tempRoot, { recursive: true, force: true }));
  const build = input.spawnSync ?? spawnSync;
  const launch = input.spawn ?? spawn;
  makeTemp();
  try {
    const built = build(plan.build.command, plan.build.args, {
      cwd: plan.runtimeRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (built.error || built.status !== 0) {
      throw sourceRuntimeError(
        `source Runtime supervisor build failed: ${built.error?.message || `exit ${built.status}`}`,
        'source-runtime-supervisor-build-failed',
        'fix_source_runtime_supervisor_build',
      );
    }
    input.signal?.throwIfAborted();
    const child = launch(plan.run.command, plan.run.args, {
      cwd: plan.repoRoot,
      env: process.env,
      stdio: ['pipe', 'inherit', 'inherit'],
      windowsHide: true,
      // An enclosing Desktop launcher owns shutdown order. Its Runtime must
      // not receive terminal signals before Desktop has released its hosts.
      detached: Boolean(input.signal),
    });
    return await waitForSupervisor(child, input.signal);
  } finally {
    removeTemp();
  }
}

// Exit 3 means no source supervisor exists; other failures must not be
// mistaken for permission to stop an unrelated installed Runtime service.
export function stopSourceRuntimeDevelopment(args = [], input = {}) {
  if (!['win32', 'darwin'].includes(input.platform ?? process.platform)) return 3;
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-source-runtime-stop-'));
  const executable = path.join(tempRoot, process.platform === 'win32' ? 'supervisor.exe' : 'supervisor');
  const execute = input.spawnSync ?? spawnSync;
  try {
    const built = execute('go', ['build', '-o', executable, './cmd/nimi-source-supervisor'], {
      cwd: runtimeRoot, env: process.env, stdio: 'inherit', windowsHide: true,
    });
    if (built.error || built.status !== 0) {
      throw sourceRuntimeError(
        `source Runtime stop helper build failed: ${built.error?.message || `exit ${built.status}`}`,
        'source-runtime-supervisor-build-failed', 'fix_source_runtime_supervisor_build',
      );
    }
    const stopped = execute(executable, ['stop', ...args.filter((arg) => arg !== '--')], {
      cwd: repoRoot, env: process.env, stdio: 'inherit', windowsHide: true,
    });
    if (stopped.error) throw stopped.error;
    return stopped.status ?? 1;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function waitForSupervisor(child, abortSignal) {
  return new Promise((resolve, reject) => {
    let stopping = false;
    const handlers = new Map();
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
      abortSignal?.removeEventListener('abort', stop);
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      child.stdin?.end();
    };
    for (const signal of abortSignal ? [] : ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = stop;
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
    child.once('error', (error) => {
      cleanup();
      reject(sourceRuntimeError(
        `source Runtime supervisor launch failed: ${error.message}`,
        'source-runtime-supervisor-launch-failed',
        'inspect_source_runtime_supervisor_launch',
      ));
    });
    child.once('exit', (code, signal) => {
      cleanup();
      if (code === 0) {
        resolve(0);
        return;
      }
      reject(sourceRuntimeError(
        `source Runtime supervisor exited with ${code ?? signal ?? 'unknown'}`,
        'source-runtime-supervisor-exited',
        'inspect_source_runtime_supervisor_output',
      ));
    });
    abortSignal?.addEventListener('abort', stop, { once: true });
    if (abortSignal?.aborted) stop();
  });
}

function sourceRuntimeError(message, reasonCode, actionHint) {
  return Object.assign(new Error(message), { reasonCode, actionHint });
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    process.exitCode = await runSourceRuntimeDevelopment();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'failed',
      reasonCode: error?.reasonCode || 'source-runtime-development-failed',
      actionHint: error?.actionHint || 'inspect_source_runtime_development_failure',
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}
