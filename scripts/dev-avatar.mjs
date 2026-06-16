#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const SIGNAL_EXIT_CODES = new Map([
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]);

const runtimeEnvAllowlist = [
  'NIMI_RUNTIME_CONFIG_PATH',
  'NIMI_RUNTIME_GRPC_ADDR',
  'NIMI_RUNTIME_HTTP_ADDR',
  'NIMI_RUNTIME_LOCAL_STATE_PATH',
  'NIMI_RUNTIME_LOCK_PATH',
  'NIMI_RUNTIME_ACCOUNT_CUSTODY_PARTITION',
  'NIMI_RUNTIME_BRIDGE_DEBUG',
];

function usage() {
  return `Usage: pnpm dev:avatar [--uri <nimi-avatar://launch?...>] [--agent-id <local-agent:owner:agent>] [--instance-id <id>] [--no-kill-existing] [--dry-run]

Environment:
  NIMI_AVATAR_DEV_URI          explicit launch URI
  NIMI_AVATAR_DEV_AGENT_ID     fallback local-agent ref when no registry exists
  NIMI_AVATAR_DEV_INSTANCE_ID  fallback avatar instance id
  NIMI_APP_DATA_ROOT           explicit <nimi_data>/apps/nimi.avatar/data root
  NIMI_DATA_ROOT               selected nimi_data root; app roots are derived from it
`;
}

function readArgs(argv) {
  const options = {
    uri: process.env.NIMI_AVATAR_DEV_URI || '',
    agentId: process.env.NIMI_AVATAR_DEV_AGENT_ID || '',
    instanceId: process.env.NIMI_AVATAR_DEV_INSTANCE_ID || '',
    killExisting: process.env.NIMI_AVATAR_DEV_KEEP_EXISTING !== '1',
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === '--uri') {
      options.uri = argv[++index] || '';
      continue;
    }
    if (arg === '--agent-id') {
      options.agentId = argv[++index] || '';
      continue;
    }
    if (arg === '--instance-id') {
      options.instanceId = argv[++index] || '';
      continue;
    }
    if (arg === '--no-kill-existing') {
      options.killExisting = false;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    throw new Error(`unknown dev-avatar option: ${arg}\n\n${usage()}`);
  }
  return options;
}

function normalizeNonEmpty(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function candidateAppDataRoots() {
  const candidates = [];
  const explicitAppRoot = normalizeNonEmpty(process.env.NIMI_APP_DATA_ROOT);
  if (explicitAppRoot) candidates.push(explicitAppRoot);
  const explicitDataRoot = normalizeNonEmpty(process.env.NIMI_DATA_ROOT);
  if (explicitDataRoot) candidates.push(path.join(explicitDataRoot, 'apps', 'nimi.avatar', 'data'));
  candidates.push(path.join(homedir(), 'Nimi', 'apps', 'nimi.avatar', 'data'));
  candidates.push(path.join(homedir(), '.nimi', 'data', 'apps', 'nimi.avatar', 'data'));
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function resolveAppDataRoot() {
  const candidates = candidateAppDataRoots();
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (existing) return existing;
  if (process.env.NIMI_APP_DATA_ROOT || process.env.NIMI_DATA_ROOT) return candidates[0];
  throw new Error(
    `cannot resolve Avatar app data root. Tried:\n${candidates.map((item) => `  - ${item}`).join('\n')}\n\n` +
      'Open Desktop once or set NIMI_APP_DATA_ROOT=<nimi_data>/apps/nimi.avatar/data.',
  );
}

function appRootFromDataRoot(appDataRoot) {
  const normalized = path.resolve(appDataRoot);
  if (path.basename(normalized) !== 'data') {
    throw new Error(`NIMI_APP_DATA_ROOT must point to <nimi_data>/apps/nimi.avatar/data: ${normalized}`);
  }
  const appRoot = path.dirname(normalized);
  if (path.basename(appRoot) !== 'nimi.avatar' || path.basename(path.dirname(appRoot)) !== 'apps') {
    throw new Error(`NIMI_APP_DATA_ROOT must point to <nimi_data>/apps/nimi.avatar/data: ${normalized}`);
  }
  return appRoot;
}

function latestRegistryInstance(appDataRoot) {
  const registryPath = path.join(appDataRoot, 'avatar-instance-registry', 'instances.json');
  if (!existsSync(registryPath)) return null;
  const raw = readFileSync(registryPath, 'utf8');
  const parsed = JSON.parse(raw);
  const instances = Array.isArray(parsed.instances) ? parsed.instances : [];
  return instances[instances.length - 1] || null;
}

function buildLaunchUri(input) {
  const params = new URLSearchParams();
  params.set('agent_id', input.agentId);
  if (input.instanceId) params.set('avatar_instance_id', input.instanceId);
  params.set('launch_source', input.launchSource || 'avatar-dev');
  return `nimi-avatar://launch?${params.toString()}`;
}

function resolveLaunchUri(options, appDataRoot) {
  if (normalizeNonEmpty(options.uri)) return options.uri.trim();
  const registryInstance = latestRegistryInstance(appDataRoot);
  const agentId = normalizeNonEmpty(options.agentId) || normalizeNonEmpty(registryInstance?.localAgentRef);
  if (!agentId) {
    throw new Error(
      'cannot resolve Avatar launch agent. Launch Avatar from Desktop once, or pass --agent-id local-agent:<owner>:<agent>.',
    );
  }
  return buildLaunchUri({
    agentId,
    instanceId: normalizeNonEmpty(options.instanceId) || normalizeNonEmpty(registryInstance?.avatarInstanceId),
    launchSource: normalizeNonEmpty(registryInstance?.launchSource) || 'avatar-dev',
  });
}

function parseAllowedEnvFromProcessLine(line) {
  const out = {};
  for (const key of runtimeEnvAllowlist) {
    const match = line.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`));
    if (match?.[1]) out[key] = match[1];
  }
  return out;
}

function desktopRuntimeEnvFromRunningProcess() {
  if (process.platform === 'win32') return {};
  const result = spawnSync('ps', ['eww', '-ax'], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return {};
  const lines = result.stdout
    .split('\n')
    .filter((line) => line.includes('nimiplatform-desktop') || line.includes('Nimi Desktop Runtime'));
  for (const line of lines) {
    const env = parseAllowedEnvFromProcessLine(line);
    if (Object.keys(env).length > 0) return env;
  }
  return {};
}

function killExistingAvatarProcesses() {
  if (process.platform === 'win32') return;
  const result = spawnSync('pgrep', ['-f', 'Nimi Avatar.app/Contents/MacOS/nimiplatform-avatar|target/debug/nimiplatform-avatar'], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout.trim()) return;
  const pids = result.stdout
    .trim()
    .split(/\s+/)
    .filter((pid) => pid && pid !== String(process.pid));
  if (pids.length === 0) return;
  spawnSync('kill', pids, { stdio: 'ignore' });
}

function childEnvFor(appDataRoot) {
  const appRoot = appRootFromDataRoot(appDataRoot);
  const desktopRuntimeEnv = desktopRuntimeEnvFromRunningProcess();
  const env = {
    ...process.env,
    ...desktopRuntimeEnv,
    NIMI_APP_DATA_ROOT: appDataRoot,
    NIMI_APP_CACHE_ROOT: process.env.NIMI_APP_CACHE_ROOT || path.join(appRoot, 'cache'),
    NIMI_APP_TEMP_ROOT: process.env.NIMI_APP_TEMP_ROOT || path.join(appRoot, 'tmp'),
    NIMI_RUNTIME_BRIDGE_MODE: 'RUNTIME',
    CARGO_TERM_PROGRESS_WHEN: process.env.CARGO_TERM_PROGRESS_WHEN || 'never',
  };
  return env;
}

function main() {
  const options = readArgs(process.argv.slice(2));
  const appDataRoot = resolveAppDataRoot();
  const launchUri = resolveLaunchUri(options, appDataRoot);
  if (options.killExisting) killExistingAvatarProcesses();
  const env = childEnvFor(appDataRoot);
  process.stderr.write(`[dev-avatar] app data root: ${appDataRoot}\n`);
  process.stderr.write(`[dev-avatar] launch uri: ${launchUri}\n`);
  if (options.dryRun) {
    const forwardedRuntimeKeys = runtimeEnvAllowlist.filter((key) => env[key]);
    process.stdout.write(JSON.stringify({
      appDataRoot,
      appCacheRoot: env.NIMI_APP_CACHE_ROOT,
      appTempRoot: env.NIMI_APP_TEMP_ROOT,
      launchUri,
      forwardedRuntimeKeys,
    }, null, 2));
    process.stdout.write('\n');
    return;
  }
  process.stderr.write('[dev-avatar] starting Avatar Tauri dev with Vite HMR on 127.0.0.1:1427\n');

  const args = [
    '--filter',
    '@nimiplatform/avatar',
    'exec',
    '--',
    'tauri',
    'dev',
    '--config',
    'src-tauri/tauri.conf.json',
    '--',
    '--',
    launchUri,
  ];
  const child = spawn(pnpmBin, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  for (const signal of SIGNAL_EXIT_CODES.keys()) {
    process.on(signal, () => {
      child.kill('SIGTERM');
      process.exit(SIGNAL_EXIT_CODES.get(signal) ?? 1);
    });
  }
  child.on('exit', (code, signal) => {
    if (signal) process.exit(SIGNAL_EXIT_CODES.get(signal) ?? 1);
    process.exit(code ?? 0);
  });
  child.on('error', (error) => {
    process.stderr.write(`[dev-avatar] failed to start pnpm: ${error.message}\n`);
    process.exit(1);
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(`[dev-avatar] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
