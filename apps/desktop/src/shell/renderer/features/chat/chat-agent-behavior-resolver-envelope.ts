import {
    AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
    AGENT_RESOLVED_STATUS_CUE_MOODS,
} from './chat-agent-behavior';
import type {
    AgentResolvedMessage,
    AgentResolvedMessageActionEnvelope,
    AgentResolvedModalityAction,
    AgentResolvedModalityActionPromptPayload,
    AgentResolvedStatusCue,
    AgentResolvedStatusCueMood,
} from './chat-agent-behavior';
import type { AgentResolvedStatusCueDiagnostic } from './chat-agent-behavior-resolver-types';

const AGENT_ACTION_MODALITIES: ReadonlySet<AgentResolvedModalityAction['modality']> = new Set([
    'image',
    'voice',
]);
const AGENT_ACTION_DELIVERY_COUPLINGS: ReadonlySet<AgentResolvedModalityAction['deliveryCoupling']> = new Set([
    'after-message',
    'with-message',
]);
const AGENT_STATUS_CUE_FIELDS: ReadonlySet<keyof AgentResolvedStatusCue> = new Set([
    'sourceMessageId',
    'mood',
    'label',
    'intensity',
    'actionCue',
]);
const AGENT_STATUS_CUE_MOODS: ReadonlySet<AgentResolvedStatusCueMood> = new Set(AGENT_RESOLVED_STATUS_CUE_MOODS);

function parseRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
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

function parseOptionalTrimmedString(value: unknown, label: string): string | null {
    if (value == null) {
        return null;
    }
    return parseTrimmedString(value, label);
}

function parseNonNegativeInteger(value: unknown, label: string): number {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 0) {
        throw new Error(`${label} must be a non-negative integer`);
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

function parseUnitInterval(value: unknown, label: string): number {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
        throw new Error(`${label} must be a number between 0 and 1`);
    }
    return normalized;
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

function parseStatusCueMood(value: unknown, label: string): AgentResolvedStatusCueMood {
    const mood = parseTrimmedString(value, label) as AgentResolvedStatusCueMood;
    if (!AGENT_STATUS_CUE_MOODS.has(mood)) {
        throw new Error(`${label} is invalid`);
    }
    return mood;
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
    throw new Error(`${label}.kind is invalid`);
}

function parseResolvedMessage(value: unknown): AgentResolvedMessage {
    const record = parseRecord(value, 'message');
    return {
        messageId: parseTrimmedString(record.messageId, 'message.messageId'),
        text: parseTrimmedString(record.text, 'message.text'),
    };
}

function parseResolvedStatusCue(value: unknown, messageId: string): AgentResolvedStatusCue {
    const record = parseRecord(value, 'statusCue');
    for (const field of Object.keys(record)) {
        if (!AGENT_STATUS_CUE_FIELDS.has(field as keyof AgentResolvedStatusCue)) {
            throw new Error(`statusCue.${field} is not admitted`);
        }
    }
    const sourceMessageId = parseTrimmedString(record.sourceMessageId, 'statusCue.sourceMessageId');
    if (sourceMessageId !== messageId) {
        throw new Error('statusCue.sourceMessageId must equal message.messageId');
    }
    const mood = Object.prototype.hasOwnProperty.call(record, 'mood')
        ? parseOptionalTrimmedString(record.mood, 'statusCue.mood')
        : null;
    const label = Object.prototype.hasOwnProperty.call(record, 'label')
        ? parseOptionalTrimmedString(record.label, 'statusCue.label')
        : null;
    const actionCue = Object.prototype.hasOwnProperty.call(record, 'actionCue')
        ? parseOptionalTrimmedString(record.actionCue, 'statusCue.actionCue')
        : null;
    const intensity = Object.prototype.hasOwnProperty.call(record, 'intensity')
        ? record.intensity == null
            ? null
            : parseUnitInterval(record.intensity, 'statusCue.intensity')
        : null;
    if (!mood && !label && !actionCue) {
        throw new Error('statusCue must include at least one usable affect field');
    }
    return {
        sourceMessageId,
        ...(mood ? { mood: parseStatusCueMood(mood, 'statusCue.mood') } : {}),
        ...(label ? { label } : {}),
        ...(typeof intensity === 'number' ? { intensity } : {}),
        ...(actionCue ? { actionCue } : {}),
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
    for (const action of actions) {
        if (action.modality === 'image') imageActionCount += 1;
        if (action.modality === 'voice') voiceActionCount += 1;
    }
    if (imageActionCount > 1) {
        throw new Error('agent-local-chat-v1 admits at most one image action in phase 0');
    }
    if (voiceActionCount > 1) {
        throw new Error('agent-local-chat-v1 admits at most one voice action in phase 1');
    }
}

function parseStatusCueBranch(input: {
    record: Record<string, unknown>;
    messageId: string;
}): {
    statusCue: AgentResolvedStatusCue | null;
    statusCueDiagnostic: AgentResolvedStatusCueDiagnostic | null;
} {
    if (!Object.prototype.hasOwnProperty.call(input.record, 'statusCue') || input.record.statusCue == null) {
        return {
            statusCue: null,
            statusCueDiagnostic: null,
        };
    }
    const rawFieldsPresent = input.record.statusCue && typeof input.record.statusCue === 'object' && !Array.isArray(input.record.statusCue)
        ? Object.keys(input.record.statusCue as Record<string, unknown>)
        : [];
    try {
        const statusCue = parseResolvedStatusCue(input.record.statusCue, input.messageId);
        return {
            statusCue,
            statusCueDiagnostic: {
                accepted: true,
                reason: null,
                sourceMessageId: statusCue.sourceMessageId,
                rawFieldsPresent,
            },
        };
    } catch (error) {
        return {
            statusCue: null,
            statusCueDiagnostic: {
                accepted: false,
                reason: error instanceof Error ? error.message : String(error || 'invalid statusCue'),
                sourceMessageId: null,
                rawFieldsPresent,
            },
        };
    }
}

function parseTagAttributes(rawAttrs: string, label: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const normalized = String(rawAttrs || '').trim();
    if (!normalized) {
        return attrs;
    }
    const attrPattern = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*"([^"]*)"/gu;
    let consumed = '';
    let match: RegExpExecArray | null;
    while ((match = attrPattern.exec(normalized)) !== null) {
        const attrName = match[1] || '';
        if (Object.prototype.hasOwnProperty.call(attrs, attrName)) {
            throw new Error(`${label}.${attrName} is duplicated`);
        }
        attrs[attrName] = match[2] || '';
        consumed += match[0];
    }
    const leftovers = normalized.replace(attrPattern, '').trim();
    if (leftovers) {
        throw new Error(`${label} attributes are invalid`);
    }
    if (!consumed && normalized) {
        throw new Error(`${label} attributes are invalid`);
    }
    return attrs;
}

function assertAllowedAPMLAttributes(
    attrs: Record<string, string>,
    label: string,
    allowed: readonly string[],
): void {
    const allowedSet = new Set(allowed);
    for (const attr of Object.keys(attrs)) {
        if (!allowedSet.has(attr)) {
            throw new Error(`${label}.${attr} is not admitted`);
        }
    }
}

function parseAPMLStartTag(input: string, tagName: string, label: string): {
    attrs: Record<string, string>;
    bodyStart: number;
} {
    const pattern = new RegExp(`^<${tagName}\\b([^>]*)>`, 'iu');
    const match = input.match(pattern);
    if (!match) {
        throw new Error(`${label} must start with <${tagName}>`);
    }
    const startTag = match[0] || '';
    if (startTag.endsWith('/>')) {
        throw new Error(`${label} must not be self-closing`);
    }
    return {
        attrs: parseTagAttributes(match[1] || '', label),
        bodyStart: startTag.length,
    };
}

function extractRequiredAPMLTagBody(input: string, tagName: string, label: string): {
    attrs: Record<string, string>;
    body: string;
    rest: string;
} {
    const start = parseAPMLStartTag(input, tagName, label);
    const closeTag = `</${tagName}>`;
    const closeIndex = input.indexOf(closeTag, start.bodyStart);
    if (closeIndex < 0) {
        throw new Error(`${label} missing ${closeTag}`);
    }
    return {
        attrs: start.attrs,
        body: input.slice(start.bodyStart, closeIndex),
        rest: input.slice(closeIndex + closeTag.length),
    };
}

function extractAPMLChildText(input: string, tagName: string, label: string): {
    value: string | null;
    output: string;
} {
    const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)</${tagName}>`, 'giu');
    let value: string | null = null;
    const output = input.replace(pattern, (_match, rawAttrs: string, body: string) => {
        if (value != null) {
            throw new Error(`${label} admits at most one <${tagName}>`);
        }
        const attrs = parseTagAttributes(rawAttrs || '', `${label}.${tagName}`);
        assertAllowedAPMLAttributes(attrs, `${label}.${tagName}`, []);
        if (String(body || '').includes('<')) {
            throw new Error(`${label}.${tagName} must contain text only`);
        }
        value = String(body || '').trim();
        return '';
    });
    return { value, output };
}

function normalizeAPMLText(value: string): string {
    return String(value || '')
        .replace(/[ \t]*\n[ \t]*/gu, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
        .trim();
}

function defaultAPMLOperation(kind: AgentResolvedModalityAction['modality']): string {
    return kind === 'image' ? 'image.generate' : 'audio.synthesize';
}

function parseAPMLMessage(input: string): {
    message: AgentResolvedMessage;
    statusCue: AgentResolvedStatusCue | null;
    statusCueDiagnostic: AgentResolvedStatusCueDiagnostic | null;
    rest: string;
} {
    const parsed = extractRequiredAPMLTagBody(input, 'message', 'APML message');
    assertAllowedAPMLAttributes(parsed.attrs, 'APML message', ['id']);
    const messageId = parseTrimmedString(parsed.attrs.id, 'APML message.id');
    const emotion = extractAPMLChildText(parsed.body, 'emotion', 'APML message');
    const activity = extractAPMLChildText(emotion.output, 'activity', 'APML message');
    const visibleText = normalizeAPMLText(activity.output);
    if (visibleText.includes('<')) {
        throw new Error('APML message contains unsupported tags');
    }
    const message: AgentResolvedMessage = {
        messageId,
        text: parseTrimmedString(visibleText, 'APML message text'),
    };
    const rawFieldsPresent = [
        ...(emotion.value ? ['emotion'] : []),
        ...(activity.value ? ['activity'] : []),
    ];
    if (emotion.value && !AGENT_STATUS_CUE_MOODS.has(emotion.value as AgentResolvedStatusCueMood)) {
        throw new Error('APML message.emotion is not admitted');
    }
    const statusCue: AgentResolvedStatusCue | null = emotion.value || activity.value
        ? {
            sourceMessageId: messageId,
            ...(emotion.value ? { mood: emotion.value as AgentResolvedStatusCueMood } : {}),
            ...(activity.value ? { actionCue: activity.value } : {}),
        }
        : null;
    return {
        message,
        statusCue,
        statusCueDiagnostic: statusCue
            ? {
                accepted: true,
                reason: null,
                sourceMessageId: messageId,
                rawFieldsPresent,
            }
            : null,
        rest: parsed.rest,
    };
}

function parseAPMLAction(input: string, messageId: string, actionIndex: number): {
    action: AgentResolvedModalityAction;
    rest: string;
} {
    const parsed = extractRequiredAPMLTagBody(input, 'action', 'APML action');
    assertAllowedAPMLAttributes(parsed.attrs, 'APML action', ['id', 'kind']);
    const kind = parseTrimmedString(parsed.attrs.kind, 'APML action.kind');
    if (kind === 'video') {
        throw new Error('APML video action is deferred to future authority');
    }
    if (kind !== 'image' && kind !== 'voice') {
        throw new Error('APML action.kind is invalid');
    }
    const payload = extractRequiredAPMLTagBody(parsed.body.trim(), 'prompt-payload', 'APML prompt-payload');
    assertAllowedAPMLAttributes(payload.attrs, 'APML prompt-payload', ['kind']);
    if (payload.rest.trim()) {
        throw new Error('APML action contains unsupported tags');
    }
    const payloadKind = parseTrimmedString(payload.attrs.kind, 'APML prompt-payload.kind');
    if (payloadKind !== kind) {
        throw new Error('APML prompt-payload.kind must match action.kind');
    }
    const promptText = extractAPMLChildText(payload.body, 'prompt-text', 'APML prompt-payload');
    if (promptText.output.trim()) {
        throw new Error('APML prompt-payload contains unsupported tags');
    }
    return {
        action: {
            actionId: parseTrimmedString(parsed.attrs.id, 'APML action.id'),
            actionIndex,
            actionCount: 0,
            modality: kind,
            operation: defaultAPMLOperation(kind),
            promptPayload: kind === 'image'
                ? {
                    kind: 'image-prompt',
                    promptText: parseTrimmedString(promptText.value, 'APML prompt-text'),
                }
                : {
                    kind: 'voice-prompt',
                    promptText: parseTrimmedString(promptText.value, 'APML prompt-text'),
                },
            sourceMessageId: messageId,
            deliveryCoupling: 'after-message',
        },
        rest: parsed.rest,
    };
}

export function parseAgentResolvedMessageActionAPMLEnvelopeWithDiagnostics(modelOutput: string): {
    envelope: AgentResolvedMessageActionEnvelope;
    statusCueDiagnostic: AgentResolvedStatusCueDiagnostic | null;
} {
    const raw = String(modelOutput || '').trim();
    if (!raw.startsWith('<message')) {
        throw new Error('APML output must begin with <message>');
    }
    const parsedMessage = parseAPMLMessage(raw);
    let rest = parsedMessage.rest.trim();
    const actions: AgentResolvedModalityAction[] = [];
    while (rest) {
        if (rest.startsWith('<time-hook') || rest.startsWith('<event-hook')) {
            throw new Error('APML hook tags are runtime HookIntent-owned and are not admitted in the Desktop local parser');
        }
        if (!rest.startsWith('<action')) {
            throw new Error('APML output contains unsupported top-level tags');
        }
        const parsedAction = parseAPMLAction(rest, parsedMessage.message.messageId, actions.length);
        actions.push(parsedAction.action);
        rest = parsedAction.rest.trim();
    }
    if (actions.length > 0) {
        for (const action of actions) {
            action.actionCount = actions.length;
            if (action.sourceMessageId !== parsedMessage.message.messageId) {
                throw new Error(`action ${action.actionId} source message reference is inconsistent`);
            }
        }
    }
    validatePhaseOneActionEnvelopeLimits(actions);
    return {
        envelope: {
            schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
            message: parsedMessage.message,
            ...(parsedMessage.statusCue ? { statusCue: parsedMessage.statusCue } : {}),
            actions,
        },
        statusCueDiagnostic: parsedMessage.statusCueDiagnostic,
    };
}

export function parseAgentResolvedMessageActionEnvelopeWithDiagnosticsFromPayload(payload: unknown): {
    envelope: AgentResolvedMessageActionEnvelope;
    statusCueDiagnostic: AgentResolvedStatusCueDiagnostic | null;
} {
    const record = parseRecord(payload, 'agent resolved message-action projection');
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
    const { statusCue, statusCueDiagnostic } = parseStatusCueBranch({
        record,
        messageId: message.messageId,
    });
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
    }
    validatePhaseOneActionEnvelopeLimits(actions);
    return {
        envelope: {
            schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
            message,
            ...(statusCue ? { statusCue } : {}),
            actions,
        },
        statusCueDiagnostic,
    };
}

export function parseAgentResolvedMessageActionEnvelopeFromPayload(payload: unknown): AgentResolvedMessageActionEnvelope {
    return parseAgentResolvedMessageActionEnvelopeWithDiagnosticsFromPayload(payload).envelope;
}

export function parseAgentResolvedMessageActionEnvelopeWithDiagnostics(modelOutput: string): {
    envelope: AgentResolvedMessageActionEnvelope;
    statusCueDiagnostic: AgentResolvedStatusCueDiagnostic | null;
} {
    const raw = String(modelOutput || '').trim();
    if (!raw) {
        throw new Error('Agent model output message-action envelope is required');
    }
    return parseAgentResolvedMessageActionAPMLEnvelopeWithDiagnostics(raw);
}

export function parseAgentResolvedMessageActionEnvelope(modelOutput: string): AgentResolvedMessageActionEnvelope {
    return parseAgentResolvedMessageActionEnvelopeWithDiagnostics(modelOutput).envelope;
}

export function buildAgentResolvedOutputText(envelope: AgentResolvedMessageActionEnvelope): string {
    return envelope.message.text.trim();
}
