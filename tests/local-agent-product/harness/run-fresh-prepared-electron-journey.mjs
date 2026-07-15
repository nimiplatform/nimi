#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

import { writeFreshPreparedElectronArtifactBinding } from '../../../apps/desktop/scripts/lib/electron-build-mode.mjs';
import { resolvePortableProcessInvocation } from '../../../scripts/lib/portable-process-command.mjs';
import { assertSourceState, captureSourceState } from './source-state.mjs';
import { repoRoot } from './registry.mjs';

const targetArgs = process.argv.slice(2);
const target = targetArgs.join(' ');
const allowedTargets = new Set([
  'tests/local-agent-product/harness/run-first-run-connectivity.mjs',
  'tests/local-agent-product/harness/run-owner-minimal.mjs',
  'tests/local-agent-product/harness/run-gate.mjs --gate core',
]);
if (!allowedTargets.has(target)) {
  throw new Error(`fresh-prepared Electron journey target is not admitted: ${target || '<empty>'}`);
}
if (String(process.env.NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE || '').trim()) {
  throw new Error('fresh-prepared Electron journey owns NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE');
}

const sourceState = captureSourceState(repoRoot);
run('pnpm', ['build:dev-kernel-electron-carrier']);
assertSourceState(sourceState, repoRoot);

const requireFromDesktop = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
const electronVersion = String(requireFromDesktop('electron/package.json').version || '').trim();
const preparationId = randomBytes(16).toString('hex');
const bindingRoot = path.join(repoRoot, '.nimi', 'local', 'electron-desktop-runtime', electronVersion);
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

const result = spawnSync(process.execPath, targetArgs, {
  cwd: repoRoot,
  env: {
    ...process.env,
    NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE: 'fresh-prepared',
    NIMI_DEV_KERNEL_ELECTRON_PREPARATION_ID: preparationId,
    NIMI_LOCAL_AGENT_PRODUCT_SOURCE_DIGEST: sourceState.sourceDigest,
  },
  stdio: 'inherit',
  windowsHide: false,
});
if (result.error) throw result.error;
if (result.signal) throw new Error(`fresh-prepared Electron journey terminated by ${result.signal}`);
process.exitCode = result.status ?? 1;

function run(command, args) {
  const invocation = resolvePortableProcessInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status ?? result.signal}`);
  }
}
