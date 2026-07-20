// Registry loader — canonical parse path for the release gate registry.
//
// Owner: scripts; governed by the release-gate registry authority.
// Authority: P-RELG-001..014 in
// .nimi/spec/platform/kernel/release-gate-contract.md.
//
// All consumers of the release-gate-registry.yaml MUST use this module
// (registry coherence checker, projection drift checker, preflight runner,
// lint chain generator, CI step block generator). Hand-written yaml parses
// are forbidden by P-RELG-003 (projection-only execution surfaces).

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const REGISTRY_PATH_DEFAULT =
  '.nimi/spec/platform/kernel/tables/release-gate-registry.yaml';

const SCHEMA_VERSION = 'release-gate-registry/v1';

const OWNER_ALLOWLIST = new Set([
  'app-tools',
  'cargo',
  'cognition',
  'desktop',
  'dev-loop',
  'docs',
  'live',
  'nimicoding',
  'platform-hardcut',
  'proto',
  'realm',
  'release-gate',
  'runtime',
  'runtime-provider',
  'sdk',
  'security',
  'spec-governance',
  'tester',
  'ui',
  'web',
  'workflow',
]);

const GATE_ID_PATTERN = /^gate\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

const VALID_EVIDENCE_SHAPES = new Set([
  'command_exit',
  'json_file',
  'log_file',
]);

const VALID_BLOCKER_POLICIES = new Set(['blocked', 'fail']);
const VALID_SKIP_WHEN_CONDITIONS = new Set([
  'macos',
  'not_macos',
  'linux',
  'not_linux',
  'windows',
  'not_windows',
  'local',
  'ci',
]);

/**
 * Read and parse the registry yaml from disk.
 *
 * @param {string} [registryPath] - relative or absolute path to the yaml.
 * @returns {{ ok: true, registry: object } | { ok: false, errors: string[] }}
 */
export function loadRegistry(registryPath = REGISTRY_PATH_DEFAULT) {
  let absolutePath;
  try {
    absolutePath = path.isAbsolute(registryPath)
      ? registryPath
      : path.resolve(process.cwd(), registryPath);
  } catch (error) {
    return {
      ok: false,
      errors: [`registry path resolution failed: ${String(error?.message ?? error)}`],
    };
  }

  let raw;
  try {
    raw = fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      errors: [
        `registry file not found or unreadable: ${absolutePath}: ${String(error?.message ?? error)}`,
      ],
    };
  }

  let registry;
  try {
    registry = YAML.parse(raw);
  } catch (error) {
    return {
      ok: false,
      errors: [`registry yaml parse failed: ${String(error?.message ?? error)}`],
    };
  }

  if (registry == null || typeof registry !== 'object') {
    return { ok: false, errors: ['registry top-level must be a mapping'] };
  }

  return { ok: true, registry };
}

/**
 * Validate the registry against the D2 schema rules + P-RELG-008
 * owner allow-list.
 *
 * @param {object} registry - parsed yaml object
 * @param {object} [contextOverride] - { knownPRelgIds, knownPGovIds }
 *        for tests that want to inject these without touching disk.
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateRegistry(registry, contextOverride = {}) {
  const errors = [];

  // Rule 1: schema_version literal
  if (registry.schema_version !== SCHEMA_VERSION) {
    errors.push(
      `schema_version must be exactly "${SCHEMA_VERSION}" (got: ${JSON.stringify(registry.schema_version)})`
    );
  }

  // Rule: registry_version is required and follows semver-ish pattern
  if (typeof registry.registry_version !== 'string') {
    errors.push('registry_version must be a string');
  } else if (!/^\d+\.\d+\.\d+(-.+)?$/.test(registry.registry_version)) {
    errors.push(
      `registry_version must match \\d+.\\d+.\\d+ (got: ${registry.registry_version})`
    );
  }

  // Rule: profile_id required
  if (typeof registry.profile_id !== 'string' || registry.profile_id.length === 0) {
    errors.push('profile_id must be a non-empty string');
  }

  // Tier and target enumerations
  const tierIds = new Set();
  if (!Array.isArray(registry.tiers) || registry.tiers.length === 0) {
    errors.push('tiers must be a non-empty array');
  } else {
    for (const t of registry.tiers) {
      if (t == null || typeof t !== 'object' || typeof t.id !== 'string') {
        errors.push(`tiers entry malformed: ${JSON.stringify(t)}`);
        continue;
      }
      if (tierIds.has(t.id)) {
        errors.push(`tier id duplicate: ${t.id}`);
      }
      tierIds.add(t.id);
    }
  }

  const targetIds = new Set();
  if (!Array.isArray(registry.targets) || registry.targets.length === 0) {
    errors.push('targets must be a non-empty array');
  } else {
    for (const t of registry.targets) {
      if (typeof t !== 'string') {
        errors.push(`targets entry must be a string, got: ${JSON.stringify(t)}`);
        continue;
      }
      if (targetIds.has(t)) {
        errors.push(`target duplicate: ${t}`);
      }
      targetIds.add(t);
    }
  }

  // Reason codes
  const reasonCodeIds = new Set();
  if (!Array.isArray(registry.reason_codes)) {
    errors.push('reason_codes must be an array');
  } else {
    for (const r of registry.reason_codes) {
      if (r == null || typeof r !== 'object' || typeof r.id !== 'string') {
        errors.push(`reason_codes entry malformed: ${JSON.stringify(r)}`);
        continue;
      }
      if (!/^[A-Z][A-Z0-9_]*$/.test(r.id)) {
        errors.push(`reason_codes id must be UPPER_SNAKE: ${r.id}`);
      }
      if (reasonCodeIds.has(r.id)) {
        errors.push(`reason_code duplicate: ${r.id}`);
      }
      reasonCodeIds.add(r.id);
    }
  }

  // Gates
  if (!Array.isArray(registry.gates)) {
    errors.push('gates must be an array');
    return { ok: errors.length === 0, ...(errors.length > 0 ? { errors } : {}) };
  }

  if (registry.gates.length === 0) {
    errors.push('gates array must not be empty (registry with zero rows is forbidden by P-RELG-001)');
  }

  // Build gate-id index for prerequisite checks
  const gateIds = new Set();
  for (const g of registry.gates) {
    if (g != null && typeof g === 'object' && typeof g.id === 'string') {
      if (gateIds.has(g.id)) {
        errors.push(`gate id duplicate: ${g.id}`);
      }
      gateIds.add(g.id);
    }
  }

  const knownPRelgIds = contextOverride.knownPRelgIds ?? null;
  const knownPGovIds = contextOverride.knownPGovIds ?? null;

  for (const g of registry.gates) {
    if (g == null || typeof g !== 'object') {
      errors.push(`gates entry malformed: ${JSON.stringify(g)}`);
      continue;
    }
    if (typeof g.id !== 'string') {
      errors.push(`gate.id missing or non-string in entry: ${JSON.stringify(g).slice(0, 80)}`);
      continue;
    }

    // Rule 2: gate id pattern + uniqueness already done above
    if (!GATE_ID_PATTERN.test(g.id)) {
      errors.push(
        `gate.id pattern violation: ${g.id} (must match ^gate\\.<owner>\\.<short-name>$ lowercase kebab)`
      );
    }

    // Rule 3: owner namespace allow-list (P-RELG-008)
    const segments = g.id.split('.');
    if (segments.length === 3) {
      const owner = segments[1];
      if (!OWNER_ALLOWLIST.has(owner)) {
        errors.push(
          `gate.id owner segment "${owner}" not in allow-list (P-RELG-008): ${g.id}`
        );
      }
    }

    // Rule 4: tiers
    if (!Array.isArray(g.tiers) || g.tiers.length === 0) {
      errors.push(`${g.id}: tiers must be non-empty array`);
    } else {
      for (const t of g.tiers) {
        if (typeof t !== 'string' || !tierIds.has(t)) {
          errors.push(`${g.id}: unknown tier reference: ${t}`);
        }
      }
    }

    // Rule 5: targets
    if (!Array.isArray(g.targets) || g.targets.length === 0) {
      errors.push(`${g.id}: targets must be non-empty array`);
    } else {
      for (const t of g.targets) {
        if (typeof t !== 'string' || !targetIds.has(t)) {
          errors.push(`${g.id}: unknown target reference: ${t}`);
        }
      }
    }

    // Rule: tier membership constraints (P-RELG-012)
    const inRelease = (g.tiers ?? []).includes('release');
    for (const t of g.tiers ?? []) {
      if (typeof t !== 'string') continue;
      if (t.startsWith('release-target:') && !inRelease) {
        errors.push(`${g.id}: tier ${t} requires also being in 'release' tier (P-RELG-012)`);
      }
      if (t === 'live' && !inRelease) {
        errors.push(`${g.id}: tier 'live' requires also being in 'release' tier (P-RELG-012)`);
      }
    }

    // Rule 6: reason codes referenced
    if (g.skip_when != null) {
      if (typeof g.skip_when !== 'object' || typeof g.skip_when.reason_code !== 'string') {
        errors.push(`${g.id}: skip_when must have reason_code string`);
      } else {
        if (!reasonCodeIds.has(g.skip_when.reason_code)) {
          errors.push(`${g.id}: skip_when.reason_code unknown: ${g.skip_when.reason_code}`);
        }
        if (
          typeof g.skip_when.condition !== 'string' ||
          !VALID_SKIP_WHEN_CONDITIONS.has(g.skip_when.condition)
        ) {
          errors.push(`${g.id}: skip_when.condition must be one of ${[...VALID_SKIP_WHEN_CONDITIONS].join('|')}`);
        }
      }
    }

    // Rule 7: prerequisites resolve (no cycle check needed at row level; cycles caught after build)
    if (g.prerequisites != null) {
      if (!Array.isArray(g.prerequisites)) {
        errors.push(`${g.id}: prerequisites must be array`);
      } else {
        for (const p of g.prerequisites) {
          if (typeof p !== 'string') {
            errors.push(`${g.id}: prerequisite not string: ${JSON.stringify(p)}`);
          } else if (!gateIds.has(p)) {
            errors.push(`${g.id}: prerequisite ${p} does not resolve to a gate id`);
          } else if (p === g.id) {
            errors.push(`${g.id}: prerequisite cannot reference self`);
          }
        }
      }
    }

    // Rule 8/9: anchors (only validated if context provides the known sets)
    if (g.p_relg_anchors != null) {
      if (!Array.isArray(g.p_relg_anchors) || g.p_relg_anchors.length === 0) {
        errors.push(`${g.id}: p_relg_anchors must be non-empty array`);
      } else if (knownPRelgIds != null) {
        for (const id of g.p_relg_anchors) {
          if (typeof id !== 'string' || !knownPRelgIds.has(id)) {
            errors.push(`${g.id}: p_relg_anchor not resolvable: ${id}`);
          }
        }
      }
    } else {
      errors.push(`${g.id}: p_relg_anchors required (at least one)`);
    }

    if (g.parent_p_gov_anchors != null) {
      if (!Array.isArray(g.parent_p_gov_anchors) || g.parent_p_gov_anchors.length === 0) {
        errors.push(`${g.id}: parent_p_gov_anchors must be non-empty array`);
      } else if (knownPGovIds != null) {
        for (const id of g.parent_p_gov_anchors) {
          if (typeof id !== 'string' || !knownPGovIds.has(id)) {
            errors.push(`${g.id}: parent_p_gov_anchor not resolvable: ${id}`);
          }
        }
      }
    } else {
      errors.push(`${g.id}: parent_p_gov_anchors required (at least one)`);
    }

    // Rule 10: evidence shape
    if (g.evidence == null || typeof g.evidence !== 'object') {
      errors.push(`${g.id}: evidence must be a mapping with shape field`);
    } else if (typeof g.evidence.shape !== 'string' || !VALID_EVIDENCE_SHAPES.has(g.evidence.shape)) {
      errors.push(
        `${g.id}: evidence.shape must be one of ${[...VALID_EVIDENCE_SHAPES].join('|')} (got: ${g.evidence.shape})`
      );
    } else if (g.evidence.shape === 'json_file' && typeof g.evidence.json_file_path !== 'string') {
      errors.push(`${g.id}: evidence.shape=json_file requires evidence.json_file_path string`);
    }

    // Rule 11: requires_env format
    if (g.requires_env != null) {
      if (!Array.isArray(g.requires_env)) {
        errors.push(`${g.id}: requires_env must be array`);
      } else {
        for (const s of g.requires_env) {
          if (typeof s !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(s)) {
            errors.push(`${g.id}: requires_env entry must be UPPER_SNAKE env var name: ${s}`);
          }
        }
      }
    }

    // Rule 12: requires_secrets format
    if (g.requires_secrets != null) {
      if (!Array.isArray(g.requires_secrets)) {
        errors.push(`${g.id}: requires_secrets must be array`);
      } else {
        for (const s of g.requires_secrets) {
          if (typeof s !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(s)) {
            errors.push(`${g.id}: requires_secrets entry must be UPPER_SNAKE env var name: ${s}`);
          }
        }
      }
    }

    // Rule 13: requires_external_repo
    if (g.requires_external_repo != null) {
      if (!Array.isArray(g.requires_external_repo)) {
        errors.push(`${g.id}: requires_external_repo must be array`);
      } else {
        for (const r of g.requires_external_repo) {
          if (typeof r !== 'string' || r.startsWith('/') || r.length === 0) {
            errors.push(`${g.id}: requires_external_repo entry must be relative path: ${r}`);
          }
        }
      }
    }

    // Rule 14: experimental flag must be boolean if present
    if (g.experimental != null && typeof g.experimental !== 'boolean') {
      errors.push(`${g.id}: experimental must be boolean`);
    }

    // blocker_semantics policies must be valid
    if (g.blocker_semantics != null) {
      if (typeof g.blocker_semantics !== 'object') {
        errors.push(`${g.id}: blocker_semantics must be a mapping`);
      } else {
        for (const [key, value] of Object.entries(g.blocker_semantics)) {
          if (!VALID_BLOCKER_POLICIES.has(value)) {
            errors.push(
              `${g.id}: blocker_semantics.${key} must be one of ${[...VALID_BLOCKER_POLICIES].join('|')} (got: ${value})`
            );
          }
        }
      }
    }

    // command + runner are required
    if (typeof g.command !== 'string' || g.command.trim().length === 0) {
      errors.push(`${g.id}: command must be a non-empty string`);
    }
    if (
      typeof g.runner !== 'string' ||
      !['pnpm', 'node', 'go', 'shell'].includes(g.runner)
    ) {
      errors.push(`${g.id}: runner must be one of pnpm|node|go|shell (got: ${g.runner})`);
    }
  }

  // Cycle detection in prerequisites
  if (errors.length === 0 || errors.every((e) => !e.includes('prerequisite'))) {
    const cycleErrors = detectPrerequisiteCycles(registry.gates);
    errors.push(...cycleErrors);
  }

  if (tierIds.has('regression')) {
    const regressionGates = registry.gates.filter((gate) => gate?.tiers?.includes('regression'));
    if (regressionGates.length !== 1) {
      errors.push(`regression tier must contain exactly one workspace aggregate (got: ${regressionGates.length})`);
    }
    for (const gate of regressionGates) {
      if (gate.id !== 'gate.workflow.workspace-regression' || gate.command !== 'pnpm test') {
        errors.push(`${gate.id}: regression tier must bind gate.workflow.workspace-regression to pnpm test`);
      }
      if ((gate.tiers ?? []).some((tier) => tier === 'release' || tier === 'live' || tier.startsWith('release-target:'))) {
        errors.push(`${gate.id}: regression aggregate must not also enter release or live tiers`);
      }
      if ((gate.requires_secrets ?? []).length > 0 || (gate.requires_external_repo ?? []).length > 0) {
        errors.push(`${gate.id}: regression aggregate must not require secrets or an external repository`);
      }
      if (gate.skip_when != null) {
        errors.push(`${gate.id}: regression aggregate must not declare skip_when`);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function detectPrerequisiteCycles(gates) {
  const errors = [];
  const adjacency = new Map();
  for (const g of gates) {
    if (g != null && typeof g.id === 'string') {
      adjacency.set(g.id, Array.isArray(g.prerequisites) ? g.prerequisites.slice() : []);
    }
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  for (const id of adjacency.keys()) color.set(id, WHITE);

  function dfs(id, stack) {
    color.set(id, GRAY);
    stack.push(id);
    const deps = adjacency.get(id) || [];
    for (const d of deps) {
      if (!adjacency.has(d)) continue;
      const c = color.get(d);
      if (c === GRAY) {
        const cycleStart = stack.indexOf(d);
        const cycle = stack.slice(cycleStart).concat(d);
        errors.push(`prerequisite cycle: ${cycle.join(' -> ')}`);
        return;
      }
      if (c === WHITE) dfs(d, stack);
    }
    stack.pop();
    color.set(id, BLACK);
  }

  for (const id of adjacency.keys()) {
    if (color.get(id) === WHITE) dfs(id, []);
  }
  return errors;
}

/**
 * Read the P-RELG-* rule ids declared in
 * .nimi/spec/platform/kernel/release-gate-contract.md.
 *
 * @returns {Set<string>} set of "P-RELG-XXX" ids found
 */
export function loadKnownPRelgIds(
  contractPath = '.nimi/spec/platform/kernel/release-gate-contract.md'
) {
  const ids = new Set();
  try {
    const text = fs.readFileSync(contractPath, 'utf8');
    const re = /^## (P-RELG-\d+)/gmu;
    let match;
    while ((match = re.exec(text)) != null) ids.add(match[1]);
  } catch {
    /* best-effort; caller may pass empty set */
  }
  return ids;
}

/**
 * Read the P-GOV-* rule ids declared in
 * .nimi/spec/platform/kernel/governance-contract.md.
 *
 * @returns {Set<string>} set of "P-GOV-XXX" ids found
 */
export function loadKnownPGovIds(
  contractPath = '.nimi/spec/platform/kernel/governance-contract.md'
) {
  const ids = new Set();
  try {
    const text = fs.readFileSync(contractPath, 'utf8');
    const re = /^## (P-GOV-\d+)/gmu;
    let match;
    while ((match = re.exec(text)) != null) ids.add(match[1]);
  } catch {
    /* best-effort */
  }
  return ids;
}

export const _internal = {
  OWNER_ALLOWLIST,
  GATE_ID_PATTERN,
  SCHEMA_VERSION,
  detectPrerequisiteCycles,
};
