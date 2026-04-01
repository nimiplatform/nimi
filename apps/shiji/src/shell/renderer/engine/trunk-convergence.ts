/**
 * trunk-convergence.ts — SJ-DIAL-007
 * Detects trunk event arrival in AI output, and determines convergence mode.
 * "Locked trunk + free branches" — convergence guides, never forces.
 */
import type { SessionSnapshot, TrunkEvent } from './types.js';

export type TrunkConvergenceResult = {
  /** Updated trunk event index (incremented if event arrived) */
  nextTrunkIndex: number;
  /** Whether narrative is approaching next trunk event */
  isApproachingTrunk: boolean;
  /** Whether the next trunk event was detected in this turn's output */
  trunkEventReached: boolean;
  /** The reached event, if any */
  reachedEvent: TrunkEvent | null;
  /** Prompt directive: free | approach | arrived */
  convergenceDirective: 'free' | 'approach' | 'arrived';
};

// How many turns before expected trunk event we start "approaching" mode
const PROXIMITY_TURN_THRESHOLD = 5;

/**
 * checkTrunkConvergence — evaluates whether the AI output references the next
 * trunk event, and whether we should be in "approach" or "free" mode.
 *
 * @param snapshot - current session state
 * @param trunkEvents - full ordered trunk event list
 * @param assistantText - this turn's AI output (for arrival detection)
 * @param turnsSinceLastTrunk - turns elapsed since last trunk event arrived
 */
export function checkTrunkConvergence(
  snapshot: SessionSnapshot,
  trunkEvents: TrunkEvent[],
  assistantText: string,
  turnsSinceLastTrunk: number,
): TrunkConvergenceResult {
  const { trunkEventIndex } = snapshot;
  const nextEvent = trunkEvents[trunkEventIndex];

  if (!nextEvent) {
    return {
      nextTrunkIndex: trunkEventIndex,
      isApproachingTrunk: false,
      trunkEventReached: false,
      reachedEvent: null,
      convergenceDirective: 'free',
    };
  }

  // Arrival detection: check if key words from the trunk event title appear in output
  const textLower = assistantText.toLowerCase();
  const titleWords = nextEvent.title
    .toLowerCase()
    .split(/[\s，。！？、]+/)
    .filter((w) => w.length >= 2);
  const contentWords = nextEvent.content
    .toLowerCase()
    .split(/[\s，。！？、]+/)
    .filter((w) => w.length >= 3)
    .slice(0, 5);

  const titleHits = titleWords.filter((w) => textLower.includes(w)).length;
  const contentHits = contentWords.filter((w) => textLower.includes(w)).length;

  // Require at least 2 title word matches AND 1 content match to detect arrival
  const hasArrived = titleHits >= 2 && contentHits >= 1;

  if (hasArrived) {
    return {
      nextTrunkIndex: trunkEventIndex + 1,
      isApproachingTrunk: false,
      trunkEventReached: true,
      reachedEvent: nextEvent,
      convergenceDirective: 'arrived',
    };
  }

  // Proximity: approaching if we've been in free mode for PROXIMITY_TURN_THRESHOLD turns
  const isApproaching = turnsSinceLastTrunk >= PROXIMITY_TURN_THRESHOLD;

  return {
    nextTrunkIndex: trunkEventIndex,
    isApproachingTrunk: isApproaching,
    trunkEventReached: false,
    reachedEvent: null,
    convergenceDirective: isApproaching ? 'approach' : 'free',
  };
}
