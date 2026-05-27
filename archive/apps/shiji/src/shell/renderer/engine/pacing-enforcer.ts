/**
 * pacing-enforcer.ts — SJ-DIAL-006
 * Determines the scene type for the CURRENT turn based on previous session state.
 * Rhythm counter increments on crisis, resets on campfire (default threshold: 3).
 * Verification trigger: every 5 turns. Metacognition: when trunk event reached.
 */
import type { SessionSnapshot, PacingDecision, SceneType } from './types.js';

const CAMPFIRE_RHYTHM_THRESHOLD = 3; // SJ-DIAL-006:2
const VERIFICATION_TURN_INTERVAL = 5; // SJ-DIAL-006:5

/**
 * enforcePacing — given previous session state, returns the scene type and
 * updated rhythm counter for the CURRENT turn.
 *
 * @param snapshot - session state BEFORE this turn
 * @param turnCount - 1-indexed count of assistant turns completed so far (0 = no turns yet)
 * @param trunkEventReached - true if a trunk event was detected in previous turn output
 */
export function enforcePacing(
  snapshot: SessionSnapshot,
  turnCount: number,
  trunkEventReached: boolean,
): PacingDecision {
  let shouldTriggerMetacognition = false;
  let shouldTriggerVerification = false;

  // Metacognition takes highest priority (trunk event arrival)
  if (trunkEventReached) {
    shouldTriggerMetacognition = true;
    return {
      nextSceneType: 'metacognition',
      rhythmCounter: 0,
      shouldTriggerVerification: false,
      shouldTriggerMetacognition: true,
    };
  }

  // Verification override: every 5 turns (after at least one turn)
  const nextTurnNumber = turnCount + 1;
  if (nextTurnNumber > 1 && nextTurnNumber % VERIFICATION_TURN_INTERVAL === 0) {
    shouldTriggerVerification = true;
    return {
      nextSceneType: 'verification',
      rhythmCounter: snapshot.rhythmCounter,
      shouldTriggerVerification: true,
      shouldTriggerMetacognition: false,
    };
  }

  // Normal rhythm
  const { rhythmCounter } = snapshot;
  let nextSceneType: SceneType;
  let newRhythmCounter: number;

  if (rhythmCounter >= CAMPFIRE_RHYTHM_THRESHOLD) {
    // Campfire: reset rhythm counter
    nextSceneType = 'campfire';
    newRhythmCounter = 0;
  } else {
    // Crisis: increment rhythm counter
    nextSceneType = 'crisis';
    newRhythmCounter = rhythmCounter + 1;
  }

  void shouldTriggerMetacognition; // used in metacognition branch above

  return {
    nextSceneType,
    rhythmCounter: newRhythmCounter,
    shouldTriggerVerification,
    shouldTriggerMetacognition: false,
  };
}
