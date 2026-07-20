// Projection function: registry → CI workflow YAML step block.
//
// Owner: scripts; governed by the release-gate registry authority.
// Authority: P-RELG-003 projection-only execution surfaces, P-RELG-010
// owner of .github/** step block codegen.
//
// Pure function. Given a parsed registry + projection-key (e.g.
// "release-target-runtime-static-checks"), return the YAML step block
// that should appear inside the corresponding marker fence in a CI
// workflow file. Used by the writer and the fail-closed drift checker.
//
// Determinism: stable gate selection by (tier, target) projection-key
// inputs; topo-sorted with id tie-break. Output indented to match the
// fence's surrounding YAML scope. Offline-safe.

/**
 * Catalog of current projection keys.
 */
export const PROJECTION_KEY_CATALOG = {
  'core-static-checks': {
    description: 'ci.yml core-static job step list',
    tierFilter: 'fast',
    targetFilter: 'any',
    runnerPlatform: 'linux',
    excludeOwners: ['live'], // live tier excluded from core-static
  },
  'workspace-regression-checks': {
    description: 'ci.yml deterministic workspace regression aggregate',
    tierFilter: 'regression',
    targetFilter: 'any',
    runnerPlatform: 'linux',
  },
  'release-target-sdk-static-checks': {
    description: 'ci.yml sdk-quality + release.yml release-sdk preflight steps',
    tierFilter: 'release-target:sdk',
    targetFilter: 'sdk',
    runnerPlatform: 'linux',
  },
  'release-target-runtime-static-checks': {
    description: 'ci.yml runtime-quality + release-runtime.yml preflight',
    tierFilter: 'release-target:runtime',
    targetFilter: 'runtime',
    runnerPlatform: 'linux',
    excludeIdSubstrings: ['runtime-release-signing', 'baseline-exists'],
  },
  'release-target-runtime-preconditions': {
    description: 'runtime release preconditions that are supplied by the proto fence in combined assurance jobs',
    tierFilter: 'release-target:runtime',
    targetFilter: 'runtime',
    runnerPlatform: 'linux',
    includeIdSubstrings: ['baseline-exists'],
  },
  'release-target-desktop-static-checks': {
    description: 'ci.yml desktop-web-quality static checks (excluding E2E)',
    tierFilter: 'release-target:desktop',
    targetFilter: 'desktop',
    runnerPlatform: 'linux',
    excludeIdSubstrings: [
      'e2e',
      'acceptance',
      'live-runtime',
      'runtime-release-signing',
      'updater-artifacts',
    ],
  },
  'release-target-desktop-release-checks': {
    description: 'release.yml release-desktop post-bundle artifact gates',
    tierFilter: 'release-target:desktop',
    targetFilter: 'desktop',
    includeIdSubstrings: ['updater-artifacts', 'runtime-release-signing'],
    intersectFilter: true,
  },
  'release-target-proto-checks': {
    description: 'release.yml release-proto step list',
    tierFilter: 'release-target:proto',
    targetFilter: 'proto',
    runnerPlatform: 'linux',
  },
  'live-smoke-checks': {
    description:
      'release.yml/release-runtime.yml/live-smoke-matrix.yml live-smoke-gate step list',
    tierFilter: 'live',
    targetFilter: 'any',
    runnerPlatform: 'linux',
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

  if (cfg.runnerPlatform) {
    candidates = candidates.filter(
      (gate) => !skipWhenMatchesCiPlatform(gate.skip_when?.condition, cfg.runnerPlatform)
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
  skipWhenMatchesCiPlatform,
  topoSortCandidates,
};

function skipWhenMatchesCiPlatform(condition, platform) {
  if (!condition) return false;
  const isMacos = platform === 'macos';
  const isLinux = platform === 'linux';
  const isWindows = platform === 'windows';
  return (
    (condition === 'macos' && isMacos) ||
    (condition === 'not_macos' && !isMacos) ||
    (condition === 'linux' && isLinux) ||
    (condition === 'not_linux' && !isLinux) ||
    (condition === 'windows' && isWindows) ||
    (condition === 'not_windows' && !isWindows) ||
    condition === 'ci'
  );
}

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
