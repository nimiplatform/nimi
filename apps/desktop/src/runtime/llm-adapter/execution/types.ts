export const TEXT_GENERATE_TIMEOUT_MS = 120_000;

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ProviderHealth = {
  provider: string;
  endpoint: string | null;
  model: string;
  status: 'healthy' | 'degraded' | 'unsupported' | 'unreachable';
  detail: string;
  checkedAt: string;
};

export type CheckLlmHealthInput = {
  provider: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  localModelId?: string;
  goRuntimeLocalModelId?: string;
  goRuntimeStatus?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
  listRuntimeLocalModelsSnapshot?: () => Promise<Array<Record<string, unknown>>>;
};

export type ExecuteLocalKernelTurnInput = {
  requestId: string;
  sessionId: string;
  turnIndex: number;
  mode: 'STORY' | 'SCENE_TURN' | string;
  userInputText: string;
  provider: string;
  worldId?: string;
  agentId?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type ExecuteLocalKernelAssistantMessage = {
  text: string;
  style: 'narration' | 'mixed';
};

export type ExecuteLocalKernelSceneCard = {
  type: 'text';
  content: string;
};

export type ExecuteLocalKernelStateDelta = {
  narrativeDelta: string[];
  storyDelta?: {
    lastInput: string;
    lastAssistant: string;
    turnIndex: number;
  };
  sceneDelta?: {
    lastInput: string;
    lastAssistant: string;
    turnIndex: number;
  };
  memoryWrites: string[];
};

export type ExecuteLocalKernelRuleDecision = {
  ruleId: string;
  decision: 'ALLOW' | 'DENY' | 'ALLOW_WITH_WARNING';
  reason: string;
};

export type ExecuteLocalKernelNextAction = {
  id: string;
  label: '继续';
  kind: 'free_input';
};

export type ExecuteLocalKernelPromptTrace = {
  id: string;
  sourceSegments: string[];
  tokenRequested: number;
  tokenActual: number;
  droppedSegments: string[];
  conflictResolutions: string[];
  decision: 'ALLOW' | 'DENY' | 'ALLOW_WITH_WARNING';
  decisionReason: string;
};

export type ExecuteLocalKernelAuditEvent = {
  id: string;
  turnIndex: number;
  eventType: 'LOCAL_PROVIDER_EXECUTED';
  reasonCode: string;
  detail: {
    provider: string;
    model: string;
  };
};

export type ExecuteLocalKernelTurnResult = {
  requestId: string;
  sessionId: string;
  turnIndex: number;
  assistantMessage: ExecuteLocalKernelAssistantMessage;
  sceneCards?: ExecuteLocalKernelSceneCard[];
  stateDelta: ExecuteLocalKernelStateDelta;
  ruleDecisions: ExecuteLocalKernelRuleDecision[];
  promptTraceId: string;
  auditEventIds: string[];
  nextActions: ExecuteLocalKernelNextAction[];
  localOnly: true;
  localPromptTrace: ExecuteLocalKernelPromptTrace;
  localAuditEvents: ExecuteLocalKernelAuditEvent[];
};

export type InvokeModLlmInput = {
  modId: string;
  provider: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  mode?: 'STORY' | 'SCENE_TURN';
  worldId?: string;
  agentId?: string;
  abortSignal?: AbortSignal;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  fetchImpl?: FetchImpl;
};

export type InvokeModLlmOutput = {
  text: string;
  promptTraceId: string;
  traceId: string;
};
