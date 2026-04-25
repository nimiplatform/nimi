import type {
    AgentResolvedMessageActionEnvelope,
} from './chat-agent-behavior';

export type AgentResolvedStatusCueDiagnostic = {
    accepted: boolean;
    reason: string | null;
    sourceMessageId: string | null;
    rawFieldsPresent: readonly string[];
};

export const AGENT_MODEL_OUTPUT_CLASSIFICATIONS = [
    'strict-apml',
    'invalid-apml',
    'partial-apml',
    'preflight-rejected',
] as const;
export const AGENT_MODEL_OUTPUT_RECOVERY_PATHS = [
    'none',
] as const;

export type AgentModelOutputClassification = (typeof AGENT_MODEL_OUTPUT_CLASSIFICATIONS)[number];
export type AgentModelOutputRecoveryPath = (typeof AGENT_MODEL_OUTPUT_RECOVERY_PATHS)[number];
export type AgentPromptContextWindowSource = 'route-profile' | 'default-estimate';
export type AgentModelOutputUsage = {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
};
export type AgentImageExecutionDiagnostics = {
    textPlanningMs: number | null;
    imageJobSubmitMs: number | null;
    imageLoadMs: number | null;
    imageGenerateMs: number | null;
    artifactHydrateMs: number | null;
    queueWaitMs: number | null;
    loadCacheHit: boolean | null;
    residentReused: boolean | null;
    residentRestarted: boolean | null;
    queueSerialized: boolean | null;
    profileOverrideStep: number | null;
    profileOverrideCfgScale: number | null;
    profileOverrideSampler: string | null;
    profileOverrideScheduler: string | null;
};
export type AgentPreflightExecutionDiagnostics = {
    totalInputTokens: number | null;
    promptBudgetTokens: number | null;
    systemTokens: number | null;
    historyTokens: number | null;
    userTokens: number | null;
};
export type AgentModelOutputDiagnostics = {
    classification: AgentModelOutputClassification;
    recoveryPath: AgentModelOutputRecoveryPath;
    suspectedTruncation: boolean;
    parseErrorDetail: string | null;
    rawOutputChars: number;
    normalizedOutputChars: number;
    finishReason: string | null;
    traceId: string | null;
    promptTraceId: string | null;
    usage: AgentModelOutputUsage | null;
    contextWindowSource: AgentPromptContextWindowSource;
    maxOutputTokensRequested: number | null;
    promptOverflow: boolean;
    requestPrompt: string | null;
    requestSystemPrompt: string | null;
    rawModelOutputText: string | null;
    normalizedModelOutputText: string | null;
    chainId: string | null;
    followUpDepth: number | null;
    maxFollowUpTurns: number | null;
    followUpCanceledByUser: boolean;
    followUpSourceActionId: string | null;
    statusCue?: AgentResolvedStatusCueDiagnostic | null;
    image?: AgentImageExecutionDiagnostics | null;
    preflight?: AgentPreflightExecutionDiagnostics | null;
};
export type ResolveAgentModelOutputEnvelopeInput = {
    modelOutput: string;
    requestPrompt?: string | null;
    requestSystemPrompt?: string | null;
    finishReason?: string | null;
    trace?: {
        traceId?: string | null;
        promptTraceId?: string | null;
    } | null;
    usage?: AgentModelOutputUsage;
    contextWindowSource: AgentPromptContextWindowSource;
    maxOutputTokensRequested?: number | null;
    promptOverflow: boolean;
};
export type ResolveAgentModelOutputEnvelopeResult =
    | {
        ok: true;
        envelope: AgentResolvedMessageActionEnvelope;
        diagnostics: AgentModelOutputDiagnostics;
    }
    | {
        ok: false;
        diagnostics: AgentModelOutputDiagnostics;
    };
