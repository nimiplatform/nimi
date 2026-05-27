// Argv parser for scripts/release-preflight.mjs.
//
// Owner: scripts (W2 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-005 verdict semantics, P-RELG-006 fail-closed,
// P-RELG-014 evidence output paths.
//
// Determinism: parse only; no I/O; no environment reads.
// Offline-safe: yes.

const VALID_TIERS_HINT = [
  'pre-commit',
  'fast',
  'release',
  'release-target:sdk',
  'release-target:runtime',
  'release-target:proto',
  'release-target:desktop',
  'release-target:web',
  'live',
  'external-repo',
  'nightly',
];

const DEFAULT_ALLOW_BLOCKED_TIERS = ['live', 'external-repo'];

const USAGE = [
  'Usage: pnpm preflight [options]',
  '',
  'Options:',
  '  --tier <id>                 Run only gates in the specified tier',
  '                              (default: release)',
  '  --target <name>             Run only gates whose targets[] include the name',
  '                              or whose targets includes "any"',
  '                              (default: any)',
  '  --include <id[,id...]>      Additionally include gates from these tiers',
  '  --allow-blocked-tiers <id[,id...]>',
  '                              Treat blocked verdicts in these tiers as',
  '                              non-failing (default: live,external-repo).',
  '                              Forbidden together with --require-release.',
  '  --require-release           Treat blocked verdicts as fail in summary',
  '                              (CI release path uses this)',
  '  --filter <glob>             Filter gate ids by glob (e.g. gate.runtime.*)',
  '  --json                      Print evidence JSON to stdout in addition',
  '                              to writing the evidence file',
  '  --evidence-out <path>       Override evidence JSON output path',
  '                              (default: .local/report/release/preflight-evidence-<ISO8601>.json)',
  '  --no-color                  Disable TTY colour output',
  '  --registry-path <path>      Override registry yaml path',
  '                              (default: .nimi/spec/platform/kernel/tables/release-gate-registry.yaml)',
  '  --help                      Print this help and exit',
  '',
  'Verdict semantics (P-RELG-005):',
  '  pass         command exited 0',
  '  fail         command exited non-zero or timed out',
  '  blocked      env probe could not satisfy declared requirement',
  '  unreachable  prerequisite gate did not pass',
  '',
  'Exit semantics:',
  '  --require-release: 0 iff fail==0 AND blocked==0 AND unreachable==0',
  '  default:           0 iff fail==0 AND unreachable==0',
  '                     (blocked permitted when allow-blocked-tiers covers it)',
].join('\n');

function splitCsv(value) {
  if (typeof value !== 'string' || value.length === 0) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse argv (excluding node + script).
 *
 * @param {string[]} argv
 * @returns {{ ok: true, options: object } | { ok: false, error: string }}
 */
export function parseArgs(argv) {
  const options = {
    tier: 'release',
    target: 'any',
    include: [],
    allowBlockedTiers: null, // resolved after parsing if not set
    requireRelease: false,
    filter: null,
    json: false,
    evidenceOut: null,
    color: true,
    registryPath: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--tier':
        options.tier = argv[++i];
        if (typeof options.tier !== 'string' || options.tier.length === 0) {
          return { ok: false, error: '--tier requires a value' };
        }
        break;
      case '--target':
        options.target = argv[++i];
        if (typeof options.target !== 'string' || options.target.length === 0) {
          return { ok: false, error: '--target requires a value' };
        }
        break;
      case '--include':
        options.include = splitCsv(argv[++i]);
        break;
      case '--allow-blocked-tiers':
        options.allowBlockedTiers = splitCsv(argv[++i]);
        break;
      case '--require-release':
        options.requireRelease = true;
        break;
      case '--filter':
        options.filter = argv[++i];
        if (typeof options.filter !== 'string' || options.filter.length === 0) {
          return { ok: false, error: '--filter requires a value' };
        }
        break;
      case '--json':
        options.json = true;
        break;
      case '--evidence-out':
        options.evidenceOut = argv[++i];
        if (typeof options.evidenceOut !== 'string') {
          return { ok: false, error: '--evidence-out requires a value' };
        }
        break;
      case '--no-color':
        options.color = false;
        break;
      case '--registry-path':
        options.registryPath = argv[++i];
        if (typeof options.registryPath !== 'string') {
          return { ok: false, error: '--registry-path requires a value' };
        }
        break;
      default:
        return { ok: false, error: `unknown argument: ${arg}` };
    }
  }

  // Mutual exclusion: --require-release forbids --allow-blocked-tiers
  if (options.requireRelease && options.allowBlockedTiers != null) {
    return {
      ok: false,
      error:
        '--require-release forbids --allow-blocked-tiers (release path treats blocked as fail)',
    };
  }

  // Resolve default allow-blocked-tiers when not overridden
  if (options.allowBlockedTiers == null) {
    options.allowBlockedTiers = options.requireRelease
      ? []
      : DEFAULT_ALLOW_BLOCKED_TIERS.slice();
  }

  // Tier validity (soft validation; the runner will also enforce)
  if (!VALID_TIERS_HINT.includes(options.tier)) {
    // Not strictly fatal — registry may declare custom tiers — but warn shape.
    // Permit through; runner-side will catch if the tier doesn't exist.
  }

  return { ok: true, options };
}

/**
 * Print usage text to stdout.
 */
export function printUsage() {
  process.stdout.write(USAGE + '\n');
}

export const _internal = {
  VALID_TIERS_HINT,
  DEFAULT_ALLOW_BLOCKED_TIERS,
  splitCsv,
};
