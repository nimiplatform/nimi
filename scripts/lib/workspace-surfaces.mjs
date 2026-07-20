import { spawnSyncCommand } from './command-runner.mjs';
import { withSdkDistLock } from './sdk-dist-lock.mjs';

export const WORKSPACE_SURFACES_PREPARED_ENV = 'NIMI_WORKSPACE_SURFACES_PREPARED';

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

    const previous = process.env[WORKSPACE_SURFACES_PREPARED_ENV];
    process.env[WORKSPACE_SURFACES_PREPARED_ENV] = '1';
    try {
      return await callback();
    } finally {
      if (previous === undefined) delete process.env[WORKSPACE_SURFACES_PREPARED_ENV];
      else process.env[WORKSPACE_SURFACES_PREPARED_ENV] = previous;
    }
  });
}
