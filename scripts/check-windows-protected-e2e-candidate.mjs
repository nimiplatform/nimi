import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const candidateCommands = Object.freeze([
  Object.freeze({ command: process.execPath, args: ['--test', 'scripts/windows-protected-e2e-fixture.test.mjs'], cwd: repoRoot }),
  Object.freeze({ command: 'go', args: ['test', './internal/protectedlocal', './internal/services/app', '-count=1'], cwd: path.join(repoRoot, 'runtime') }),
  Object.freeze({ command: 'go', args: ['build', './...'], cwd: path.join(repoRoot, 'runtime') }),
  Object.freeze({ command: 'cargo', args: ['test', '--locked', '--manifest-path', 'kit/shell/protected-local/Cargo.toml', '--features', 'windows-e2e-fixture'], cwd: repoRoot }),
  Object.freeze({ command: 'cargo', args: ['check', '--locked', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--no-default-features', '--features', 'protected-local-e2e-fixture'], cwd: repoRoot }),
  Object.freeze({ command: process.execPath, args: ['scripts/build-windows-protected-e2e.mjs'], cwd: repoRoot }),
  Object.freeze({ command: 'git', args: ['diff', '--check'], cwd: repoRoot }),
]);

export function runCandidate(commands = candidateCommands) {
  if (process.platform !== 'win32') {
    throw new Error('Windows protected E2E candidate gate is available only on Windows.');
  }
  for (const step of commands) {
    const result = spawnSync(step.command, step.args, {
      cwd: step.cwd,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Windows protected E2E candidate step failed: ${path.basename(step.command)} ${step.args.join(' ')}`);
    }
  }
  const runtimePath = path.join(repoRoot, 'dist', 'windows-e2e', 'local-system', 'nimi-runtime-e2e.exe');
  const peerProbePath = path.join(repoRoot, 'dist', 'windows-e2e', 'local-system', 'peer-probe', 'nimiplatform-desktop-dev-run.exe');
  return {
    status: 'candidate-green',
    requiresElevation: false,
    nextCommand: 'corepack pnpm install:windows-protected-e2e',
    runtimeSha256: sha256(runtimePath),
    peerProbeSha256: sha256(peerProbePath),
  };
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(runCandidate())}\n`);
  } catch (error) {
    process.stderr.write(`[windows-protected-e2e-candidate] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
