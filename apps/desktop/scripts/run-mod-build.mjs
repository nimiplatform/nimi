#!/usr/bin/env node
/* global process */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveModsRoot } from './mod-paths.mjs';

function run() {
  const modsRoot = resolveModsRoot({ required: true, mustExist: true });
  const buildScriptPath = path.join(modsRoot, 'scripts', 'build-mod.mjs');
  if (!existsSync(buildScriptPath)) {
    throw new Error(`build script not found: ${buildScriptPath}`);
  }

  const child = spawn(process.execPath, [buildScriptPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (error) => {
    process.stderr.write(
      `[run-mod-build] failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

try {
  run();
} catch (error) {
  process.stderr.write(
    `[run-mod-build] failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
