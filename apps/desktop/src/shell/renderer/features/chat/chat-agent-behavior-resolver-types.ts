import type {
    AgentResolvedMessageActionEnvelope,
} from './chat-agent-behavior';

export const AGENT_MODEL_OUTPUT_CLASSIFICATIONS = [
    'strict-json',
    'json-fenced',
    'json-wrapper',
    'plain-text',
    'partial-json',
    'invalid-json',
] as const;
export const AGENT_MODEL_OUTPUT_RECOVERY_PATHS = [
    'none',
    'strip-fence',
    'extract-json-object',
    'plain-text-envelope',
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
    image?: AgentImageExecutionDiagnostics | null;
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
