import type { MomentRelationState } from './types.js';

export const MOMENT_RELATION_STATES = [
  'distant_witness',
  'near_witness',
  'noticed',
  'addressed',
  'involved',
] as const satisfies readonly MomentRelationState[];

export function isMomentRelationState(value: unknown): value is MomentRelationState {
  return MOMENT_RELATION_STATES.includes(value as MomentRelationState);
}

export function assertMomentRelationState(value: unknown): MomentRelationState {
  if (isMomentRelationState(value)) {
    return value;
  }
  throw new Error('MOMENT_RELATION_STATE_REQUIRED');
}
