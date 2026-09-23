import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';

/**
 * Realm World Studio publishes coauthor candidates awaiting creator review
 * under this versioned extension. Lab reads a few of its business fields for
 * display only; the fields are publisher product content, never authority.
 */
export const WORLD_STUDIO_APP_ID = 'nimi.realm-world-studio';
export const WORLD_STUDIO_COAUTHOR_TYPE = 'nimi.realm-world-studio.coauthor-candidate.v1';

export type LabActivityCoauthorTask = 'develop' | 'cast' | 'review';

export type LabActivityBusinessDetail = Readonly<{
  kind: 'world-coauthor';
  worldName: string;
  task: LabActivityCoauthorTask;
  suggestions: number;
  notes: number;
  adopted: number | null;
}>;

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000 ? value : null;
}

/** Returns the recognized business projection, or null for the generic card. */
export function labActivityBusinessDetail(record: NimiAppActivityRecord): LabActivityBusinessDetail | null {
  if (record.type !== WORLD_STUDIO_COAUTHOR_TYPE || record.source.kind !== 'app'
    || record.source.appId !== WORLD_STUDIO_APP_ID || !record.data) return null;
  const { worldName, task, suggestions, notes, adopted } = record.data as Record<string, unknown>;
  if (typeof worldName !== 'string' || !worldName.trim() || worldName.length > 200) return null;
  if (task !== 'develop' && task !== 'cast' && task !== 'review') return null;
  const suggestionCount = count(suggestions);
  const noteCount = count(notes);
  const adoptedCount = adopted === undefined ? null : count(adopted);
  if (suggestionCount === null || noteCount === null || (adopted !== undefined && adoptedCount === null)) return null;
  return { kind: 'world-coauthor', worldName: worldName.trim(), task, suggestions: suggestionCount, notes: noteCount, adopted: adoptedCount };
}

export type LabActivityScope = 'open-todos' | 'all';

export function labActivityFilter(scope: LabActivityScope) {
  return scope === 'open-todos' ? { kind: 'todo' as const, todoStates: ['open' as const] } : {};
}
