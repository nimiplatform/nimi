import {
    AGENT_MODEL_OUTPUT_CLASSIFICATIONS,
    AGENT_MODEL_OUTPUT_RECOVERY_PATHS,
    type AgentImageExecutionDiagnostics,
    type AgentModelOutputClassification,
    type AgentModelOutputDiagnostics,
    type AgentModelOutputRecoveryPath,
    type AgentPreflightExecutionDiagnostics,
    type AgentModelOutputUsage,
    type AgentPromptContextWindowSource,
    type AgentResolvedStatusCueDiagnostic,
} from './chat-agent-runtime-output-types';

function normalizeOptionalPositiveInteger(value: unknown): number | null {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized <= 0) {
        return null;
    }
    return normalized;
}

function normalizeNullableText(value: unknown): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizeUsage(value: AgentModelOutputUsage | undefined): AgentModelOutputUsage | null {
    if (!value) {
        return null;
    }
    const inputTokens = Number(value.inputTokens);
    const outputTokens = Number(value.outputTokens);
    const totalTokens = Number(value.totalTokens);
    const normalized: AgentModelOutputUsage = {};
    if (Number.isFinite(inputTokens) && inputTokens >= 0) normalized.inputTokens = inputTokens;
    if (Number.isFinite(outputTokens) && outputTokens >= 0) normalized.outputTokens = outputTokens;
    if (Number.isFinite(totalTokens) && totalTokens >= 0) normalized.totalTokens = totalTokens;
    return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeOptionalNonNegativeNumber(value: unknown): number | null {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function parseAgentImageExecutionDiagnostics(value: unknown): AgentImageExecutionDiagnostics | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const diagnostics: AgentImageExecutionDiagnostics = {
        textPlanningMs: normalizeOptionalNonNegativeNumber(record.textPlanningMs),
        imageJobSubmitMs: normalizeOptionalNonNegativeNumber(record.imageJobSubmitMs),
        imageLoadMs: normalizeOptionalNonNegativeNumber(record.imageLoadMs),
        imageGenerateMs: normalizeOptionalNonNegativeNumber(record.imageGenerateMs),
        artifactHydrateMs: normalizeOptionalNonNegativeNumber(record.artifactHydrateMs),
        queueWaitMs: normalizeOptionalNonNegativeNumber(record.queueWaitMs),
        loadCacheHit: normalizeOptionalBoolean(record.loadCacheHit),
        residentReused: normalizeOptionalBoolean(record.residentReused),
        residentRestarted: normalizeOptionalBoolean(record.residentRestarted),
        queueSerialized: normalizeOptionalBoolean(record.queueSerialized),
        profileOverrideStep: normalizeOptionalNonNegativeNumber(record.profileOverrideStep),
        profileOverrideCfgScale: normalizeOptionalNonNegativeNumber(record.profileOverrideCfgScale),
        profileOverrideSampler: normalizeNullableText(record.profileOverrideSampler),
        profileOverrideScheduler: normalizeNullableText(record.profileOverrideScheduler),
    };
    return Object.values(diagnostics).some((entry) => entry !== null) ? diagnostics : null;
}

function parseAgentPreflightExecutionDiagnostics(value: unknown): AgentPreflightExecutionDiagnostics | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const diagnostics: AgentPreflightExecutionDiagnostics = {
        totalInputTokens: normalizeOptionalNonNegativeNumber(record.totalInputTokens),
        promptBudgetTokens: normalizeOptionalNonNegativeNumber(record.promptBudgetTokens),
        systemTokens: normalizeOptionalNonNegativeNumber(record.systemTokens),
        historyTokens: normalizeOptionalNonNegativeNumber(record.historyTokens),
        userTokens: normalizeOptionalNonNegativeNumber(record.userTokens),
    };
    return Object.values(diagnostics).some((entry) => entry !== null) ? diagnostics : null;
}

function parseAgentResolvedStatusCueDiagnostic(value: unknown): AgentResolvedStatusCueDiagnostic | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const rawFieldsPresent = Array.isArray(record.rawFieldsPresent)
        ? record.rawFieldsPresent
            .map((entry) => normalizeNullableText(entry))
            .filter(Boolean) as string[]
        : [];
    if (record.accepted !== true && record.accepted !== false) {
        return null;
    }
    return {
        accepted: record.accepted === true,
        reason: normalizeNullableText(record.reason),
        sourceMessageId: normalizeNullableText(record.sourceMessageId),
        rawFieldsPresent,
    };
}

export function parseAgentModelOutputDiagnostics(value: unknown): AgentModelOutputDiagnostics | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const classification = normalizeNullableText(record.classification) as AgentModelOutputClassification | null;
    const recoveryPath = normalizeNullableText(record.recoveryPath) as AgentModelOutputRecoveryPath | null;
    const contextWindowSource = normalizeNullableText(record.contextWindowSource) as AgentPromptContextWindowSource | null;
    if (
        !classification
        || !AGENT_MODEL_OUTPUT_CLASSIFICATIONS.includes(classification)
        || !recoveryPath
        || !AGENT_MODEL_OUTPUT_RECOVERY_PATHS.includes(recoveryPath)
        || !contextWindowSource
        || (contextWindowSource !== 'route-profile' && contextWindowSource !== 'default-estimate')
    ) {
        return null;
    }
    return {
        classification,
        recoveryPath,
        suspectedTruncation: record.suspectedTruncation === true,
        parseErrorDetail: normalizeNullableText(record.parseErrorDetail),
        rawOutputChars: Math.max(0, Number(record.rawOutputChars) || 0),
        normalizedOutputChars: Math.max(0, Number(record.normalizedOutputChars) || 0),
        finishReason: normalizeNullableText(record.finishReason),
        traceId: normalizeNullableText(record.traceId),
        promptTraceId: normalizeNullableText(record.promptTraceId),
        usage: normalizeUsage(record.usage as AgentModelOutputUsage | undefined),
        contextWindowSource,
        maxOutputTokensRequested: normalizeOptionalPositiveInteger(record.maxOutputTokensRequested),
        promptOverflow: record.promptOverflow === true,
        requestPrompt: normalizeNullableText(record.requestPrompt),
        requestSystemPrompt: normalizeNullableText(record.requestSystemPrompt),
        rawModelOutputText: normalizeNullableText(record.rawModelOutputText),
        normalizedModelOutputText: normalizeNullableText(record.normalizedModelOutputText),
        chainId: normalizeNullableText(record.chainId),
        followUpDepth: normalizeOptionalPositiveInteger(record.followUpDepth),
        maxFollowUpTurns: normalizeOptionalPositiveInteger(record.maxFollowUpTurns),
        followUpCanceledByUser: record.followUpCanceledByUser === true,
        followUpSourceActionId: normalizeNullableText(record.followUpSourceActionId),
        statusCue: parseAgentResolvedStatusCueDiagnostic(record.statusCue),
        image: parseAgentImageExecutionDiagnostics(record.image),
        preflight: parseAgentPreflightExecutionDiagnostics(record.preflight),
    };
}
