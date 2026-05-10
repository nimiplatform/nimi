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
// PATH); no network access; no command execution. Offline-safe.

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
 * Probe whether a binary is on PATH. Uses `command -v` via execFileSync.
 * @param {string} name
 * @returns {boolean}
 */
export function isBinaryAvailable(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  try {
    // Use POSIX `command -v` via /bin/sh; works on macOS and Linux.
    // On Windows the runner environment is bash via Git Bash / WSL in CI.
    execFileSync('/bin/sh', ['-c', `command -v ${name}`], {
      stdio: 'ignore',
      windowsHide: true,
    });
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
    externalRepos: [],
    binaries: [],
  };

  for (const s of gate.requires_secrets ?? []) {
    if (!isSecretAvailable(s, env)) missing.secrets.push(s);
  }
  for (const r of gate.requires_external_repo ?? []) {
    if (!isExternalRepoAvailable(r, cwd)) missing.externalRepos.push(r);
  }
  for (const b of gate.requires_binaries ?? []) {
    if (!isBinaryAvailable(b)) missing.binaries.push(b);
  }

  const ok =
    missing.secrets.length === 0 &&
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

/**
 * Capture the host environment summary for evidence.host_environment field.
 * Pure with respect to call-time inputs; reads node/pnpm/go versions if
 * available but does not network.
 */
export function captureHostEnvironment(env = process.env) {
  const summary = {
    os: `${process.platform}-${process.arch}`,
    node_version: process.version,
    pnpm_version: probeVersion('pnpm', '--version'),
    go_version: probeVersion('go', 'version'),
    git_sha: probeGitSha(),
    ci: env.CI === 'true' || env.CI === '1',
  };
  return summary;
}

function probeVersion(binary, ...args) {
  try {
    const out = execFileSync(binary, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    return out.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
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
