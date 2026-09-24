import { dropItem } from './items.js';
import type { DayState, LifeItem, SkillRun } from './types.js';

/** The user has changed or handled the item since the agent last touched it. */
function userActedSince(item: LifeItem): boolean {
  const last = [...item.history].reverse().find((event) => event.by !== 'system');
  return last !== undefined && last.by !== 'agent';
}

/**
 * Revert what an agent changed during one run, newest change first. An item
 * the user changed or handled afterwards is theirs now and is left alone,
 * whether the agent created it or edited it; everything else is dropped or
 * restored to the agent's "before" snapshot.
 */
export function undoRunChanges(state: DayState, run: SkillRun, now: Date): { state: DayState; reverted: number; kept: number; skipped: number } {
  let items = state.items.slice();
  let notes = state.notes.slice();
  let reverted = 0;
  let skipped = 0;
  // Changes the user has since made their own; the run keeps saying so after the undo.
  const kept = new Set<number>();
  for (let position = run.changes.length - 1; position >= 0; position -= 1) {
    const change = run.changes[position]!;
    switch (change.kind) {
      case 'item-created':
      case 'decision-asked': {
        const index = items.findIndex((item) => item.id === change.itemId);
        if (index < 0) { skipped += 1; break; }
        const item = items[index]!;
        if (item.state === 'dropped') { skipped += 1; break; }
        if (userActedSince(item)) { skipped += 1; kept.add(position); break; }
        items[index] = dropItem(item, 'user', now);
        reverted += 1;
        break;
      }
      case 'item-updated':
      case 'item-completed': {
        const index = items.findIndex((item) => item.id === change.itemId);
        if (index < 0) { skipped += 1; break; }
        const current = items[index]!;
        if (userActedSince(current)) { skipped += 1; kept.add(position); break; }
        items[index] = { ...change.before, updatedAt: now.toISOString() };
        reverted += 1;
        break;
      }
      case 'note-saved': {
        const current = notes.find((note) => note.id === change.noteId);
        if (current && run.finishedAt && current.updatedAt > run.finishedAt) { skipped += 1; kept.add(position); break; }
        if (change.before) {
          notes = notes.map((note) => (note.id === change.noteId ? change.before! : note));
        } else {
          notes = notes.filter((note) => note.id !== change.noteId);
        }
        reverted += 1;
        break;
      }
    }
  }
  const changes = run.changes.map((change, position) => (kept.has(position) ? { ...change, keptOnUndo: true as const } : change));
  return {
    state: {
      ...state,
      items,
      notes,
      runs: state.runs.map((candidate) => (candidate.id === run.id ? { ...candidate, changes, undone: true } : candidate)),
    },
    reverted,
    kept: kept.size,
    skipped,
  };
}

/**
 * Which changes of an undone run are still in place because the user had
 * changed them. A run undone before this was marked on its changes is read
 * from the items as they are now: an item the assistant added that is still
 * on the list, and has not been dropped since the run, was never taken back.
 */
export function keptChanges(run: SkillRun, items: readonly LifeItem[]): ReadonlySet<number> {
  const kept = new Set<number>();
  if (!run.undone) return kept;
  const finishedAt = run.finishedAt;
  run.changes.forEach((change, position) => {
    if (change.keptOnUndo) {
      kept.add(position);
      return;
    }
    if (change.kind !== 'item-created' && change.kind !== 'decision-asked') return;
    const item = items.find((entry) => entry.id === change.itemId);
    if (!item || item.state === 'dropped') return;
    const droppedSince = finishedAt !== null && item.history.some((event) => event.kind === 'dropped' && event.at > finishedAt);
    if (!droppedSince) kept.add(position);
  });
  return kept;
}
