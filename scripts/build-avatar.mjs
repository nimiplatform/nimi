import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriBuildArgs = ['--filter', '@nimiplatform/avatar', 'exec', '--', 'tauri', 'build'];

const platformBuildArgs =
  process.platform === 'darwin'
    ? [...tauriBuildArgs, '--bundles', 'app', '--no-sign']
    : [...tauriBuildArgs, '--no-bundle'];

const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
const commandArgs =
  process.platform === 'win32' ? ['/d', '/c', 'pnpm', ...platformBuildArgs] : platformBuildArgs;

const result = spawnSync(command, commandArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const expectedTarget =
  process.platform === 'darwin'
    ? join(
        repoRoot,
        'apps',
        'avatar',
        'src-tauri',
        'target',
        'release',
        'bundle',
        'macos',
        'Nimi Avatar.app',
      )
    : join(
        repoRoot,
        'apps',
        'avatar',
        'src-tauri',
        'target',
        'release',
        process.platform === 'win32' ? 'nimiplatform-avatar.exe' : 'nimiplatform-avatar',
      );

if (!existsSync(expectedTarget)) {
  console.error(`Avatar build completed but launch target is missing: ${expectedTarget}`);
  process.exit(1);
}
