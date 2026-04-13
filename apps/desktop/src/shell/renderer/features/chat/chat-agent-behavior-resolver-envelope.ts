import {
    AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
} from './chat-agent-behavior';
import type {
    AgentResolvedMessage,
    AgentResolvedMessageActionEnvelope,
    AgentResolvedModalityAction,
    AgentResolvedModalityActionPromptPayload,
} from './chat-agent-behavior';

const AGENT_ACTION_MODALITIES: ReadonlySet<AgentResolvedModalityAction['modality']> = new Set([
    'image',
    'voice',
    'video',
    'follow-up-turn',
]);
const AGENT_ACTION_DELIVERY_COUPLINGS: ReadonlySet<AgentResolvedModalityAction['deliveryCoupling']> = new Set([
    'after-message',
    'with-message',
]);

function parseRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be a JSON object`);
    }
    return value as Record<string, unknown>;
}

function parseTrimmedString(value: unknown, label: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new Error(`${label} is required`);
    }
    return normalized;
}

function parseNonNegativeInteger(value: unknown, label: string): number {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 0) {
        throw new Error(`${label} must be a non-negative integer`);
    }
    return normalized;
}

function parsePositiveInteger(value: unknown, label: string): number {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
    return normalized;
}

function normalizeMirroredCount(value: unknown, expectedCount: number): number {
    const normalized = Number(value);
    if (Number.isInteger(normalized) && normalized > 0 && normalized === expectedCount) {
        return normalized;
    }
    return expectedCount;
}

function parseActionModality(value: unknown, label: string): AgentResolvedModalityAction['modality'] {
    const modality = parseTrimmedString(value, label) as AgentResolvedModalityAction['modality'];
    if (!AGENT_ACTION_MODALITIES.has(modality)) {
        throw new Error(`${label} is invalid`);
    }
    return modality;
}

function parseActionDeliveryCoupling(
    value: unknown,
    label: string,
): AgentResolvedModalityAction['deliveryCoupling'] {
    const deliveryCoupling = parseTrimmedString(value, label) as AgentResolvedModalityAction['deliveryCoupling'];
    if (!AGENT_ACTION_DELIVERY_COUPLINGS.has(deliveryCoupling)) {
        throw new Error(`${label} is invalid`);
    }
    return deliveryCoupling;
}

function parsePromptPayload(
    value: unknown,
    modality: AgentResolvedModalityAction['modality'],
    label: string,
): AgentResolvedModalityActionPromptPayload {
    const record = parseRecord(value, label);
    const kind = parseTrimmedString(record.kind, `${label}.kind`);
    const promptText = parseTrimmedString(record.promptText, `${label}.promptText`);
    if (modality === 'image') {
        if (kind !== 'image-prompt') {
            throw new Error(`${label}.kind must match modality image`);
        }
        return { kind, promptText };
    }
    if (modality === 'voice') {
        if (kind !== 'voice-prompt') {
            throw new Error(`${label}.kind must match modality voice`);
        }
        return { kind, promptText };
    }
    if (modality === 'video') {
        if (kind !== 'video-prompt') {
            throw new Error(`${label}.kind must match modality video`);
        }
        return { kind, promptText };
    }
    if (kind !== 'follow-up-turn') {
        throw new Error(`${label}.kind must match modality follow-up-turn`);
    }
    return {
        kind,
        promptText,
        delayMs: parsePositiveInteger(record.delayMs, `${label}.delayMs`),
    };
}

function parseResolvedMessage(value: unknown): AgentResolvedMessage {
    const record = parseRecord(value, 'message');
    return {
        messageId: parseTrimmedString(record.messageId, 'message.messageId'),
        text: parseTrimmedString(record.text, 'message.text'),
    };
}

function parseResolvedModalityAction(
    value: unknown,
    actionArrayIndex: number,
    actionCount: number,
): AgentResolvedModalityAction {
    const record = parseRecord(value, `actions[${actionArrayIndex}]`);
    const modality = parseActionModality(record.modality, `actions[${actionArrayIndex}].modality`);
    const action = {
        actionId: parseTrimmedString(record.actionId, `actions[${actionArrayIndex}].actionId`),
        actionIndex: parseNonNegativeInteger(record.actionIndex, `actions[${actionArrayIndex}].actionIndex`),
        actionCount: normalizeMirroredCount(record.actionCount, actionCount),
        modality,
        operation: parseTrimmedString(record.operation, `actions[${actionArrayIndex}].operation`),
        promptPayload: parsePromptPayload(record.promptPayload, modality, `actions[${actionArrayIndex}].promptPayload`),
        sourceMessageId: parseTrimmedString(record.sourceMessageId, `actions[${actionArrayIndex}].sourceMessageId`),
        deliveryCoupling: parseActionDeliveryCoupling(
            record.deliveryCoupling,
            `actions[${actionArrayIndex}].deliveryCoupling`,
        ),
    } satisfies AgentResolvedModalityAction;
    if (action.actionIndex !== actionArrayIndex) {
        throw new Error(`actions[${actionArrayIndex}].actionIndex must equal ${actionArrayIndex}`);
    }
    if (action.actionCount !== actionCount) {
        throw new Error(`actions[${actionArrayIndex}].actionCount must equal ${actionCount}`);
    }
    return action;
}

function validatePhaseOneActionEnvelopeLimits(actions: readonly AgentResolvedModalityAction[]): void {
    let imageActionCount = 0;
    let voiceActionCount = 0;
    let followUpActionCount = 0;
    for (const action of actions) {
        if (action.modality === 'image') imageActionCount += 1;
        if (action.modality === 'voice') voiceActionCount += 1;
        if (action.modality === 'follow-up-turn') followUpActionCount += 1;
    }
    if (imageActionCount > 1) {
        throw new Error('agent-local-chat-v1 admits at most one image action in phase 0');
    }
    if (voiceActionCount > 1) {
        throw new Error('agent-local-chat-v1 admits at most one voice action in phase 1');
    }
    if (followUpActionCount > 1) {
        throw new Error('agent-local-chat-v1 admits at most one follow-up-turn action per turn');
    }
}

export function parseAgentResolvedMessageActionEnvelopeFromPayload(payload: unknown): AgentResolvedMessageActionEnvelope {
    const record = parseRecord(payload, 'agent model output message-action envelope');
    const schemaId = parseTrimmedString(record.schemaId, 'schemaId');
    if (schemaId !== AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID) {
        throw new Error(`schemaId must equal ${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}`);
    }
    if (!record.message) {
        throw new Error('message is required');
    }
    if (!Array.isArray(record.actions)) {
        throw new Error('actions must be an array');
    }

    const message = parseResolvedMessage(record.message);
    const actionValues = record.actions as unknown[];
    const actions = actionValues.map((action, index) => parseResolvedModalityAction(action, index, actionValues.length));
    const actionIds = new Set<string>();
    for (const action of actions) {
        if (actionIds.has(action.actionId)) {
            throw new Error(`duplicate actionId: ${action.actionId}`);
        }
        actionIds.add(action.actionId);
        if (action.sourceMessageId !== message.messageId) {
            throw new Error(`action ${action.actionId} source message reference is inconsistent`);
        }
        if (action.modality === 'follow-up-turn' && action.operation !== 'assistant.turn.schedule') {
            throw new Error(`follow-up-turn action ${action.actionId} must use assistant.turn.schedule`);
        }
    }
    validatePhaseOneActionEnvelopeLimits(actions);
    return {
        schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
        message,
        actions,
    };
}

export function parseAgentResolvedMessageActionEnvelope(modelOutput: string): AgentResolvedMessageActionEnvelope {
    const raw = String(modelOutput || '').trim();
    if (!raw) {
        throw new Error('Agent model output message-action envelope is required');
    }
    let payload: unknown;
    try {
        payload = JSON.parse(raw) as unknown;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error || 'invalid JSON');
        const hint = raw.startsWith('`')
            ? 'leading backticks detected; remove Markdown code fences and return the JSON object directly'
            : 'return the JSON object directly with no wrapper text';
        throw new Error(
            `Agent model output must be a raw JSON object with no Markdown code fences or wrapper text: ${hint} (${detail})`,
            { cause: error },
        );
    }
    return parseAgentResolvedMessageActionEnvelopeFromPayload(payload);
}

export function buildAgentResolvedOutputText(envelope: AgentResolvedMessageActionEnvelope): string {
    return envelope.message.text.trim();
}

export function recoverPlainTextAsEnvelope(rawModelOutput: string): AgentResolvedMessageActionEnvelope | null {
    const text = rawModelOutput.trim();
    if (!text || text.startsWith('{') || text.startsWith('[') || text.startsWith('`')) {
        return null;
    }
    return {
        schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
        message: {
            messageId: 'message-0',
            text,
        },
        actions: [],
    };
}
