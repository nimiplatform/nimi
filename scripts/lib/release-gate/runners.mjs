// Process runners for the release gate runner.
//
// Owner: scripts (W2 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-005 verdict semantics, P-RELG-007 no pseudo-success.
//
// Flat-module deviation from D4 design "scripts/lib/release-gate/runners/{pnpm,node,go,shell}.mjs":
// scripts/AGENTS.md mandates "avoid introducing new nested helper trees
// when a flat lib module is sufficient". The 4 runners share most spawn
// logic; consolidating into one module reduces depth and de-duplicates
// the timeout / signal / capture handling. Public API kept identical to
// the design (runByKind dispatcher).
//
// Determinism: spawn child processes per gate.command; capture stdout
// + stderr; respect timeout via SIGKILL after gate.timeout_seconds.
// Offline-safe: yes (network access is the responsibility of the spawned
// child process, not the runner itself; the registry's requires_secrets
// + requires_external_repo + tier=live signals are the network/auth
// gating mechanism).

import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

const VALID_RUNNERS = new Set(['pnpm', 'node', 'go', 'shell']);

const DEFAULT_LOG_TAIL_BYTES = 16 * 1024; // 16 KiB tail of stdout+stderr

/**
 * Spawn a child process for a gate and return a structured result.
 *
 * @param {object} gate - registry row
 * @param {object} [options]
 * @param {string} [options.cwd] - working directory; defaults to gate.cwd or process.cwd()
 * @param {object} [options.env] - environment overlay; merged with process.env
 * @param {number} [options.tailBytes] - max bytes to retain from output
 * @returns {Promise<{
 *   exitCode: number | null,
 *   timedOut: boolean,
 *   stdout: Buffer,
 *   stderr: Buffer,
 *   startedAt: string,
 *   finishedAt: string,
 *   spawnedCommand: string,
 *   spawnedArgs: string[],
 * }>}
 */
export async function runByKind(gate, options = {}) {
  if (!VALID_RUNNERS.has(gate.runner)) {
    throw new Error(`unknown runner: ${gate.runner} (gate ${gate.id})`);
  }

  const cwd = options.cwd ?? gate.cwd ?? process.cwd();
  const env = { ...process.env, ...(options.env ?? {}) };
  const tailBytes = options.tailBytes ?? DEFAULT_LOG_TAIL_BYTES;

  const { command, args } = composeSpawn(gate);
  const startedAt = new Date().toISOString();

  return new Promise((resolve) => {
    // detached:true makes the child its own process group leader on POSIX,
    // so a timeout SIGKILL can target the whole group via -pid. Without
    // this, bash → sleep child trees orphan the timer kill.
    const detached = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached,
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    function pushBounded(target, chunk, currentBytesRef) {
      target.push(chunk);
      const newTotal = currentBytesRef.bytes + chunk.length;
      currentBytesRef.bytes = newTotal;
      // Coalesce to tail bytes only after a comfortable margin to avoid
      // doing it per-chunk; runner output is typically modest.
      if (newTotal > tailBytes * 4) {
        const all = Buffer.concat(target);
        const tail = all.subarray(Math.max(0, all.length - tailBytes));
        target.length = 0;
        target.push(tail);
        currentBytesRef.bytes = tail.length;
      }
    }

    const stdoutRef = { bytes: 0 };
    const stderrRef = { bytes: 0 };

    child.stdout.on('data', (chunk) => pushBounded(stdoutChunks, chunk, stdoutRef));
    child.stderr.on('data', (chunk) => pushBounded(stderrChunks, chunk, stderrRef));

    let timedOut = false;
    let killTimer = null;

    const timeoutSeconds = Number.isFinite(gate.timeout_seconds)
      ? gate.timeout_seconds
      : 600;

    if (timeoutSeconds > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        // Per P-RELG-007 / D7: SIGKILL not SIGTERM. SIGTERM may be
        // ignored by Go test binaries and other targets. Kill the
        // whole process group on POSIX so descendants of the child
        // (e.g. bash → sleep) don't orphan the kill.
        try {
          if (detached && typeof child.pid === 'number') {
            process.kill(-child.pid, 'SIGKILL');
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          /* race with natural exit; ignore */
        }
      }, timeoutSeconds * 1000);
    }

    child.on('error', (error) => {
      if (killTimer) clearTimeout(killTimer);
      const finishedAt = new Date().toISOString();
      const stderrBuf = Buffer.concat(stderrChunks);
      const errMsg = Buffer.from(`runner spawn error: ${error.message}\n`, 'utf8');
      resolve({
        exitCode: null,
        timedOut: false,
        stdout: tailToBuf(stdoutChunks, tailBytes),
        stderr: tailToBuf([stderrBuf, errMsg], tailBytes),
        startedAt,
        finishedAt,
        spawnedCommand: command,
        spawnedArgs: args,
      });
    });

    child.on('close', (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      const finishedAt = new Date().toISOString();
      // When killed via SIGKILL, code is null and signal is "SIGKILL".
      // We surface exitCode as null in the timeout case so the runner
      // upstream can attribute the verdict to TIMEOUT.
      const exitCode = signal === 'SIGKILL' && timedOut ? null : code;
      resolve({
        exitCode,
        timedOut,
        stdout: tailToBuf(stdoutChunks, tailBytes),
        stderr: tailToBuf(stderrChunks, tailBytes),
        startedAt,
        finishedAt,
        spawnedCommand: command,
        spawnedArgs: args,
      });
    });
  });
}

/**
 * Compose the command + argv for a gate based on its `runner` kind.
 * Pure function (no side effects); covered by unit tests.
 */
export function composeSpawn(gate) {
  if (typeof gate.command !== 'string' || gate.command.length === 0) {
    throw new Error(`gate ${gate.id} has empty command`);
  }

  switch (gate.runner) {
    case 'pnpm':
      return composePnpm(gate);
    case 'node':
      return composeNode(gate);
    case 'go':
      return composeGo(gate);
    case 'shell':
      return composeShell(gate);
    default:
      throw new Error(`unknown runner kind: ${gate.runner}`);
  }
}

function composePnpm(gate) {
  // gate.command in registry is the full pnpm invocation, e.g.:
  //   "pnpm exec nimicoding validate-spec-tree"
  //   "pnpm proto:lint"
  //   "pnpm --filter @nimiplatform/desktop typecheck"
  // Strip the leading "pnpm " and pass remainder as argv to the pnpm
  // binary discovered via PATH.
  const trimmed = gate.command.trim();
  if (!trimmed.startsWith('pnpm ')) {
    throw new Error(`gate ${gate.id} runner=pnpm expects command to start with "pnpm ": ${gate.command}`);
  }
  const rest = trimmed.slice('pnpm '.length).trim();
  const args = parseArgv(rest);
  return { command: 'pnpm', args };
}

function composeNode(gate) {
  // gate.command e.g. "node scripts/check-release-gate-registry-coherence.mjs"
  const trimmed = gate.command.trim();
  if (trimmed.startsWith('node ')) {
    const rest = trimmed.slice('node '.length).trim();
    return { command: 'node', args: parseArgv(rest) };
  }
  // Some node-runner gates may invoke other commands wrapping node;
  // the runner kind is "node" only when the spawned process is node.
  // We accept a leading "node" or treat the whole command as a script
  // path with default node binary.
  return { command: 'node', args: parseArgv(trimmed) };
}

function composeGo(gate) {
  // gate.command e.g. "go build ./..." (cwd typically set to runtime/)
  const trimmed = gate.command.trim();
  if (!trimmed.startsWith('go ')) {
    throw new Error(`gate ${gate.id} runner=go expects command to start with "go ": ${gate.command}`);
  }
  const rest = trimmed.slice('go '.length).trim();
  return { command: 'go', args: parseArgv(rest) };
}

function composeShell(gate) {
  // Shell runner wraps an arbitrary command in `bash -c` so pipes,
  // redirections, and other shell features work uniformly. SIGKILL
  // applies to bash itself; bash's SIGKILL semantics terminate the
  // child group.
  return { command: 'bash', args: ['-c', `set -o pipefail; ${gate.command}`] };
}

/**
 * Best-effort argv parser. Handles quoted segments per POSIX shell
 * semantics for the purposes of gate.command strings. Does NOT support
 * arbitrary shell metacharacters (use runner=shell for that).
 */
export function parseArgv(input) {
  const out = [];
  let current = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < input.length) {
    const ch = input[i];
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
    } else if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === '\\' && i + 1 < input.length) {
        current += input[i + 1];
        i += 1;
      } else {
        current += ch;
      }
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i += 1;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        out.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
    i += 1;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function tailToBuf(chunks, tailBytes) {
  if (chunks.length === 0) return Buffer.alloc(0);
  const all = Buffer.concat(chunks);
  if (all.length <= tailBytes) return all;
  return all.subarray(all.length - tailBytes);
}

export const _internal = {
  VALID_RUNNERS,
  DEFAULT_LOG_TAIL_BYTES,
  composePnpm,
  composeNode,
  composeGo,
  composeShell,
  parseArgv,
  tailToBuf,
};
