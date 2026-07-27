import { spawnSyncCommand } from './command-runner.mjs';
import {
  SDK_DIST_PREPARED_ENV,
  withSdkDistLock,
} from './sdk-dist-lock.mjs';

export const WORKSPACE_SURFACES_PREPARED_ENV = 'NIMI_WORKSPACE_SURFACES_PREPARED';
export const WORKSPACE_SURFACES_LOCK_TIMEOUT_MS_ENV = 'NIMI_WORKSPACE_SURFACES_LOCK_TIMEOUT_MS';

const DEFAULT_WORKSPACE_SURFACES_LOCK_TIMEOUT_MS = 15_000;

function runChecked(command, args, options = {}) {
  const result = spawnSyncCommand(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${[command, ...args].join(' ')} exited with status ${result.status ?? 1}`);
  }
}

export async function withWorkspaceSurfaces({ repoRoot, label }, callback) {
  if (process.env[WORKSPACE_SURFACES_PREPARED_ENV] === '1') return callback();

  return withSdkDistLock(label, async () => {
    runChecked('pnpm', ['--filter', '@nimiplatform/sdk', 'build'], { cwd: repoRoot });
    runChecked('pnpm', ['--filter', '@nimiplatform/kit', 'build'], { cwd: repoRoot });

    const previousWorkspacePrepared = process.env[WORKSPACE_SURFACES_PREPARED_ENV];
    const previousSdkPrepared = process.env[SDK_DIST_PREPARED_ENV];
    process.env[WORKSPACE_SURFACES_PREPARED_ENV] = '1';
    process.env[SDK_DIST_PREPARED_ENV] = '1';
    try {
      return await callback();
    } finally {
      if (previousWorkspacePrepared === undefined) delete process.env[WORKSPACE_SURFACES_PREPARED_ENV];
      else process.env[WORKSPACE_SURFACES_PREPARED_ENV] = previousWorkspacePrepared;
      if (previousSdkPrepared === undefined) delete process.env[SDK_DIST_PREPARED_ENV];
      else process.env[SDK_DIST_PREPARED_ENV] = previousSdkPrepared;
    }
  }, {
    timeoutMs: process.env[WORKSPACE_SURFACES_LOCK_TIMEOUT_MS_ENV]
      ?? DEFAULT_WORKSPACE_SURFACES_LOCK_TIMEOUT_MS,
  });
}
