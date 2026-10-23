export const MAX_PARTICLE_PAIR_ATTEMPTS = 4096;

export function particleCellKey(x: number, y: number): number {
  return ((x + 4096) << 13) | (y + 4096);
}

const NEIGHBOR_OFFSETS = [
  [0, 0], [-1, -1], [0, -1], [1, -1], [-1, 0],
  [1, 0], [-1, 1], [0, 1], [1, 1],
] as const;

/** Share the work budget across particles, including a single very dense cell. */
export function visitParticleNeighbors(
  buckets: ReadonlyMap<number, readonly number[]>,
  cells: Int32Array,
  particleCount: number,
  visit: (left: number, right: number) => void,
): number {
  const perParticle = Math.max(1, Math.floor(MAX_PARTICLE_PAIR_ATTEMPTS / particleCount));
  const adjacent: Array<readonly number[]> = [];
  const first = new Int32Array(NEIGHBOR_OFFSETS.length);
  const used = new Int32Array(NEIGHBOR_OFFSETS.length);
  let attempts = 0;
  for (let left = 0; left < particleCount && attempts < MAX_PARTICLE_PAIR_ATTEMPTS; left++) {
    adjacent.length = 0;
    used.fill(0);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const neighbors = buckets.get(particleCellKey(cells[left * 2]! + dx, cells[left * 2 + 1]! + dy));
      if (!neighbors?.length) continue;
      // Bucketing inserts ascending particle IDs. Skip self/reversed edges
      // without walking an arbitrarily dense cell or spending its sample budget.
      let low = 0;
      let high = neighbors.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (neighbors[mid]! <= left) low = mid + 1;
        else high = mid;
      }
      if (low === neighbors.length) continue;
      first[adjacent.length] = low;
      adjacent.push(neighbors);
    }
    let remaining = Math.min(perParticle, MAX_PARTICLE_PAIR_ATTEMPTS - attempts);
    // Take one candidate per nonempty cell per round. Dense own cells must
    // not prevent connections and forces crossing cell boundaries.
    while (remaining > 0 && adjacent.length > 0) {
      let visited = false;
      for (let slot = 0; slot < adjacent.length && remaining > 0; slot++) {
        const index = (left + slot) % adjacent.length;
        const neighbors = adjacent[index]!;
        const available = neighbors.length - first[index]!;
        if (used[index]! >= available) continue;
        const right = neighbors[first[index]! + ((left + used[index]!) % available)]!;
        used[index]!++;
        attempts++;
        remaining--;
        visited = true;
        visit(left, right);
      }
      if (!visited) break;
    }
  }
  return attempts;
}
