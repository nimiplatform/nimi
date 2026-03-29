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

export type LookdevCaptureMode = 'capture' | 'batch_only';
export type LookdevAgentImportance = 'PRIMARY' | 'SECONDARY' | 'BACKGROUND' | 'UNKNOWN';

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

export type LookdevWorldStylePack = {
  worldId: string;
  name: string;
  visualEra: string;
  artStyle: string;
  paletteDirection: string;
  materialDirection: string;
  silhouetteDirection: string;
  costumeDensity: string;
  backgroundDirection: string;
  promptFrame: string;
  forbiddenElements: string[];
  createdAt: string;
  updatedAt: string;
};

export type LookdevPortraitBrief = {
  agentId: string;
  worldId: string | null;
  displayName: string;
  visualRole: string;
  silhouette: string;
  outfit: string;
  hairstyle: string;
  palettePrimary: string;
  artStyle: string;
  mustKeepTraits: string[];
  forbiddenTraits: string[];
  sourceConfidence: 'derived_from_agent_truth' | 'world_style_fallback';
  updatedAt: string;
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
  captureSelectionAgentIds: string[];
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
  importance: LookdevAgentImportance;
  captureMode: LookdevCaptureMode;
  portraitBrief: LookdevPortraitBrief;
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
  worldStylePackSnapshot: LookdevWorldStylePack;
  policySnapshot: LookdevPolicySnapshot;
  totalItems: number;
  captureSelectedItems: number;
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

export function createDefaultWorldStylePack(worldId: string, worldName: string): LookdevWorldStylePack {
  const now = new Date().toISOString();
  return {
    worldId,
    name: `${worldName} portrait lane`,
    visualEra: 'world-authored contemporary character lane',
    artStyle: 'grounded anchor portrait illustration',
    paletteDirection: 'restrained, world-consistent palette with one readable dominant color',
    materialDirection: 'readable real-world materials, limited ornamental noise',
    silhouetteDirection: 'clean full-body silhouette with stable costume read',
    costumeDensity: 'moderate, role-first, not over-accessorized',
    backgroundDirection: 'subdued and subordinate to character read',
    promptFrame: 'full-body character anchor portrait, fixed focal length, stable eye-level camera, subdued background',
    forbiddenElements: ['extreme close-up', 'dramatic action pose', 'busy cinematic background', 'fisheye distortion'],
    createdAt: now,
    updatedAt: now,
  };
}
