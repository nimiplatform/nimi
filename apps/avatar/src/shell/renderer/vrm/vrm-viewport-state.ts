// Authority: docs/authority/avatar-embodiment-rationale.md.
//
// Pure types + immutable state-mapping helpers for the VRM viewport. The
// surface layer reads from this state to drive camera framing
// + posture body lean; emote writes are owned by the emote state machine
// (this slot only tracks the intended emote name).
//
// All setters preserve referential identity when the value is unchanged
// — important for the React surface to skip useFrame side effects when
// the state is logically the same. Typed shape kept transport-friendly:
// no functions, no class instances, no non-serializable data.

export type VrmPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

export type VrmPosture = 'neutral' | 'lean-forward' | 'lean-back';

export type VrmViewportState = {
  phase: VrmPhase;
  posture: VrmPosture;
  /** Intended emote slot. Actual VRM expression writes are owned by the
   *  emote state machine; this state stores only the intended value. */
  emote: string | null;
};

export const initialVrmViewportState: VrmViewportState = Object.freeze({
  phase: 'idle',
  posture: 'neutral',
  emote: null,
}) as VrmViewportState;

export function setPhase(state: VrmViewportState, phase: VrmPhase): VrmViewportState {
  if (state.phase === phase) return state;
  return { ...state, phase };
}

export function setPosture(state: VrmViewportState, posture: VrmPosture): VrmViewportState {
  if (state.posture === posture) return state;
  return { ...state, posture };
}

export function setEmote(state: VrmViewportState, emote: string | null): VrmViewportState {
  if (state.emote === emote) return state;
  return { ...state, emote };
}
