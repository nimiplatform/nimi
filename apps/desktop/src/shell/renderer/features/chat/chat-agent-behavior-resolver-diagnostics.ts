import type {
    AgentResolvedMessageActionEnvelope,
} from './chat-agent-behavior';
import {
    buildAgentResolvedOutputText,
    parseAgentResolvedMessageActionEnvelopeFromPayload,
    recoverPlainTextAsEnvelope,
} from './chat-agent-behavior-resolver-envelope';
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
    type ResolveAgentModelOutputEnvelopeInput,
    type ResolveAgentModelOutputEnvelopeResult,
} from './chat-agent-behavior-resolver-types';

function normalizeModelOutputText(value: unknown): string {
    return String(value || '')
        .replace(/^\uFEFF+/u, '')
        .replace(/\r\n?/gu, '\n')
        .trim();
}

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

function normalizeContextWindowSource(value: unknown): AgentPromptContextWindowSource | null {
    const normalized = normalizeNullableText(value);
    return normalized === 'route-profile' || normalized === 'default-estimate'
        ? normalized
        : null;
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

function buildAgentModelOutputDiagnostics(input: {
    classification: AgentModelOutputClassification;
    recoveryPath: AgentModelOutputRecoveryPath;
    suspectedTruncation: boolean;
    parseErrorDetail?: string | null;
    rawModelOutput: string;
    normalizedModelOutput: string;
    requestPrompt?: string | null;
    requestSystemPrompt?: string | null;
    chainId?: string | null;
    followUpDepth?: number | null;
    maxFollowUpTurns?: number | null;
    followUpCanceledByUser?: boolean;
    followUpSourceActionId?: string | null;
    finishReason?: string | null;
    trace?: {
        traceId?: string | null;
        promptTraceId?: string | null;
    } | null;
    usage?: AgentModelOutputUsage;
    contextWindowSource: AgentPromptContextWindowSource;
    maxOutputTokensRequested?: number | null;
    promptOverflow: boolean;
}): AgentModelOutputDiagnostics {
    return {
        classification: input.classification,
        recoveryPath: input.recoveryPath,
        suspectedTruncation: input.suspectedTruncation,
        parseErrorDetail: normalizeNullableText(input.parseErrorDetail),
        rawOutputChars: String(input.rawModelOutput || '').length,
        normalizedOutputChars: String(input.normalizedModelOutput || '').length,
        finishReason: normalizeNullableText(input.finishReason),
        traceId: normalizeNullableText(input.trace?.traceId),
        promptTraceId: normalizeNullableText(input.trace?.promptTraceId),
        usage: normalizeUsage(input.usage),
        contextWindowSource: input.contextWindowSource,
        maxOutputTokensRequested: normalizeOptionalPositiveInteger(input.maxOutputTokensRequested),
        promptOverflow: Boolean(input.promptOverflow),
        requestPrompt: normalizeNullableText(input.requestPrompt),
        requestSystemPrompt: normalizeNullableText(input.requestSystemPrompt),
        rawModelOutputText: typeof input.rawModelOutput === 'string' ? input.rawModelOutput : null,
        normalizedModelOutputText: typeof input.normalizedModelOutput === 'string' ? input.normalizedModelOutput : null,
        chainId: normalizeNullableText(input.chainId),
        followUpDepth: normalizeOptionalPositiveInteger(input.followUpDepth),
        maxFollowUpTurns: normalizeOptionalPositiveInteger(input.maxFollowUpTurns),
        followUpCanceledByUser: input.followUpCanceledByUser === true,
        followUpSourceActionId: normalizeNullableText(input.followUpSourceActionId),
        image: null,
        preflight: null,
    };
}

function stripFencedJsonBlock(rawModelOutput: string): string | null {
    const match = rawModelOutput.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
    if (!match) {
        return null;
    }
    return normalizeModelOutputText(match[1] || '');
}

function extractSingleWrappedJsonObject(rawModelOutput: string): string | null {
    let startIndex = -1;
    let curlyDepth = 0;
    let squareDepth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < rawModelOutput.length; index += 1) {
        const char = rawModelOutput[index];
        if (startIndex === -1) {
            if (char === '{') {
                startIndex = index;
                curlyDepth = 1;
            }
            continue;
        }
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{') {
            curlyDepth += 1;
            continue;
        }
        if (char === '}') {
            curlyDepth -= 1;
            if (curlyDepth === 0 && squareDepth === 0) {
                const before = rawModelOutput.slice(0, startIndex).trim();
                const after = rawModelOutput.slice(index + 1).trim();
                if (!before && !after) {
                    return null;
                }
                return normalizeModelOutputText(rawModelOutput.slice(startIndex, index + 1));
            }
            continue;
        }
        if (char === '[') {
            squareDepth += 1;
            continue;
        }
        if (char === ']') {
            squareDepth = Math.max(0, squareDepth - 1);
        }
    }
    return null;
}

function hasUnbalancedJsonDelimiters(rawModelOutput: string): boolean {
    let curlyDepth = 0;
    let squareDepth = 0;
    let inString = false;
    let escaped = false;
    for (const char of rawModelOutput) {
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{') {
            curlyDepth += 1;
            continue;
        }
        if (char === '}') {
            curlyDepth -= 1;
            continue;
        }
        if (char === '[') {
            squareDepth += 1;
            continue;
        }
        if (char === ']') {
            squareDepth -= 1;
        }
    }
    return curlyDepth !== 0 || squareDepth !== 0;
}

function looksLikeJsonAttempt(rawModelOutput: string): boolean {
    return rawModelOutput.startsWith('{')
        || rawModelOutput.startsWith('[')
        || rawModelOutput.startsWith('```')
        || rawModelOutput.includes('{"schemaId"')
        || rawModelOutput.includes('"schemaId"');
}

function isLikelyPartialJsonDetail(detail: string): boolean {
    const normalized = String(detail || '').trim().toLowerCase();
    return normalized.includes('unexpected end of json input')
        || normalized.includes('unexpected end of input')
        || normalized.includes("expected '}'")
        || normalized.includes("expected ']'")
        || normalized.includes('end of json input');
}

function classifyJsonFailure(rawModelOutput: string, detail: string): AgentModelOutputClassification {
    if (isLikelyPartialJsonDetail(detail) || hasUnbalancedJsonDelimiters(rawModelOutput)) {
        return 'partial-json';
    }
    return looksLikeJsonAttempt(rawModelOutput) ? 'invalid-json' : 'invalid-json';
}

function tryParseEnvelopeCandidate(rawModelOutput: string): {
    envelope: AgentResolvedMessageActionEnvelope | null;
    parseErrorDetail: string | null;
} {
    try {
        const payload = JSON.parse(rawModelOutput) as unknown;
        return {
            envelope: parseAgentResolvedMessageActionEnvelopeFromPayload(payload),
            parseErrorDetail: null,
        };
    } catch (error) {
        return {
            envelope: null,
            parseErrorDetail: error instanceof Error ? error.message : String(error || 'invalid JSON'),
        };
    }
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
        image: parseAgentImageExecutionDiagnostics(record.image),
        preflight: parseAgentPreflightExecutionDiagnostics(record.preflight),
    };
}

export function buildAgentPreflightDiagnosticsFromError(error: unknown): AgentModelOutputDiagnostics | null {
    const record = error && typeof error === 'object' && !Array.isArray(error)
        ? error as Record<string, unknown>
        : null;
    const details = record?.details;
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
        return null;
    }
    const contextWindowSource = normalizeContextWindowSource((details as Record<string, unknown>).contextWindowSource);
    if ((details as Record<string, unknown>).promptOverflow !== true || !contextWindowSource) {
        return null;
    }
    return {
        classification: 'preflight-rejected',
        recoveryPath: 'none',
        suspectedTruncation: false,
        parseErrorDetail: normalizeNullableText(record?.message) || 'Local preflight rejected the request.',
        rawOutputChars: 0,
        normalizedOutputChars: 0,
        finishReason: null,
        traceId: normalizeNullableText(record?.traceId),
        promptTraceId: null,
        usage: null,
        contextWindowSource,
        maxOutputTokensRequested: normalizeOptionalPositiveInteger((details as Record<string, unknown>).maxOutputTokensRequested),
        promptOverflow: true,
        requestPrompt: normalizeNullableText((details as Record<string, unknown>).requestPrompt),
        requestSystemPrompt: normalizeNullableText((details as Record<string, unknown>).requestSystemPrompt),
        rawModelOutputText: null,
        normalizedModelOutputText: null,
        chainId: null,
        followUpDepth: null,
        maxFollowUpTurns: null,
        followUpCanceledByUser: false,
        followUpSourceActionId: null,
        image: null,
        preflight: {
            totalInputTokens: normalizeOptionalNonNegativeNumber((details as Record<string, unknown>).totalInputTokens),
            promptBudgetTokens: normalizeOptionalNonNegativeNumber((details as Record<string, unknown>).promptBudgetTokens),
            systemTokens: normalizeOptionalNonNegativeNumber((details as Record<string, unknown>).systemTokens),
            historyTokens: normalizeOptionalNonNegativeNumber((details as Record<string, unknown>).historyTokens),
            userTokens: normalizeOptionalNonNegativeNumber((details as Record<string, unknown>).userTokens),
        },
    };
}

export function toAgentModelOutputTurnError(
    diagnostics: AgentModelOutputDiagnostics,
): { code: string; message: string } {
    if (diagnostics.suspectedTruncation) {
        return {
            code: 'AGENT_OUTPUT_INVALID',
            message: 'Agent response was truncated before the structured reply completed.',
        };
    }
    return {
        code: 'AGENT_OUTPUT_INVALID',
        message: 'Agent response format was invalid.',
    };
}

export function resolveAgentModelOutputEnvelope(
    input: ResolveAgentModelOutputEnvelopeInput,
): ResolveAgentModelOutputEnvelopeResult {
    const rawModelOutput = String(input.modelOutput || '');
    const normalizedModelOutput = normalizeModelOutputText(rawModelOutput);
    const strictCandidate = tryParseEnvelopeCandidate(normalizedModelOutput);
    if (strictCandidate.envelope) {
        return {
            ok: true,
            envelope: strictCandidate.envelope,
            diagnostics: buildAgentModelOutputDiagnostics({
                classification: 'strict-json',
                recoveryPath: 'none',
                suspectedTruncation: false,
                rawModelOutput,
                normalizedModelOutput,
                finishReason: input.finishReason,
                trace: input.trace,
                usage: input.usage,
                contextWindowSource: input.contextWindowSource,
                maxOutputTokensRequested: input.maxOutputTokensRequested,
                promptOverflow: input.promptOverflow,
                requestPrompt: input.requestPrompt,
                requestSystemPrompt: input.requestSystemPrompt,
            }),
        };
    }

    const fencedCandidateText = stripFencedJsonBlock(normalizedModelOutput);
    if (fencedCandidateText) {
        const fencedCandidate = tryParseEnvelopeCandidate(fencedCandidateText);
        if (fencedCandidate.envelope) {
            return {
                ok: true,
                envelope: fencedCandidate.envelope,
                diagnostics: buildAgentModelOutputDiagnostics({
                    classification: 'json-fenced',
                    recoveryPath: 'strip-fence',
                    suspectedTruncation: false,
                    rawModelOutput,
                    normalizedModelOutput,
                    finishReason: input.finishReason,
                    trace: input.trace,
                    usage: input.usage,
                    contextWindowSource: input.contextWindowSource,
                    maxOutputTokensRequested: input.maxOutputTokensRequested,
                    promptOverflow: input.promptOverflow,
                    requestPrompt: input.requestPrompt,
                    requestSystemPrompt: input.requestSystemPrompt,
                }),
            };
        }
    }

    const wrappedJsonObject = extractSingleWrappedJsonObject(normalizedModelOutput);
    if (wrappedJsonObject) {
        const wrappedCandidate = tryParseEnvelopeCandidate(wrappedJsonObject);
        if (wrappedCandidate.envelope) {
            return {
                ok: true,
                envelope: wrappedCandidate.envelope,
                diagnostics: buildAgentModelOutputDiagnostics({
                    classification: 'json-wrapper',
                    recoveryPath: 'extract-json-object',
                    suspectedTruncation: false,
                    rawModelOutput,
                    normalizedModelOutput,
                    finishReason: input.finishReason,
                    trace: input.trace,
                    usage: input.usage,
                    contextWindowSource: input.contextWindowSource,
                    maxOutputTokensRequested: input.maxOutputTokensRequested,
                    promptOverflow: input.promptOverflow,
                    requestPrompt: input.requestPrompt,
                    requestSystemPrompt: input.requestSystemPrompt,
                }),
            };
        }
    }

    const plainTextEnvelope = recoverPlainTextAsEnvelope(normalizedModelOutput);
    if (plainTextEnvelope) {
        return {
            ok: true,
            envelope: plainTextEnvelope,
            diagnostics: buildAgentModelOutputDiagnostics({
                classification: 'plain-text',
                recoveryPath: 'plain-text-envelope',
                suspectedTruncation: false,
                rawModelOutput,
                normalizedModelOutput,
                finishReason: input.finishReason,
                trace: input.trace,
                usage: input.usage,
                contextWindowSource: input.contextWindowSource,
                maxOutputTokensRequested: input.maxOutputTokensRequested,
                promptOverflow: input.promptOverflow,
                requestPrompt: input.requestPrompt,
                requestSystemPrompt: input.requestSystemPrompt,
            }),
        };
    }

    const parseErrorDetail = normalizeNullableText(strictCandidate.parseErrorDetail)
        || normalizeNullableText(
            fencedCandidateText ? tryParseEnvelopeCandidate(fencedCandidateText).parseErrorDetail : null,
        )
        || normalizeNullableText(
            wrappedJsonObject ? tryParseEnvelopeCandidate(wrappedJsonObject).parseErrorDetail : null,
        );
    const suspectedTruncation = normalizeNullableText(input.finishReason) === 'length'
        || Boolean(parseErrorDetail && isLikelyPartialJsonDetail(parseErrorDetail))
        || hasUnbalancedJsonDelimiters(normalizedModelOutput);
    return {
        ok: false,
        diagnostics: buildAgentModelOutputDiagnostics({
            classification: classifyJsonFailure(normalizedModelOutput, parseErrorDetail || 'invalid JSON'),
            recoveryPath: 'none',
            suspectedTruncation,
            parseErrorDetail,
            rawModelOutput,
            normalizedModelOutput,
            finishReason: input.finishReason,
            trace: input.trace,
            usage: input.usage,
            contextWindowSource: input.contextWindowSource,
            maxOutputTokensRequested: input.maxOutputTokensRequested,
            promptOverflow: input.promptOverflow,
            requestPrompt: input.requestPrompt,
            requestSystemPrompt: input.requestSystemPrompt,
        }),
    };
}

export {
    buildAgentResolvedOutputText,
    recoverPlainTextAsEnvelope,
};
