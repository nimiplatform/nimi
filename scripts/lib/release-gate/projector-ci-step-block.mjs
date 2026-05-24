// Projection function: registry → CI workflow YAML step block.
//
// Owner: scripts (W2 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-003 projection-only execution surfaces, P-RELG-010
// owner of .github/** step block codegen.
//
// Pure function. Given a parsed registry + projection-key (e.g.
// "release-target-runtime-static-checks"), return the YAML step block
// that should appear inside the corresponding marker fence in a CI
// workflow file. Used by:
//   - W5's scripts/generate-ci-workflow-steps.mjs (write mode)
//   - W2's projection-drift checker (compare mode; W2 mode is no-op
//     because no fence exists yet at W2 close)
//
// Determinism: stable gate selection by (tier, target) projection-key
// inputs; topo-sorted with id tie-break. Output indented to match the
// fence's surrounding YAML scope. Offline-safe.

/**
 * Catalog of projection keys. W5 will land the marker fences across
 * 4 workflow files using these keys; W2 only needs the catalog so the
 * drift checker can recognise unknown keys.
 */
export const PROJECTION_KEY_CATALOG = {
  'core-static-checks': {
    description: 'ci.yml core-static job step list',
    tierFilter: 'fast',
    targetFilter: 'any',
    excludeOwners: ['live'], // live tier excluded from core-static
  },
  'governance-security-checks': {
    description: 'ci.yml governance-security job step list',
    tierFilter: 'fast',
    targetFilter: 'any',
    includeOwners: ['security', 'docs'],
    intersectFilter: true,
  },
  'release-target-sdk-static-checks': {
    description: 'ci.yml sdk-quality + release.yml release-sdk preflight steps',
    tierFilter: 'release-target:sdk',
    targetFilter: 'sdk',
  },
  'release-target-runtime-static-checks': {
    description: 'ci.yml runtime-quality + release-runtime.yml preflight',
    tierFilter: 'release-target:runtime',
    targetFilter: 'runtime',
    excludeIdSubstrings: ['runtime-release-signing'],
  },
  'release-target-desktop-static-checks': {
    description: 'ci.yml desktop-web-quality static checks (excluding E2E)',
    tierFilter: 'release-target:desktop',
    targetFilter: 'desktop',
    excludeIdSubstrings: ['e2e', 'runtime-release-signing'],
  },
  'release-target-desktop-release-checks': {
    description: 'release.yml release-desktop pre-bundle gates',
    tierFilter: 'release-target:desktop',
    targetFilter: 'desktop',
    includeIdSubstrings: ['version-sync', 'release-sync', 'updater-artifacts', 'runtime-release-signing'],
    intersectFilter: true,
  },
  'release-target-proto-checks': {
    description: 'release.yml release-proto step list',
    tierFilter: 'release-target:proto',
    targetFilter: 'proto',
  },
  'mods-quality-checks': {
    description: 'ci.yml mods-quality job step list',
    tierFilter: 'release-target:mods',
    targetFilter: 'mods',
  },
  'live-smoke-checks': {
    description:
      'release.yml/release-runtime.yml/live-smoke-matrix.yml live-smoke-gate step list',
    tierFilter: 'live',
    targetFilter: 'any',
  },
};

const FENCE_HEAD = (key) => `# >>> nimi-release-gate-projection: ${key} >>>`;
const FENCE_TAIL = (key) => `# <<< nimi-release-gate-projection: ${key} <<<`;

/**
 * Test if a projection-key is a known catalog entry.
 */
export function isKnownProjectionKey(key) {
  return Object.prototype.hasOwnProperty.call(PROJECTION_KEY_CATALOG, key);
}

/**
 * Compute the projected fence content (interior only — without the
 * head/tail marker lines) for a given projection-key.
 *
 * @param {object} registry
 * @param {string} projectionKey
 * @param {object} [opts]
 * @param {number} [opts.indent=6] - leading-space indent for each line
 *        (default matches GitHub Actions step list nesting under jobs.<j>.steps:)
 * @returns {{ body: string, gateIds: string[] }}
 */
export function projectCiStepBlock(registry, projectionKey, opts = {}) {
  if (!isKnownProjectionKey(projectionKey)) {
    throw new Error(`projectCiStepBlock: unknown projection-key: ${projectionKey}`);
  }
  if (!registry || !Array.isArray(registry.gates)) {
    throw new Error('projectCiStepBlock: registry.gates required');
  }
  const indent = typeof opts.indent === 'number' ? opts.indent : 6;
  const cfg = PROJECTION_KEY_CATALOG[projectionKey];

  let candidates = registry.gates.filter(
    (g) =>
      Array.isArray(g.tiers) &&
      g.tiers.includes(cfg.tierFilter) &&
      !g.experimental
  );

  if (cfg.targetFilter && cfg.targetFilter !== 'any') {
    candidates = candidates.filter(
      (g) =>
        Array.isArray(g.targets) &&
        (g.targets.includes(cfg.targetFilter) || g.targets.includes('any'))
    );
  }

  if (cfg.includeOwners) {
    candidates = candidates.filter((g) => {
      const owner = g.id.split('.')[1];
      return cfg.includeOwners.includes(owner);
    });
  }

  if (cfg.excludeOwners) {
    candidates = candidates.filter((g) => {
      const owner = g.id.split('.')[1];
      return !cfg.excludeOwners.includes(owner);
    });
  }

  if (cfg.includeIdSubstrings) {
    candidates = candidates.filter((g) =>
      cfg.includeIdSubstrings.some((sub) => g.id.includes(sub))
    );
  }

  if (cfg.excludeIdSubstrings) {
    candidates = candidates.filter(
      (g) => !cfg.excludeIdSubstrings.some((sub) => g.id.includes(sub))
    );
  }

  candidates = topoSortCandidates(candidates);

  // Render each gate as a step
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const gate of candidates) {
    lines.push(`${pad}- name: ${gate.id}`);
    if (gate.cwd && gate.cwd !== '.') {
      lines.push(`${pad}  working-directory: ${gate.cwd}`);
    }
    lines.push(`${pad}  run: ${gate.command}`);
  }
  return { body: lines.join('\n') + (lines.length > 0 ? '\n' : ''), gateIds: candidates.map((g) => g.id) };
}

/**
 * Compose the full fence (head + body + tail) for embedding directly
 * into a workflow file.
 */
export function composeFence(registry, projectionKey, opts = {}) {
  const indent = typeof opts.indent === 'number' ? opts.indent : 6;
  const pad = ' '.repeat(indent);
  const { body, gateIds } = projectCiStepBlock(registry, projectionKey, opts);
  const lines = [
    `${pad}${FENCE_HEAD(projectionKey)}`,
    body.replace(/\n+$/, ''),
    `${pad}${FENCE_TAIL(projectionKey)}`,
  ];
  return { fence: lines.filter((l) => l.length > 0).join('\n') + '\n', gateIds };
}

export const _internal = {
  FENCE_HEAD,
  FENCE_TAIL,
  topoSortCandidates,
};

function topoSortCandidates(candidates) {
  const byId = new Map(candidates.map((gate) => [gate.id, gate]));
  const dependenciesById = new Map();
  const dependentsById = new Map();
  const ready = [];

  for (const gate of candidates) {
    const dependencies = (Array.isArray(gate.prerequisites) ? gate.prerequisites : [])
      .filter((id) => byId.has(id))
      .sort((a, b) => a.localeCompare(b));
    dependenciesById.set(gate.id, new Set(dependencies));
    if (dependencies.length === 0) {
      ready.push(gate.id);
    }
    for (const dependency of dependencies) {
      if (!dependentsById.has(dependency)) {
        dependentsById.set(dependency, []);
      }
      dependentsById.get(dependency).push(gate.id);
    }
  }

  ready.sort((a, b) => a.localeCompare(b));
  for (const dependents of dependentsById.values()) {
    dependents.sort((a, b) => a.localeCompare(b));
  }

  const ordered = [];
  while (ready.length > 0) {
    const id = ready.shift();
    ordered.push(byId.get(id));

    for (const dependent of dependentsById.get(id) ?? []) {
      const dependencies = dependenciesById.get(dependent);
      dependencies.delete(id);
      if (dependencies.size === 0) {
        ready.push(dependent);
        ready.sort((a, b) => a.localeCompare(b));
      }
    }
  }

  if (ordered.length !== candidates.length) {
    const cycleIds = candidates
      .map((gate) => gate.id)
      .filter((id) => !ordered.some((gate) => gate.id === id))
      .sort((a, b) => a.localeCompare(b));
    throw new Error(
      `projectCiStepBlock: prerequisite cycle in projection candidates: ${cycleIds.join(', ')}`
    );
  }

  return ordered;
}
