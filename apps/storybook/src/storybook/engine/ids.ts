// App-local id and ref minting. Storybook ids are app-owned and project-scoped;
// they are not Realm refs, Runtime ids, or platform identifiers.
//
// Deterministic by construction where the caller supplies a localId, so that
// truth refs survive into projections, evidence, and validation (Forge alignment
// rule). A random suffix is only used when no stable localId is available.

let monotonic = 0;

function suffix(): string {
  monotonic = (monotonic + 1) % 0xffffff;
  const rand = Math.floor(Math.random() * 0xffffff);
  return `${monotonic.toString(36)}${rand.toString(36)}`;
}

export function mintId(prefix: string): string {
  return `${prefix}_${suffix()}`;
}

/** Truth-rule and truth-object families used inside the truth-ref namespace. */
export type TruthFamily =
  | 'world-rule'
  | 'agent-rule'
  | 'storybook-rule'
  | 'branch-rule'
  | 'style-rule'
  | 'asset-rule'
  | 'feedback-rule'
  | 'scenario-frame'
  | 'agent-cast'
  | 'storybook-bible'
  | 'adaptation-brief'
  | 'divergence-decision'
  | 'visual-style-guide'
  | 'branch-topology'
  | 'state-ending-matrix'
  | 'chapter'
  | 'story-node'
  | 'asset-spec'
  | 'source-memory-index'
  | 'scenario-seed-index';

/**
 * Stable truth ref. Shape: `truth:<projectId>:<family>:<localId>`. Evidence
 * bindings, projection inputs, validators, and promotion records all point back
 * to truth refs through this namespace.
 */
export type TruthRef = `truth:${string}:${TruthFamily}:${string}`;

export function makeTruthRef(projectId: string, family: TruthFamily, localId: string): TruthRef {
  return `truth:${projectId}:${family}:${localId}` as TruthRef;
}

export function parseTruthRef(ref: string): { projectId: string; family: TruthFamily; localId: string } | null {
  const parts = ref.split(':');
  if (parts.length !== 4 || parts[0] !== 'truth') return null;
  const [, projectId, family, localId] = parts;
  if (!projectId || !family || !localId) return null;
  return { projectId, family: family as TruthFamily, localId };
}

export function isTruthRef(value: unknown): value is TruthRef {
  return typeof value === 'string' && parseTruthRef(value) !== null;
}
