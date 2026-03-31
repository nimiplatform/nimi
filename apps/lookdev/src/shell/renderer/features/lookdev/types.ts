import type { LookdevRuntimeTargetOption } from './lookdev-route.js';

export type LookdevSelectionSource = 'by_world' | 'explicit_selection';
export type LookdevBatchStatus = 'running' | 'paused' | 'processing_complete' | 'commit_complete';
export type LookdevLanguage = 'zh' | 'en';
export type LookdevWorldStylePackStatus = 'draft' | 'confirmed';
export type LookdevWorldStylePackSeedSource = 'style_session' | 'stored_pack';
export type LookdevWorldStyleSessionStatus = 'collecting' | 'ready_to_synthesize' | 'synthesized';
export type LookdevWorldStyleSessionRole = 'assistant' | 'operator';
export type LookdevWorldStyleFocusKey = 'tone' | 'differentiation' | 'palette' | 'forbidden';
export type LookdevItemStatus =
  | 'pending'
  | 'generating'
  | 'auto_passed'
  | 'auto_failed_retryable'
  | 'auto_failed_exhausted'
  | 'committed'
  | 'commit_failed';

export type LookdevCaptureMode = 'capture' | 'batch_only';
export type LookdevCaptureSynthesisMode = 'silent' | 'interactive';
export type LookdevAgentImportance = 'PRIMARY' | 'SECONDARY' | 'BACKGROUND' | 'UNKNOWN';
export type LookdevAuditEventScope = 'batch' | 'item';
export type LookdevAuditEventSeverity = 'info' | 'success' | 'warning' | 'error';
export type LookdevAuditEventKind =
  | 'batch_created'
  | 'batch_paused'
  | 'batch_resumed'
  | 'processing_complete'
  | 'item_auto_passed'
  | 'item_gated_retryable'
  | 'item_gated_exhausted'
  | 'item_processing_failed'
  | 'rerun_queued'
  | 'item_committed'
  | 'item_commit_failed'
  | 'commit_complete';

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

export type LookdevCaptureFeelingAnchor = {
  coreVibe: string;
  tonePhrases: string[];
  avoidVibe: string[];
};

export type LookdevCaptureWorkingMemory = {
  effectiveIntentSummary: string;
  preserveFocus: string[];
  adjustFocus: string[];
  negativeConstraints: string[];
};

export type LookdevCaptureVisualIntent = {
  visualRole: string;
  silhouette: string;
  outfit: string;
  hairstyle: string;
  palettePrimary: string;
  artStyle: string;
  mustKeepTraits: string[];
  forbiddenTraits: string[];
  detailBudget: 'lean' | 'standard' | 'hero';
  backgroundWeight: 'minimal' | 'supporting' | 'requested';
};

export type LookdevCaptureStateMessage = {
  messageId: string;
  role: 'assistant' | 'operator';
  text: string;
  createdAt: string;
};

export type LookdevCaptureState = {
  agentId: string;
  worldId: string | null;
  displayName: string;
  sourceConfidence: 'derived_from_agent_truth' | 'world_style_fallback';
  captureMode: LookdevCaptureMode;
  synthesisMode: LookdevCaptureSynthesisMode;
  seedSignature: string;
  currentBrief: string;
  feelingAnchor: LookdevCaptureFeelingAnchor;
  workingMemory: LookdevCaptureWorkingMemory;
  visualIntent: LookdevCaptureVisualIntent;
  messages: LookdevCaptureStateMessage[];
  sourceSummary: string;
  lastTextTraceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LookdevWorldStyleSessionMessage = {
  messageId: string;
  role: LookdevWorldStyleSessionRole;
  text: string;
  createdAt: string;
};

export type LookdevWorldStyleUnderstanding = Record<LookdevWorldStyleFocusKey, string>;

export type LookdevWorldStyleSession = {
  sessionId: string;
  worldId: string;
  worldName: string;
  language: LookdevLanguage;
  status: LookdevWorldStyleSessionStatus;
  messages: LookdevWorldStyleSessionMessage[];
  understanding: LookdevWorldStyleUnderstanding;
  openQuestions: string[];
  readinessReason: string | null;
  summary: string | null;
  operatorTurnCount: number;
  lastTextTraceId: string | null;
  createdAt: string;
  updatedAt: string;
  synthesizedAt: string | null;
};

export type LookdevWorldStylePack = {
  worldId: string;
  name: string;
  language: LookdevLanguage;
  status: LookdevWorldStylePackStatus;
  seedSource: LookdevWorldStylePackSeedSource;
  sourceSessionId: string | null;
  summary: string;
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
  confirmedAt: string | null;
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

export type LookdevExecutionTarget = Omit<LookdevRuntimeTargetOption, 'key'>;

export type LookdevPolicySnapshot = {
  generationPolicy: LookdevGenerationPolicy;
  autoEvalPolicy: LookdevAutoEvalPolicy;
  retryPolicy: LookdevRetryPolicy;
  writebackPolicy: LookdevWritebackPolicy;
  generationTarget: LookdevExecutionTarget;
  evaluationTarget: LookdevExecutionTarget;
  maxConcurrency: number;
};

export type LookdevSelectionSnapshot = {
  selectionSource: LookdevSelectionSource;
  agentIds: string[];
  captureSelectionAgentIds: string[];
  worldId?: string;
};

export type LookdevAuditEvent = {
  eventId: string;
  batchId: string;
  occurredAt: string;
  kind: LookdevAuditEventKind;
  scope: LookdevAuditEventScope;
  severity: LookdevAuditEventSeverity;
  itemId?: string;
  agentId?: string;
  agentDisplayName?: string;
  count?: number;
  detail?: string;
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
  captureStateSnapshot: LookdevCaptureState;
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
  auditTrail: LookdevAuditEvent[];
};

export function normalizeLookdevLanguage(locale: string | null | undefined): LookdevLanguage {
  return String(locale || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function createDefaultPolicySnapshot(input?: {
  generationTarget?: Partial<LookdevExecutionTarget>;
  evaluationTarget?: Partial<LookdevExecutionTarget>;
}): LookdevPolicySnapshot {
  return {
    generationPolicy: {
      aspectRatio: '3:4',
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
    generationTarget: {
      source: input?.generationTarget?.source === 'local' ? 'local' : 'cloud',
      route: input?.generationTarget?.route === 'local' ? 'local' : 'cloud',
      connectorId: String(input?.generationTarget?.connectorId || '').trim(),
      connectorLabel: String(input?.generationTarget?.connectorLabel || '').trim(),
      endpoint: String(input?.generationTarget?.endpoint || '').trim(),
      provider: String(input?.generationTarget?.provider || '').trim(),
      modelId: String(input?.generationTarget?.modelId || '').trim(),
      modelLabel: String(input?.generationTarget?.modelLabel || '').trim(),
      localModelId: String(input?.generationTarget?.localModelId || '').trim() || undefined,
      capability: 'image.generate',
    },
    evaluationTarget: {
      source: input?.evaluationTarget?.source === 'local' ? 'local' : 'cloud',
      route: input?.evaluationTarget?.route === 'local' ? 'local' : 'cloud',
      connectorId: String(input?.evaluationTarget?.connectorId || '').trim(),
      connectorLabel: String(input?.evaluationTarget?.connectorLabel || '').trim(),
      endpoint: String(input?.evaluationTarget?.endpoint || '').trim(),
      provider: String(input?.evaluationTarget?.provider || '').trim(),
      modelId: String(input?.evaluationTarget?.modelId || '').trim(),
      modelLabel: String(input?.evaluationTarget?.modelLabel || '').trim(),
      localModelId: String(input?.evaluationTarget?.localModelId || '').trim() || undefined,
      capability: 'text.generate.vision',
    },
    maxConcurrency: 1,
  };
}

export function confirmWorldStylePack(pack: LookdevWorldStylePack): LookdevWorldStylePack {
  const now = new Date().toISOString();
  return {
    ...pack,
    status: 'confirmed',
    updatedAt: now,
    confirmedAt: now,
  };
}

export function createConfirmedWorldStylePack(
  worldId: string,
  worldName: string,
  language: LookdevLanguage,
): LookdevWorldStylePack {
  const now = new Date().toISOString();
  const seedSummary = language === 'zh'
    ? `${worldName} 的世界风格已经确认，可直接驱动角色锚点肖像生产。`
    : `${worldName} style has already been confirmed for anchor portrait production.`;
  return confirmWorldStylePack({
    worldId,
    name: language === 'zh' ? `${worldName} 肖像风格包` : `${worldName} portrait style pack`,
    language,
    status: 'draft',
    seedSource: 'stored_pack',
    sourceSessionId: null,
    summary: seedSummary,
    visualEra: language === 'zh' ? `${worldName} 的人物时代感与身份气质` : `${worldName} character era and identity tone`,
    artStyle: language === 'zh' ? '克制、可复用的角色锚点肖像风格' : 'restrained, reusable anchor portrait illustration',
    paletteDirection: language === 'zh' ? '与世界观一致、便于角色识别的主配色方向' : 'world-consistent palette direction with one readable dominant color',
    materialDirection: language === 'zh' ? '服务角色识别的稳定材质表达' : 'stable material language that serves character readability',
    silhouetteDirection: language === 'zh' ? '清晰的全身轮廓与服装识别' : 'clean full-body silhouette with readable costume structure',
    costumeDensity: language === 'zh' ? '中等复杂度，优先服务角色身份' : 'moderate complexity, role-first and not over-accessorized',
    backgroundDirection: language === 'zh' ? '背景服从角色识别，不过度抢戏' : 'background stays subordinate to character read',
    promptFrame: language === 'zh'
      ? '全身角色锚点肖像，固定焦距，稳定视角，背景服从角色识别'
      : 'full-body character anchor portrait, fixed focal length, stable eye-level camera, subdued background',
    forbiddenElements: language === 'zh'
      ? ['极端近景', '剧烈动作姿态', '喧宾夺主的背景', '鱼眼畸变']
      : ['extreme close-up', 'dramatic action pose', 'busy cinematic background', 'fisheye distortion'],
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
  });
}
