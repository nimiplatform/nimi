// Projection function: registry → pnpm lint chain body.
//
// Owner: scripts (W2 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-003 projection-only execution surfaces.
//
// Pure function. Given a parsed registry, return the byte string that
// `package.json` `scripts.lint` should hold. Used by:
//   - W3's scripts/generate-lint-chain.mjs (write mode)
//   - W2's projection-drift checker (compare mode)
//
// Determinism: gate selection is by tier=fast filter, then topo-sorted
// by prerequisites with stable tie-break by gate id. Same registry →
// same byte output. Offline-safe.
//
// W2 mode (current): the lint chain is NOT yet regenerated from the
// registry. The projection function exists so W2's drift checker can
// compute "what the projected lint body WOULD be" — useful for the
// future W3 transition. W3 lands the actual write to package.json.

const FAST_TIER = 'fast';

/**
 * Compute the projected pnpm lint chain body from a parsed registry.
 *
 * @param {object} registry
 * @returns {{ body: string, gateIds: string[] }}
 */
export function projectLintChain(registry) {
  if (!registry || !Array.isArray(registry.gates)) {
    throw new Error('projectLintChain: registry.gates required');
  }

  const fastGates = registry.gates.filter(
    (g) => Array.isArray(g.tiers) && g.tiers.includes(FAST_TIER) && !g.experimental
  );

  // Topo sort by prerequisites; stable tie-break by id.
  const ordered = topoSort(fastGates);
  const commands = ordered.map((g) => g.command);
  const body = commands.join(' && ');
  return { body, gateIds: ordered.map((g) => g.id) };
}

/**
 * Topological sort by prerequisites among the supplied gate set.
 * Stable tie-break by gate.id ascending.
 */
function topoSort(gates) {
  const ids = new Set(gates.map((g) => g.id));
  const byId = new Map(gates.map((g) => [g.id, g]));
  const colour = new Map();
  for (const g of gates) colour.set(g.id, 'WHITE');
  const order = [];

  function visit(id) {
    const c = colour.get(id);
    if (c === 'BLACK') return;
    if (c === 'GRAY') return; // cycles caught by registry coherence checker
    colour.set(id, 'GRAY');
    const gate = byId.get(id);
    const prereqs = (gate?.prerequisites ?? [])
      .filter((p) => ids.has(p))
      .slice()
      .sort();
    for (const p of prereqs) visit(p);
    colour.set(id, 'BLACK');
    if (gate) order.push(gate);
  }

  const sorted = gates.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const g of sorted) visit(g.id);
  return order;
}

export const _internal = {
  FAST_TIER,
  topoSort,
};
