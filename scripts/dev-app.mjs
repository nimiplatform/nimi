#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnCommand } from './lib/command-runner.mjs';
import {
  assertDevAppCdpPortAvailable,
  devAppLaunchSummary,
  resolveDevAppLaunch,
} from './lib/dev-app-launch.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [appName = '', ...argv] = process.argv.slice(2);

try {
  const plan = resolveDevAppLaunch(appName, argv, {
    env: process.env,
    platform: process.platform,
  });
  if (plan.kind === 'help') {
    process.stdout.write(plan.output);
  } else {
    await assertDevAppCdpPortAvailable(plan.cdpPort);
    process.stdout.write(devAppLaunchSummary(plan));
    process.exitCode = await runLaunchPlan(plan);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown development launcher error');
  process.stderr.write(`[dev-app] failed: ${message}\n`);
  process.exitCode = 1;
}

function runLaunchPlan(plan) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(plan.command, plan.args, {
      cwd: repoRoot,
      env: { ...process.env, ...plan.envOverrides },
      stdio: 'inherit',
      windowsHide: true,
      ...(plan.windowsVerbatimArguments === undefined
        ? {}
        : { windowsVerbatimArguments: plan.windowsVerbatimArguments }),
    });
    const signalHandlers = new Map();
    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill(process.platform === 'win32' ? 'SIGTERM' : signal);
        }
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('exit', (code, signal) => {
      cleanup();
      resolve(code ?? signalExitCode(signal));
    });
  });
}

function signalExitCode(signal) {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  if (signal === 'SIGHUP') return 129;
  return 1;
}
