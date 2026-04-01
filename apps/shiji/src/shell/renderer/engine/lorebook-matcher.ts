/**
 * lorebook-matcher.ts — SJ-DIAL-017
 * Exact keyword match against last 10 dialogue turns.
 * Max 5 entries; prioritize entries in most recent user input.
 */
import type { LoreEntry, DialogueTurn } from './types.js';

const MAX_CONTEXT_TURNS = 10; // SJ-DIAL-017:2
const MAX_ENTRIES = 5;        // SJ-DIAL-017:3

/**
 * matchLorebook — returns up to 5 lorebook entries whose key appears in the
 * last 10 dialogue turns. Entries whose key appears in the latest user input
 * are ranked first (SJ-DIAL-017:3).
 * Returns empty array if no entries match (prompt block omitted per SJ-DIAL-017:5).
 */
export function matchLorebook(
  recentTurns: DialogueTurn[],
  lorebooks: LoreEntry[],
  lastUserInput: string,
): LoreEntry[] {
  if (lorebooks.length === 0) return [];

  // Build context text from last 10 turns
  const contextTurns = recentTurns.slice(-MAX_CONTEXT_TURNS);
  const contextText = contextTurns.map((t) => t.content).join(' ').toLowerCase();

  const matched = lorebooks.filter((entry) =>
    contextText.includes(entry.key.toLowerCase()),
  );

  if (matched.length === 0) return [];
  if (matched.length <= MAX_ENTRIES) return matched;

  // Prioritize entries in the latest user input
  const userInputLower = lastUserInput.toLowerCase();
  const inUserInput = matched.filter((e) => userInputLower.includes(e.key.toLowerCase()));
  const notInUserInput = matched.filter((e) => !userInputLower.includes(e.key.toLowerCase()));

  return [...inUserInput, ...notInUserInput].slice(0, MAX_ENTRIES);
}
