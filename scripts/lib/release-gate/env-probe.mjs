// Environment probe for the release gate runner.
//
// Owner: scripts (W2 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-006 fail-closed for live/secret/external-repo,
// P-RELG-007 no pseudo-success.
//
// For each gate row's declared requirements (requires_secrets,
// requires_external_repo, requires_binaries) check whether the
// runtime environment satisfies them. Returns a probe verdict that
// the runner translates into pass/fail/blocked per blocker_semantics.
//
// Determinism: probes are pure functions of (env, filesystem state,
// PATH); no network access; no gate command execution. Offline-safe.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Probe whether an environment variable is set and non-empty.
 * @param {string} name
 * @param {object} [env] - defaults to process.env
 */
export function isSecretAvailable(name, env = process.env) {
  const value = env[name];
  return typeof value === 'string' && value.length > 0;
}

export function isEnvAvailable(name, env = process.env) {
  return isSecretAvailable(name, env);
}

/**
 * Probe whether a directory path exists relative to cwd.
 * @param {string} relativePath
 * @param {string} [cwd] - defaults to process.cwd()
 */
export function isExternalRepoAvailable(relativePath, cwd = process.cwd()) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) return false;
  if (path.isAbsolute(relativePath)) return false; // relative paths only per D2 schema
  const target = path.resolve(cwd, relativePath);
  try {
    const stat = fs.statSync(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Probe whether a binary is on PATH.
 * @param {string} name
 * @param {object} [env] - defaults to process.env
 * @param {string} [platform] - defaults to process.platform
 * @returns {boolean}
 */
export function isBinaryAvailable(name, env = process.env, platform = process.platform) {
  return resolveBinaryOnPath(name, env, platform) != null;
}

export function resolveBinaryOnPath(name, env = process.env, platform = process.platform) {
  if (typeof name !== 'string' || name.length === 0) return false;
  const pathSeparator = platform === 'win32' ? ';' : ':';
  const pathValue = readPathEnv(env);
  const pathEntries = pathValue
    .split(pathSeparator)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const executableNames = candidateExecutableNames(name, env, platform);
  const hasPathSeparator = /[\\/]/.test(name);

  const candidates = [];
  if (hasPathSeparator || pathEntries.length === 0) {
    candidates.push(...executableNames);
  } else {
    for (const dir of pathEntries) {
      for (const executableName of executableNames) {
        candidates.push(path.join(dir, executableName));
      }
    }
  }

  for (const candidate of candidates) {
    if (isExecutableFile(candidate, platform)) return candidate;
  }
  return null;
}

function readPathEnv(env) {
  if (typeof env.PATH === 'string') return env.PATH;
  if (typeof env.Path === 'string') return env.Path;
  if (typeof env.path === 'string') return env.path;
  return '';
}

function candidateExecutableNames(name, env, platform) {
  if (platform !== 'win32') return [name];
  if (path.extname(name).length > 0) return [name];
  const pathext = typeof env.PATHEXT === 'string' && env.PATHEXT.length > 0
    ? env.PATHEXT
    : '.COM;.EXE;.BAT;.CMD';
  return pathext
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      const ext = entry.startsWith('.') ? entry : `.${entry}`;
      return [`${name}${ext.toLowerCase()}`, `${name}${ext.toUpperCase()}`];
    });
}

function isExecutableFile(candidate, platform) {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    fs.accessSync(
      candidate,
      platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe a gate's environment requirements.
 *
 * @param {object} gate - gate row from registry
 * @param {object} [env] - process.env overlay
 * @param {string} [cwd] - process.cwd()
 * @returns {{
 *   ok: boolean,
 *   missing: { secrets: string[], externalRepos: string[], binaries: string[] }
 * }}
 */
export function probeGateEnvironment(gate, env = process.env, cwd = process.cwd()) {
  const missing = {
    secrets: [],
    env: [],
    externalRepos: [],
    binaries: [],
  };

  for (const e of gate.requires_env ?? []) {
    if (!isEnvAvailable(e, env)) missing.env.push(e);
  }
  for (const s of gate.requires_secrets ?? []) {
    if (!isSecretAvailable(s, env)) missing.secrets.push(s);
  }
  for (const r of gate.requires_external_repo ?? []) {
    if (!isExternalRepoAvailable(r, cwd)) missing.externalRepos.push(r);
  }
  for (const b of gate.requires_binaries ?? []) {
    if (!isBinaryAvailable(b, env)) missing.binaries.push(b);
  }

  const ok =
    missing.secrets.length === 0 &&
    missing.env.length === 0 &&
    missing.externalRepos.length === 0 &&
    missing.binaries.length === 0;

  return { ok, missing };
}

/**
 * Translate a probe result into a verdict + reason_code per
 * gate.blocker_semantics policy. The runner uses this to decide
 * whether a missing requirement produces "blocked" or "fail".
 *
 * @param {object} gate
 * @param {object} probeResult - result of probeGateEnvironment
 * @returns {{
 *   verdict: 'pass' | 'fail' | 'blocked',
 *   blockerReasonCode: string | null,
 *   detail: string
 * } | null}
 *   Returns null when probe is OK (caller proceeds to execute the gate).
 */
export function translateProbeVerdict(gate, probeResult) {
  if (probeResult.ok) return null;

  const policy = gate.blocker_semantics ?? {};

  if (probeResult.missing.env?.length > 0) {
    const verdict = policy.on_env_missing === 'fail' ? 'fail' : 'blocked';
    return {
      verdict,
      blockerReasonCode: 'REQUIRED_STATE_MISSING',
      detail: `env missing: ${probeResult.missing.env.join(', ')}`,
    };
  }

  if (probeResult.missing.secrets.length > 0) {
    const verdict = policy.on_secrets_missing === 'fail' ? 'fail' : 'blocked';
    return {
      verdict,
      blockerReasonCode: 'SECRETS_MISSING',
      detail: `secrets missing: ${probeResult.missing.secrets.join(', ')}`,
    };
  }

  if (probeResult.missing.externalRepos.length > 0) {
    const verdict =
      policy.on_external_repo_unavailable === 'fail' ? 'fail' : 'blocked';
    return {
      verdict,
      blockerReasonCode: 'EXTERNAL_REPO_UNAVAILABLE',
      detail: `external repo unavailable: ${probeResult.missing.externalRepos.join(', ')}`,
    };
  }

  if (probeResult.missing.binaries.length > 0) {
    const verdict = policy.on_binary_missing === 'fail' ? 'fail' : 'blocked';
    return {
      verdict,
      blockerReasonCode: 'BINARY_MISSING',
      detail: `binary missing: ${probeResult.missing.binaries.join(', ')}`,
    };
  }

  return null;
}

export function evaluateSkipWhen(gate, env = process.env) {
  const skipWhen = gate.skip_when;
  if (!skipWhen || typeof skipWhen !== 'object') {
    return null;
  }
  const condition = String(skipWhen.condition || '');
  const ci = env.CI === 'true' || env.CI === '1';
  const shouldSkip =
    (condition === 'macos' && process.platform === 'darwin') ||
    (condition === 'not_macos' && process.platform !== 'darwin') ||
    (condition === 'linux' && process.platform === 'linux') ||
    (condition === 'not_linux' && process.platform !== 'linux') ||
    (condition === 'windows' && process.platform === 'win32') ||
    (condition === 'not_windows' && process.platform !== 'win32') ||
    (condition === 'local' && !ci) ||
    (condition === 'ci' && ci);
  if (!shouldSkip) {
    return null;
  }
  return {
    verdict: 'blocked',
    blockerReasonCode: skipWhen.reason_code || 'PRECONDITION_NOT_MET',
    detail: `skip_when matched: ${condition}`,
  };
}

/**
 * Capture the host environment summary for evidence.host_environment field.
 * Pure with respect to call-time inputs; reads node/pnpm/go versions if
 * available but does not network.
 */
export function captureHostEnvironment(env = process.env) {
  const summary = {
    os: `${process.platform}-${process.arch}`,
    node_version: process.version,
    pnpm_version: probeVersion('pnpm', env, '--version'),
    go_version: probeVersion('go', env, 'version'),
    git_sha: probeGitSha(),
    ci: env.CI === 'true' || env.CI === '1',
  };
  return summary;
}

function probeVersion(binary, env, ...args) {
  const mergedEnv = { ...process.env, ...env };
  const spawnSpec = composeProbeExecutable(binary, args, mergedEnv, process.platform);
  try {
    const out = execFileSync(spawnSpec.command, spawnSpec.args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      env: mergedEnv,
      windowsHide: true,
      windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments === true,
      timeout: 5000,
    });
    return out.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

function composeProbeExecutable(binary, args, env, platform) {
  if (platform !== 'win32') {
    return { command: binary, args };
  }

  const resolved = resolveBinaryOnPath(binary, env, platform);
  if (typeof resolved !== 'string' || resolved.length === 0) {
    return { command: binary, args };
  }

  const ext = path.extname(resolved).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    return {
      command: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', composeCmdCommandLine(resolved, args)],
      windowsVerbatimArguments: true,
    };
  }

  return { command: resolved, args };
}

function composeCmdCommandLine(command, args) {
  const parts = [quoteCmdArg(command, { force: true }), ...args.map((arg) => quoteCmdArg(arg))];
  const line = parts.join(' ');
  return parts.slice(1).some((part) => part.startsWith('"')) ? `"${line}"` : line;
}

function quoteCmdArg(value, options = {}) {
  const text = String(value);
  if (options.force !== true && /^[^\s"&|<>^]+$/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function probeGitSha() {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    return out.trim();
  } catch {
    return null;
  }
}
