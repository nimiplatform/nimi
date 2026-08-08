#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishBuildOutput, temporaryOutputPath } from '../../scripts/lib/build-output-publisher.mjs';
import { spawnSyncCommand } from '../../scripts/lib/command-runner.mjs';
import { withSdkDistLock } from '../../scripts/lib/sdk-dist-lock.mjs';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const outDir = path.join(kitRoot, 'dist');
const stagingDir = temporaryOutputPath(outDir, 'staging');

function run(command, args) {
  const result = spawnSyncCommand(command, args, {
    cwd: kitRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'unknown'}`);
  }
}

try {
  await withSdkDistLock('Kit canonical build', () => {
    run(pnpmBin, ['exec', 'tsc', '-p', 'tsconfig.build.json', '--outDir', stagingDir]);
    run(process.execPath, ['scripts/normalize-dist-layout.mjs', '--out-dir', stagingDir]);
    run(process.execPath, ['scripts/copy-dist-assets.mjs', '--out-dir', stagingDir]);
    publishBuildOutput(stagingDir, outDir);
  });
  process.stdout.write('[build-kit-package] built dist\n');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[build-kit-package] failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
