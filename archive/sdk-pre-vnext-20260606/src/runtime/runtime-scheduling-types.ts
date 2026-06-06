/** Runtime scheduling typed projection contracts (K-SCHED-001~003, K-SCHED-007). */

/** K-SCHED-001: Six-value scheduling judgement state. */
export type AISchedulingState =
  | 'runnable'
  | 'queue_required'
  | 'preemption_risk'
  | 'slowdown_risk'
  | 'denied'
  | 'unknown';

/** K-SCHED-003: Occupancy snapshot at peek time. */
export type AISchedulingOccupancy = {
  globalUsed: number;
  globalCap: number;
  appUsed: number;
  appCap: number;
};

/** K-SCHED-007: Target-scoped resource hint. */
export type AISchedulingResourceHint = {
  estimatedVramBytes?: number | null;
  estimatedRamBytes?: number | null;
  estimatedDiskBytes?: number | null;
  engine?: string | null;
};

/** K-SCHED-002: Atomic scheduling evaluation target. */
export type AISchedulingEvaluationTarget = {
  capability: string;
  targetId?: string | null;
  profileId?: string | null;
  resourceHint?: AISchedulingResourceHint | null;
};

/** K-SCHED-002: Scheduling preflight judgement result. */
export type AISchedulingJudgement = {
  state: AISchedulingState;
  detail: string | null;
  occupancy: AISchedulingOccupancy | null;
  resourceWarnings: string[];
};
