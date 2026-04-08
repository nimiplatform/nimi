export type WorldEvolutionEffectClass =
  | 'NONE'
  | 'MEMORY_ONLY'
  | 'STATE_ONLY'
  | 'STATE_AND_HISTORY';

export type WorldEvolutionExecutionStage =
  | 'INGRESS'
  | 'NORMALIZE'
  | 'SCHEDULE'
  | 'DISPATCH'
  | 'TRANSITION'
  | 'EFFECT'
  | 'COMMIT_REQUEST'
  | 'CHECKPOINT'
  | 'TERMINAL';

export type WorldEvolutionSupervisionOutcome =
  | 'CONTINUE'
  | 'DEFER'
  | 'ABORT'
  | 'QUARANTINE';

export type WorldEvolutionMatchMode = 'exact' | 'filter';

export type WorldEvolutionSelectorReadRejectionCategory =
  | 'INVALID_SELECTOR'
  | 'INCOMPLETE_SELECTOR'
  | 'MISSING_REQUIRED_EVIDENCE'
  | 'UNSUPPORTED_PROJECTION_SHAPE'
  | 'BOUNDARY_DENIED';

export type WorldEvolutionSelectorReadMethodId =
  | 'worldEvolution.executionEvents.read'
  | 'worldEvolution.replays.read'
  | 'worldEvolution.checkpoints.read'
  | 'worldEvolution.supervision.read'
  | 'worldEvolution.commitRequests.read';

export type WorldEvolutionActorRef = {
  actorId: string;
  actorType: string;
  role?: string;
};

export type WorldEvolutionEvidenceRef = {
  kind: string;
  refId: string;
  uri?: string;
};

export type WorldEvolutionExecutionEventSelector = {
  eventId?: string;
  worldId?: string;
  appId?: string;
  sessionId?: string;
  traceId?: string;
  tick?: number;
  eventKind?: string;
  stage?: WorldEvolutionExecutionStage;
  actorRefs?: WorldEvolutionActorRef[];
  causation?: string;
  correlation?: string;
  effectClass?: WorldEvolutionEffectClass;
  reason?: string;
  evidenceRefs?: WorldEvolutionEvidenceRef[];
};

export type WorldEvolutionReplaySelector = {
  replayRef?: WorldEvolutionEvidenceRef;
  replayMode?: string;
  worldId?: string;
  sessionId?: string;
  traceId?: string;
  eventId?: string;
  tick?: number;
};

export type WorldEvolutionCheckpointSelector = {
  checkpointId?: string;
  checkpointRef?: string;
  restoreStatus?: string;
  worldId?: string;
  sessionId?: string;
  traceId?: string;
  eventId?: string;
  tick?: number;
};

export type WorldEvolutionSupervisionSelector = {
  worldId?: string;
  sessionId?: string;
  traceId?: string;
  eventId?: string;
  tick?: number;
  supervisionOutcome?: WorldEvolutionSupervisionOutcome;
};

export type WorldEvolutionCommitRequestSelector = {
  worldId?: string;
  appId?: string;
  sessionId?: string;
  effectClass?: WorldEvolutionEffectClass;
  scope?: string;
  schemaId?: string;
  schemaVersion?: string;
  actorRefs?: WorldEvolutionActorRef[];
  reason?: string;
  evidenceRefs?: WorldEvolutionEvidenceRef[];
  sourceEventIds?: string[];
  traceId?: string;
  tick?: number;
  causation?: string;
  correlation?: string;
  checkpointRefs?: string[];
  supervisionRefs?: string[];
};

export type WorldEvolutionExecutionEventView = {
  eventId: string;
  worldId: string;
  appId: string;
  sessionId: string;
  traceId: string;
  tick: number;
  timestamp: string;
  eventKind: string;
  stage: WorldEvolutionExecutionStage;
  actorRefs: WorldEvolutionActorRef[];
  causation: string | null;
  correlation: string | null;
  effectClass: WorldEvolutionEffectClass;
  reason: string;
  evidenceRefs: WorldEvolutionEvidenceRef[];
  detail?: {
    kind: string;
    [key: string]: unknown;
  };
};

export type WorldEvolutionReplayView = {
  replayRef: WorldEvolutionEvidenceRef;
  replayMode: string;
  replayResult?: string;
  worldId?: string;
  sessionId?: string;
  traceId?: string;
  eventId?: string;
  tick?: number;
};

export type WorldEvolutionCheckpointView = {
  checkpointId: string;
  checkpointRef?: string;
  restoreStatus?: string;
  worldId?: string;
  sessionId?: string;
  traceId?: string;
  eventId?: string;
  tick?: number;
};

export type WorldEvolutionSupervisionView = {
  supervisionOutcome: WorldEvolutionSupervisionOutcome;
  worldId?: string;
  sessionId?: string;
  traceId?: string;
  eventId?: string;
  tick?: number;
  evidenceRefs?: WorldEvolutionEvidenceRef[];
  checkpointRefs?: string[];
};

export type WorldEvolutionCommitRequestView = {
  worldId: string;
  appId: string;
  sessionId: string;
  effectClass: WorldEvolutionEffectClass;
  scope: string;
  schemaId: string;
  schemaVersion: string;
  actorRefs: WorldEvolutionActorRef[];
  reason: string;
  evidenceRefs: WorldEvolutionEvidenceRef[];
  sourceEventIds?: string[];
  traceId?: string;
  tick?: number;
  causation?: string;
  correlation?: string;
  checkpointRefs?: string[];
  supervisionRefs?: string[];
};

export type WorldEvolutionExecutionEventReadResult = {
  selector: WorldEvolutionExecutionEventSelector;
  matchMode: WorldEvolutionMatchMode;
  matches: WorldEvolutionExecutionEventView[];
};

export type WorldEvolutionReplayReadResult = {
  selector: WorldEvolutionReplaySelector;
  matchMode: WorldEvolutionMatchMode;
  matches: WorldEvolutionReplayView[];
};

export type WorldEvolutionCheckpointReadResult = {
  selector: WorldEvolutionCheckpointSelector;
  matchMode: WorldEvolutionMatchMode;
  matches: WorldEvolutionCheckpointView[];
};

export type WorldEvolutionSupervisionReadResult = {
  selector: WorldEvolutionSupervisionSelector;
  matchMode: WorldEvolutionMatchMode;
  matches: WorldEvolutionSupervisionView[];
};

export type WorldEvolutionCommitRequestReadResult = {
  selector: WorldEvolutionCommitRequestSelector;
  matchMode: WorldEvolutionMatchMode;
  matches: WorldEvolutionCommitRequestView[];
};

export type WorldEvolutionSelectorReadErrorDetails = {
  rejectionCategory: WorldEvolutionSelectorReadRejectionCategory;
  methodId: WorldEvolutionSelectorReadMethodId;
};
