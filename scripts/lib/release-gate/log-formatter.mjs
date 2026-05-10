// TTY pretty + log-file output for the release preflight runner.
//
// Owner: scripts (W2 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-014 local workspace evidence output.
//
// Per-gate stdout/stderr is written to a log file under
// .local/report/release/preflight-logs/<gate_id>-<ISO8601>.log so the
// evidence JSON's gates[].log_excerpt_path field resolves to a real
// readable artifact. The TTY summary line is printed to the parent
// process stdout.
//
// Determinism: writes only to .local/report/release/ (gitignored);
// never reaches the network. Offline-safe.

import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

const ANSI_RESET = '\x1b[0m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_GREY = '\x1b[90m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_BOLD = '\x1b[1m';

const VERDICT_COLOUR = {
  pass: ANSI_GREEN,
  fail: ANSI_RED,
  blocked: ANSI_YELLOW,
  unreachable: ANSI_GREY,
};

const VERDICT_LABEL = {
  pass: 'PASS',
  fail: 'FAIL',
  blocked: 'BLOCKED',
  unreachable: 'UNREACHABLE',
};

/**
 * Write a per-gate log file containing both stdout and stderr (in that
 * order, with a header line each). Returns the relative path written.
 *
 * @param {object} args
 * @param {string} args.gateId
 * @param {string} args.startedAt - ISO8601
 * @param {Buffer} args.stdout
 * @param {Buffer} args.stderr
 * @param {string} [args.logsDir] - default .local/report/release/preflight-logs
 * @returns {string} relative path to the log file
 */
export function writeGateLog({
  gateId,
  startedAt,
  stdout,
  stderr,
  logsDir = '.local/report/release/preflight-logs',
}) {
  if (typeof gateId !== 'string' || gateId.length === 0) {
    throw new Error('writeGateLog: gateId required');
  }
  fs.mkdirSync(logsDir, { recursive: true });
  const safeTs = startedAt.replace(/[:.]/g, '-');
  const filename = `${gateId}-${safeTs}.log`;
  const fullPath = path.join(logsDir, filename);

  const sep = '----------------------------------------------------\n';
  const buf = Buffer.concat([
    Buffer.from(`# gate: ${gateId}\n`, 'utf8'),
    Buffer.from(`# started_at: ${startedAt}\n`, 'utf8'),
    Buffer.from(`${sep}# stdout\n${sep}`, 'utf8'),
    stdout ?? Buffer.alloc(0),
    Buffer.from(`\n${sep}# stderr\n${sep}`, 'utf8'),
    stderr ?? Buffer.alloc(0),
    Buffer.from('\n', 'utf8'),
  ]);
  fs.writeFileSync(fullPath, buf);
  return fullPath;
}

/**
 * Format a per-gate single-line TTY status row.
 *
 * @param {object} args
 * @param {number} args.index - 1-based gate index
 * @param {number} args.total - total gate count
 * @param {string} args.gateId
 * @param {string} args.verdict - pass|fail|blocked|unreachable
 * @param {string|null} args.blockerReasonCode
 * @param {number} args.elapsedMs
 * @param {boolean} args.color
 * @returns {string} formatted line ending in newline
 */
export function formatGateLine({ index, total, gateId, verdict, blockerReasonCode, elapsedMs, color }) {
  const verdictText = VERDICT_LABEL[verdict] ?? String(verdict).toUpperCase();
  const colour = VERDICT_COLOUR[verdict] ?? ANSI_GREY;
  const indexCell = `[${String(index).padStart(2, ' ')}/${String(total).padStart(2, ' ')}]`;
  const idCell = gateId.padEnd(56, ' ');
  const elapsedSec = (elapsedMs / 1000).toFixed(2).padStart(6, ' ');
  let verdictCell = verdictText.padEnd(11, ' ');
  if (color) verdictCell = `${ANSI_BOLD}${colour}${verdictCell}${ANSI_RESET}`;
  let extra = '';
  if (blockerReasonCode) extra = `  (${blockerReasonCode})`;
  return `${indexCell} ${idCell} ${verdictCell} ${elapsedSec}s${extra}\n`;
}

/**
 * Format the summary block at the end of a preflight run.
 *
 * @param {object} args
 * @param {{ pass_count: number, fail_count: number, blocked_count: number, unreachable_count: number }} args.summary
 * @param {string} args.evidencePath
 * @param {boolean} args.requireRelease
 * @param {boolean} args.color
 * @returns {string}
 */
export function formatSummary({ summary, evidencePath, requireRelease, color }) {
  const lines = [
    '',
    'summary:',
    `  pass:        ${summary.pass_count}`,
    `  fail:        ${summary.fail_count}`,
    `  blocked:     ${summary.blocked_count}`,
    `  unreachable: ${summary.unreachable_count}`,
    '',
    `evidence: ${evidencePath}`,
  ];

  let resultText;
  let resultColour;
  const greenStrict =
    summary.fail_count === 0 &&
    summary.blocked_count === 0 &&
    summary.unreachable_count === 0;
  const greenDev = summary.fail_count === 0 && summary.unreachable_count === 0;

  if (requireRelease) {
    if (greenStrict) {
      resultText = 'green (release)';
      resultColour = ANSI_GREEN;
    } else {
      resultText = 'red (release; blocked counted as fail)';
      resultColour = ANSI_RED;
    }
  } else {
    if (greenStrict) {
      resultText = 'green';
      resultColour = ANSI_GREEN;
    } else if (greenDev) {
      resultText = 'green-with-blocked (run with --require-release to enforce)';
      resultColour = ANSI_YELLOW;
    } else {
      resultText = 'red';
      resultColour = ANSI_RED;
    }
  }
  if (color) resultText = `${ANSI_BOLD}${resultColour}${resultText}${ANSI_RESET}`;
  lines.push(`result: ${resultText}`);
  return lines.join('\n') + '\n';
}

/**
 * Header line shown before the gate execution rows.
 */
export function formatHeader({
  profileId,
  registryVersion,
  hostEnvironment,
  tier,
  target,
  requireRelease,
  allowBlockedTiers,
  color,
}) {
  const lines = [
    'nimi release preflight',
    `profile=${profileId}  registry_version=${registryVersion}  tier=${tier}  target=${target}`,
    `host: ${hostEnvironment.os} node=${hostEnvironment.node_version}` +
      (hostEnvironment.pnpm_version ? ` pnpm=${hostEnvironment.pnpm_version}` : '') +
      (hostEnvironment.go_version ? ` go=${hostEnvironment.go_version}` : '') +
      `  ci=${hostEnvironment.ci}`,
    `require_release=${requireRelease}  allow_blocked_tiers=${(allowBlockedTiers ?? []).join(',') || '(none)'}`,
    '',
  ];
  if (color) lines[0] = `${ANSI_BOLD}${ANSI_CYAN}${lines[0]}${ANSI_RESET}`;
  return lines.join('\n') + '\n';
}

export const _internal = {
  ANSI_RESET,
  ANSI_GREEN,
  ANSI_RED,
  ANSI_YELLOW,
  ANSI_GREY,
  ANSI_CYAN,
  ANSI_BOLD,
  VERDICT_COLOUR,
  VERDICT_LABEL,
};
