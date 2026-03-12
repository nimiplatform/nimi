import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

function runStep(command, args, cwd, env, label) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
  }
}

export function prepareNimiModsSdkSnapshot({ repoRoot, env = process.env, logPrefix = '[prepare-nimi-mods-sdk]' }) {
  const modsWorkspaceDir = path.join(repoRoot, 'nimi-mods');
  const localChatDir = path.join(modsWorkspaceDir, 'runtime', 'local-chat');
  const sdkDir = path.join(repoRoot, 'sdk');

  if (!existsSync(modsWorkspaceDir) || !existsSync(localChatDir) || !existsSync(sdkDir)) {
    return { skipped: true };
  }

  process.stdout.write(`${logPrefix} building sdk dist for mod consumers...\n`);
  runStep('pnpm', ['--filter', '@nimiplatform/sdk', 'build'], repoRoot, env, 'sdk build');

  process.stdout.write(`${logPrefix} refreshing nimi-mods sdk file dependency snapshot...\n`);
  runStep('pnpm', ['--dir', 'nimi-mods', 'install', '--frozen-lockfile', '--ignore-scripts'], repoRoot, env, 'nimi-mods install');

  return { skipped: false };
}
