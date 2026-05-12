// Gate execution engine — implements D7 verdict decision algorithm.
//
// Owner: scripts (W2 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-005 verdict-set lock, P-RELG-006 fail-closed,
// P-RELG-007 no pseudo-success.
//
// Given a parsed registry + CLI options, this module:
//   1. Selects the gate set by tier ∩ target ∩ filter
//   2. Topo-sorts by prerequisites
//   3. For each gate in order:
//      a. Skip with verdict=unreachable if any prereq verdict ≠ pass
//      b. Probe environment (env-probe.mjs); on missing → blocked or fail
//         per gate.blocker_semantics
//      c. Spawn child process via runners.mjs; capture stdout+stderr
//         to log file via log-formatter.mjs
//      d. Translate exit code → pass / fail (COMMAND_NONZERO) / fail (TIMEOUT)
//   4. Emit per-gate evidence row + computed summary
//
// Determinism: gate order is topo-sorted with stable tie-break by gate
// id ascending; no clock-dependent scheduling beyond timestamps in
// evidence rows. Offline-safe.

import { runByKind } from './runners.mjs';
import { evaluateSkipWhen, probeGateEnvironment, translateProbeVerdict } from './env-probe.mjs';
import { writeGateLog, formatGateLine } from './log-formatter.mjs';
import { buildGateRow } from './evidence.mjs';

/**
 * Filter the registry's gate set by CLI selection options.
 *
 * @param {object[]} gates
 * @param {object} options - parsed CLI options
 * @returns {{ selected: object[], selectedTier: Map<string, string> }}
 *   selectedTier maps gate.id → which tier id was used to select it
 *   (used to populate evidence.gates[i].tier).
 */
export function selectGates(gates, options) {
  const requestedTiers = new Set([options.tier, ...options.include]);
  const selected = [];
  const selectedTier = new Map();

  for (const gate of gates) {
    // tier match
    let tierMatch = null;
    for (const t of gate.tiers ?? []) {
      if (requestedTiers.has(t)) {
        tierMatch = t;
        break;
      }
    }
    if (tierMatch == null) continue;

    // target match: gate satisfies if its targets[] include 'any' OR
    // include the requested target. options.target='any' matches all.
    if (options.target !== 'any') {
      const tgts = gate.targets ?? [];
      if (!tgts.includes(options.target) && !tgts.includes('any')) continue;
    }

    // filter glob
    if (options.filter && !matchGlob(options.filter, gate.id)) continue;

    selected.push(gate);
    selectedTier.set(gate.id, tierMatch);
  }
  return { selected, selectedTier };
}

/**
 * Topological sort by gate.prerequisites, with stable tie-break by gate.id.
 * Cycles are not expected (coherence checker rejects them); if encountered,
 * remaining nodes are appended in id order to keep execution deterministic.
 */
export function topoSort(gates) {
  const byId = new Map(gates.map((g) => [g.id, g]));
  const colour = new Map(gates.map((g) => [g.id, 'WHITE']));
  const order = [];

  function visit(id) {
    const c = colour.get(id);
    if (c === 'BLACK') return;
    if (c === 'GRAY') return; // cycle; coherence-checker is supposed to prevent
    colour.set(id, 'GRAY');
    const gate = byId.get(id);
    const prereqs = (gate?.prerequisites ?? []).slice().sort();
    for (const p of prereqs) {
      if (byId.has(p)) visit(p);
    }
    colour.set(id, 'BLACK');
    order.push(gate);
  }

  const sorted = gates.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const g of sorted) visit(g.id);
  return order;
}

/**
 * Determine if a verdict is permitted in summary green per CLI options.
 * Used internally by callers; not by the runner itself.
 */
export function isVerdictPermissive(verdict, gate, options) {
  if (verdict === 'pass') return true;
  if (verdict === 'unreachable') return false;
  if (verdict === 'fail') return false;
  // verdict === 'blocked'
  if (options.requireRelease) return false;
  // permitted if any of the gate's tiers is in allow-blocked-tiers
  for (const t of gate.tiers ?? []) {
    if (options.allowBlockedTiers.includes(t)) return true;
  }
  return false;
}

/**
 * Execute the selected gate set sequentially, in topo order, producing
 * evidence gate rows. Emits a per-gate TTY line via the supplied
 * onProgress callback so the entrypoint can stream results.
 *
 * @param {object} args
 * @param {object[]} args.gates - selected gate rows (post-filter)
 * @param {Map<string,string>} args.selectedTier - gate.id → tier
 * @param {object} args.options - parsed CLI options
 * @param {(line: string) => void} [args.onProgress] - per-gate TTY hook
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function executeGates({ gates, selectedTier, options, onProgress }) {
  const ordered = topoSort(gates);
  const total = ordered.length;
  const verdictById = new Map(); // gate.id → verdict (string)
  const rows = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const gate = ordered[i];
    const tier = selectedTier.get(gate.id) ?? gate.tiers?.[0] ?? '';
    const target = options.target;
    const startedAt = new Date().toISOString();

    // Step 1: prerequisite check
    const prereqFailed = (gate.prerequisites ?? []).some((p) => {
      const v = verdictById.get(p);
      // If a prereq isn't in the selected set (filtered out), treat as
      // pass (we can't gate on what we didn't run); otherwise require pass.
      return v != null && v !== 'pass';
    });
    if (prereqFailed) {
      const finishedAt = new Date().toISOString();
      const row = buildGateRow({
        gateId: gate.id,
        tier,
        target,
        command: gate.command,
        startedAt,
        finishedAt,
        verdict: 'unreachable',
        blockerReasonCode: 'UPSTREAM_GATE_FAILED',
        exitCode: null,
        logExcerptPath: null,
      });
      rows.push(row);
      verdictById.set(gate.id, 'unreachable');
      if (onProgress) {
        onProgress(
          formatGateLine({
            index: i + 1,
            total,
            gateId: gate.id,
            verdict: 'unreachable',
            blockerReasonCode: 'UPSTREAM_GATE_FAILED',
            elapsedMs: 0,
            color: options.color,
          })
        );
      }
      continue;
    }

    // Step 2: declared precondition skip
    const skipVerdict = evaluateSkipWhen(gate);
    if (skipVerdict) {
      const finishedAt = new Date().toISOString();
      const row = buildGateRow({
        gateId: gate.id,
        tier,
        target,
        command: gate.command,
        startedAt,
        finishedAt,
        verdict: skipVerdict.verdict,
        blockerReasonCode: skipVerdict.blockerReasonCode,
        exitCode: null,
        logExcerptPath: null,
      });
      rows.push(row);
      verdictById.set(gate.id, skipVerdict.verdict);
      if (onProgress) {
        onProgress(
          formatGateLine({
            index: i + 1,
            total,
            gateId: gate.id,
            verdict: skipVerdict.verdict,
            blockerReasonCode: skipVerdict.blockerReasonCode,
            elapsedMs: 0,
            color: options.color,
          })
        );
      }
      continue;
    }

    // Step 3: environment probe
    const probe = probeGateEnvironment(gate);
    const probeVerdict = translateProbeVerdict(gate, probe);
    if (probeVerdict) {
      const finishedAt = new Date().toISOString();
      const row = buildGateRow({
        gateId: gate.id,
        tier,
        target,
        command: gate.command,
        startedAt,
        finishedAt,
        verdict: probeVerdict.verdict,
        blockerReasonCode: probeVerdict.blockerReasonCode,
        exitCode: null,
        logExcerptPath: null,
      });
      rows.push(row);
      verdictById.set(gate.id, probeVerdict.verdict);
      if (onProgress) {
        onProgress(
          formatGateLine({
            index: i + 1,
            total,
            gateId: gate.id,
            verdict: probeVerdict.verdict,
            blockerReasonCode: probeVerdict.blockerReasonCode,
            elapsedMs: 0,
            color: options.color,
          })
        );
      }
      continue;
    }

    // Step 4: execute
    const execResult = await runByKind(gate);
    const elapsedMs = Date.parse(execResult.finishedAt) - Date.parse(execResult.startedAt);

    let verdict;
    let blockerReasonCode = null;
    if (execResult.timedOut) {
      verdict = 'fail';
      blockerReasonCode = 'TIMEOUT';
    } else if (execResult.exitCode === 0) {
      verdict = 'pass';
    } else {
      verdict = 'fail';
      blockerReasonCode = 'COMMAND_NONZERO';
    }

    // Step 5: write log
    const logExcerptPath = writeGateLog({
      gateId: gate.id,
      startedAt: execResult.startedAt,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
    });

    const row = buildGateRow({
      gateId: gate.id,
      tier,
      target,
      command: gate.command,
      startedAt: execResult.startedAt,
      finishedAt: execResult.finishedAt,
      verdict,
      blockerReasonCode,
      exitCode: execResult.exitCode,
      logExcerptPath,
    });
    rows.push(row);
    verdictById.set(gate.id, verdict);

    if (onProgress) {
      onProgress(
        formatGateLine({
          index: i + 1,
          total,
          gateId: gate.id,
          verdict,
          blockerReasonCode,
          elapsedMs,
          color: options.color,
        })
      );
    }
  }

  return { rows, total };
}

/**
 * Compute exit code from summary per L4 / L5:
 *   --require-release: 0 iff fail==0 AND blocked==0 AND unreachable==0
 *   default:           0 iff fail==0 AND unreachable==0 AND every blocked
 *                      gate's tier is in allow-blocked-tiers
 */
export function computeProcessExitCode({ rows, gatesById, options }) {
  // unreachable always reds the run
  if (rows.some((r) => r.verdict === 'unreachable')) return 1;
  if (rows.some((r) => r.verdict === 'fail')) return 1;

  if (options.requireRelease) {
    if (rows.some((r) => r.verdict === 'blocked')) return 1;
    return 0;
  }

  // dev-friendly: blocked permitted only if gate's tiers ∩ allowBlockedTiers ≠ ∅
  for (const r of rows) {
    if (r.verdict !== 'blocked') continue;
    if (
      r.blocker_reason_code === 'PRECONDITION_NOT_MET' ||
      r.blocker_reason_code === 'REQUIRED_STATE_MISSING'
    ) {
      continue;
    }
    const gate = gatesById.get(r.gate_id);
    if (!gate) return 1;
    const tiers = gate.tiers ?? [];
    const permitted = tiers.some((t) => options.allowBlockedTiers.includes(t));
    if (!permitted) return 1;
  }
  return 0;
}

function matchGlob(pattern, value) {
  // Tiny glob: supports * (any sequence) and ? (single char). Sufficient
  // for filter expressions like "gate.runtime.*".
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$'
  );
  return re.test(value);
}

export const _internal = { matchGlob };
