// Evidence JSON writer (release-gate-evidence/v1 schema).
//
// Owner: scripts (W2 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-004 locked evidence JSON shape, P-RELG-014 local
// workspace evidence output paths.
//
// Evidence shape (locked; renames or removals require contract revision):
//   schema_version: "release-gate-evidence/v1"
//   profile_id, registry_version, started_at, finished_at,
//   host_environment, target_filter, tier_filter,
//   require_release,
//   gates: [{ gate_id, tier, target, command, started_at, finished_at,
//             verdict, blocker_reason_code, exit_code, log_excerpt_path }],
//   summary: { pass_count, fail_count, blocked_count, unreachable_count }
//
// Determinism: evidence file path is deterministic given (timestamp,
// out-dir); JSON content is deterministic given (gate set, host env).
// Offline-safe: yes; only writes to .local/report/release/.

import fs from 'node:fs';
import path from 'node:path';

export const EVIDENCE_SCHEMA_VERSION = 'release-gate-evidence/v1';
const DEFAULT_EVIDENCE_DIR = '.local/report/release';

/**
 * Compute the default evidence file path for a given start timestamp.
 */
export function defaultEvidencePath(startedAtIso, outDir = DEFAULT_EVIDENCE_DIR) {
  const safeTs = startedAtIso.replace(/[:.]/g, '-');
  return path.join(outDir, `preflight-evidence-${safeTs}.json`);
}

/**
 * Build a single gate evidence row.
 *
 * @param {object} args
 * @param {string} args.gateId
 * @param {string} args.tier - the tier under which this gate was selected (one of gate.tiers)
 * @param {string} args.target
 * @param {string} args.command
 * @param {string} args.startedAt - ISO8601
 * @param {string} args.finishedAt - ISO8601
 * @param {string} args.verdict - pass|fail|blocked|unreachable
 * @param {string|null} args.blockerReasonCode
 * @param {number|null} args.exitCode
 * @param {string|null} args.logExcerptPath
 */
export function buildGateRow({
  gateId,
  tier,
  target,
  command,
  startedAt,
  finishedAt,
  verdict,
  blockerReasonCode,
  exitCode,
  logExcerptPath,
}) {
  if (!['pass', 'fail', 'blocked', 'unreachable'].includes(verdict)) {
    throw new Error(`buildGateRow: invalid verdict ${verdict}`);
  }
  return {
    gate_id: gateId,
    tier,
    target,
    command,
    started_at: startedAt,
    finished_at: finishedAt,
    verdict,
    blocker_reason_code: blockerReasonCode ?? null,
    exit_code: exitCode ?? null,
    log_excerpt_path: logExcerptPath ?? null,
  };
}

/**
 * Compute summary counts from gate rows.
 */
export function computeSummary(gateRows) {
  const summary = {
    pass_count: 0,
    fail_count: 0,
    blocked_count: 0,
    unreachable_count: 0,
  };
  for (const row of gateRows) {
    switch (row.verdict) {
      case 'pass':
        summary.pass_count += 1;
        break;
      case 'fail':
        summary.fail_count += 1;
        break;
      case 'blocked':
        summary.blocked_count += 1;
        break;
      case 'unreachable':
        summary.unreachable_count += 1;
        break;
      default:
        // unreachable in the JS sense; buildGateRow rejects invalid verdicts
        break;
    }
  }
  return summary;
}

/**
 * Build the full evidence document.
 *
 * @param {object} args
 * @param {string} args.profileId
 * @param {string} args.registryVersion
 * @param {string} args.startedAt
 * @param {string} args.finishedAt
 * @param {object} args.hostEnvironment
 * @param {string} args.tierFilter
 * @param {string} args.targetFilter
 * @param {boolean} args.requireRelease
 * @param {object[]} args.gateRows
 */
export function buildEvidenceDocument({
  profileId,
  registryVersion,
  startedAt,
  finishedAt,
  hostEnvironment,
  tierFilter,
  targetFilter,
  requireRelease,
  gateRows,
}) {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    profile_id: profileId,
    registry_version: registryVersion,
    started_at: startedAt,
    finished_at: finishedAt,
    host_environment: hostEnvironment,
    tier_filter: tierFilter,
    target_filter: targetFilter,
    require_release: requireRelease,
    gates: gateRows,
    summary: computeSummary(gateRows),
  };
}

/**
 * Write the evidence document to disk and return the path.
 *
 * @param {object} document - product of buildEvidenceDocument
 * @param {string} outPath - absolute or repo-relative
 * @returns {string} the path written (mirror of outPath)
 */
export function writeEvidenceFile(document, outPath) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  // 2-space indent for human grep + line-by-line diff. Trailing newline
  // for POSIX cleanliness.
  const json = JSON.stringify(document, null, 2) + '\n';
  fs.writeFileSync(outPath, json);
  return outPath;
}

/**
 * Validate an evidence document against the v1 shape (sanity check
 * before writing). Throws if invalid; returns void on green.
 */
export function assertEvidenceShape(document) {
  if (!document || typeof document !== 'object') {
    throw new Error('evidence: document must be an object');
  }
  if (document.schema_version !== EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`evidence: schema_version must be ${EVIDENCE_SCHEMA_VERSION}`);
  }
  for (const key of [
    'profile_id',
    'registry_version',
    'started_at',
    'finished_at',
    'host_environment',
    'tier_filter',
    'target_filter',
  ]) {
    if (document[key] == null) {
      throw new Error(`evidence: missing required field ${key}`);
    }
  }
  if (typeof document.require_release !== 'boolean') {
    throw new Error('evidence: require_release must be boolean');
  }
  if (!Array.isArray(document.gates)) {
    throw new Error('evidence: gates must be an array');
  }
  if (!document.summary || typeof document.summary !== 'object') {
    throw new Error('evidence: summary must be an object');
  }
  for (const key of ['pass_count', 'fail_count', 'blocked_count', 'unreachable_count']) {
    if (typeof document.summary[key] !== 'number') {
      throw new Error(`evidence: summary.${key} must be a number`);
    }
  }
  for (const row of document.gates) {
    for (const key of ['gate_id', 'tier', 'target', 'command', 'started_at', 'finished_at', 'verdict']) {
      if (row[key] == null) {
        throw new Error(`evidence: gate row missing required ${key}`);
      }
    }
    if (!['pass', 'fail', 'blocked', 'unreachable'].includes(row.verdict)) {
      throw new Error(`evidence: gate row ${row.gate_id} has invalid verdict ${row.verdict}`);
    }
  }
}
