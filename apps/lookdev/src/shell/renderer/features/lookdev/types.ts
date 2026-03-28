export type LookdevSelectionSource = 'by_world' | 'explicit_selection';
export type LookdevBatchStatus = 'running' | 'paused' | 'processing_complete' | 'commit_complete';
export type LookdevItemStatus =
  | 'pending'
  | 'generating'
  | 'auto_passed'
  | 'auto_failed_retryable'
  | 'auto_failed_exhausted'
  | 'committed'
  | 'commit_failed';

export type LookdevCheckKey =
  | 'fullBody'
  | 'fixedFocalLength'
  | 'subjectClarity'
  | 'stablePose'
  | 'backgroundSubordinate'
  | 'lowOcclusion';

export type LookdevEvaluationCheck = {
  key: LookdevCheckKey;
  passed: boolean;
  kind: 'hard_gate' | 'scored';
  note?: string;
};

export type LookdevEvaluationResult = {
  passed: boolean;
  score: number;
  checks: LookdevEvaluationCheck[];
  summary: string;
  failureReasons: string[];
};

export type LookdevImageArtifact = {
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  traceId?: string;
  artifactId?: string;
  promptSnapshot: string;
  createdAt: string;
};

export type LookdevGenerationPolicy = {
  aspectRatio: string;
  style: string;
  negativePrompt: string;
  promptFrame: string;
};

export type LookdevAutoEvalPolicy = {
  scoreThreshold: number;
  conservative: true;
};

export type LookdevRetryPolicy = {
  maxAttemptsPerPass: number;
  autoCorrectionHintsAllowed: boolean;
  userEditableCorrectionHints: false;
};

export type LookdevWritebackPolicy = {
  bindingPoint: 'AGENT_PORTRAIT';
  replaceExistingPortraitByDefault: true;
  writeAgentAvatarByDefault: false;
};

export type LookdevPolicySnapshot = {
  generationPolicy: LookdevGenerationPolicy;
  autoEvalPolicy: LookdevAutoEvalPolicy;
  retryPolicy: LookdevRetryPolicy;
  writebackPolicy: LookdevWritebackPolicy;
  maxConcurrency: number;
};

export type LookdevSelectionSnapshot = {
  selectionSource: LookdevSelectionSource;
  agentIds: string[];
  worldId?: string;
};

export type LookdevItem = {
  itemId: string;
  batchId: string;
  agentId: string;
  agentHandle: string;
  agentDisplayName: string;
  agentConcept: string;
  agentDescription: string | null;
  worldId: string | null;
  status: LookdevItemStatus;
  attemptCount: number;
  currentImage: LookdevImageArtifact | null;
  currentEvaluation: LookdevEvaluationResult | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  correctionHints: string[];
  existingPortraitUrl: string | null;
  referenceImageUrl: string | null;
  committedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LookdevBatch = {
  batchId: string;
  name: string;
  status: LookdevBatchStatus;
  selectionSnapshot: LookdevSelectionSnapshot;
  policySnapshot: LookdevPolicySnapshot;
  totalItems: number;
  passedItems: number;
  failedItems: number;
  committedItems: number;
  commitFailedItems: number;
  createdAt: string;
  updatedAt: string;
  processingCompletedAt: string | null;
  commitCompletedAt: string | null;
  items: LookdevItem[];
  selectedItemId: string | null;
  auditTrail: string[];
};

export function createDefaultPolicySnapshot(): LookdevPolicySnapshot {
  return {
    generationPolicy: {
      aspectRatio: '2:3',
      style: 'anchor-portrait',
      negativePrompt: 'cropped body, missing feet, fisheye distortion, busy background, heavy motion blur, extreme close-up, hidden silhouette, extra limbs',
      promptFrame: 'full-body character anchor portrait, fixed focal length, clean silhouette, subdued background, stable pose',
    },
    autoEvalPolicy: {
      scoreThreshold: 78,
      conservative: true,
    },
    retryPolicy: {
      maxAttemptsPerPass: 3,
      autoCorrectionHintsAllowed: true,
      userEditableCorrectionHints: false,
    },
    writebackPolicy: {
      bindingPoint: 'AGENT_PORTRAIT',
      replaceExistingPortraitByDefault: true,
      writeAgentAvatarByDefault: false,
    },
    maxConcurrency: 1,
  };
}
