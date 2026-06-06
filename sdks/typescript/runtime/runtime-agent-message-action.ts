export const NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID = 'nimi.agent.chat.message-action.v1' as const;

export type NimiRuntimeAgentResolvedMessage = {
  readonly messageId: string;
  readonly text: string;
};

export const NIMI_RUNTIME_AGENT_RESOLVED_STATUS_CUE_MOODS = [
  'neutral',
  'joy',
  'focus',
  'calm',
  'playful',
  'concerned',
  'surprised',
] as const;

export type NimiRuntimeAgentResolvedStatusCueMood =
  (typeof NIMI_RUNTIME_AGENT_RESOLVED_STATUS_CUE_MOODS)[number];

export type NimiRuntimeAgentResolvedStatusCue = {
  readonly sourceMessageId: string;
  readonly mood?: NimiRuntimeAgentResolvedStatusCueMood | null;
  readonly label?: string | null;
  readonly intensity?: number | null;
  readonly actionCue?: string | null;
};

export type NimiRuntimeAgentResolvedModalityActionPromptPayload =
  | {
    readonly kind: 'image-prompt';
    readonly promptText: string;
  }
  | {
    readonly kind: 'voice-prompt';
    readonly promptText: string;
  };

export type NimiRuntimeAgentResolvedModalityAction = {
  readonly actionId: string;
  readonly actionIndex: number;
  readonly actionCount: number;
  readonly modality: 'image' | 'voice';
  readonly operation: string;
  readonly promptPayload: NimiRuntimeAgentResolvedModalityActionPromptPayload;
  readonly sourceMessageId: string;
  readonly deliveryCoupling: 'after-message' | 'with-message';
};

export type NimiRuntimeAgentResolvedMessageActionEnvelope = {
  readonly schemaId: typeof NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID;
  readonly message: NimiRuntimeAgentResolvedMessage;
  readonly statusCue?: NimiRuntimeAgentResolvedStatusCue | null;
  readonly actions: readonly NimiRuntimeAgentResolvedModalityAction[];
};

const ACTION_MODALITIES: ReadonlySet<NimiRuntimeAgentResolvedModalityAction['modality']> = new Set([
  'image',
  'voice',
]);
const ACTION_DELIVERY_COUPLINGS: ReadonlySet<NimiRuntimeAgentResolvedModalityAction['deliveryCoupling']> = new Set([
  'after-message',
  'with-message',
]);
const STATUS_CUE_FIELDS: ReadonlySet<keyof NimiRuntimeAgentResolvedStatusCue> = new Set([
  'sourceMessageId',
  'mood',
  'label',
  'intensity',
  'actionCue',
]);
const STATUS_CUE_MOODS: ReadonlySet<NimiRuntimeAgentResolvedStatusCueMood> = new Set(
  NIMI_RUNTIME_AGENT_RESOLVED_STATUS_CUE_MOODS,
);

function parseRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

function parseActionModality(value: unknown, label: string): NimiRuntimeAgentResolvedModalityAction['modality'] {
  const modality = parseTrimmedString(value, label) as NimiRuntimeAgentResolvedModalityAction['modality'];
  if (!ACTION_MODALITIES.has(modality)) {
    throw new Error(`${label} is invalid`);
  }
  return modality;
}

function parseActionDeliveryCoupling(
  value: unknown,
  label: string,
): NimiRuntimeAgentResolvedModalityAction['deliveryCoupling'] {
  const deliveryCoupling = parseTrimmedString(value, label) as NimiRuntimeAgentResolvedModalityAction['deliveryCoupling'];
  if (!ACTION_DELIVERY_COUPLINGS.has(deliveryCoupling)) {
    throw new Error(`${label} is invalid`);
  }
  return deliveryCoupling;
}

function parseStatusCueMood(value: unknown, label: string): NimiRuntimeAgentResolvedStatusCueMood {
  const mood = parseTrimmedString(value, label) as NimiRuntimeAgentResolvedStatusCueMood;
  if (!STATUS_CUE_MOODS.has(mood)) {
    throw new Error(`${label} is invalid`);
  }
  return mood;
}

function parsePromptPayload(
  value: unknown,
  modality: NimiRuntimeAgentResolvedModalityAction['modality'],
  label: string,
): NimiRuntimeAgentResolvedModalityActionPromptPayload {
  const record = parseRecord(value, label);
  const kind = parseTrimmedString(record.kind, `${label}.kind`);
  const promptText = parseTrimmedString(record.promptText, `${label}.promptText`);
  if (modality === 'image') {
    if (kind !== 'image-prompt') {
      throw new Error(`${label}.kind must match modality image`);
    }
    return { kind, promptText };
  }
  if (kind !== 'voice-prompt') {
    throw new Error(`${label}.kind must match modality voice`);
  }
  return { kind, promptText };
}

function parseResolvedMessage(value: unknown): NimiRuntimeAgentResolvedMessage {
  const record = parseRecord(value, 'message');
  return {
    messageId: parseTrimmedString(record.messageId, 'message.messageId'),
    text: parseTrimmedString(record.text, 'message.text'),
  };
}

function parseResolvedStatusCue(value: unknown, messageId: string): NimiRuntimeAgentResolvedStatusCue {
  const record = parseRecord(value, 'statusCue');
  for (const field of Object.keys(record)) {
    if (!STATUS_CUE_FIELDS.has(field as keyof NimiRuntimeAgentResolvedStatusCue)) {
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
): NimiRuntimeAgentResolvedModalityAction {
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
  } satisfies NimiRuntimeAgentResolvedModalityAction;
  if (action.actionIndex !== actionArrayIndex) {
    throw new Error(`actions[${actionArrayIndex}].actionIndex must equal ${actionArrayIndex}`);
  }
  if (action.actionCount !== actionCount) {
    throw new Error(`actions[${actionArrayIndex}].actionCount must equal ${actionCount}`);
  }
  return action;
}

function validatePhaseOneActionEnvelopeLimits(actions: readonly NimiRuntimeAgentResolvedModalityAction[]): void {
  let imageActionCount = 0;
  let voiceActionCount = 0;
  for (const action of actions) {
    if (action.modality === 'image') imageActionCount += 1;
    if (action.modality === 'voice') voiceActionCount += 1;
  }
  if (imageActionCount > 1) {
    throw new Error('runtime.agent message-action projection admits at most one image action');
  }
  if (voiceActionCount > 1) {
    throw new Error('runtime.agent message-action projection admits at most one voice action');
  }
}

export function parseNimiRuntimeAgentResolvedMessageActionEnvelopeFromPayload(
  payload: unknown,
): NimiRuntimeAgentResolvedMessageActionEnvelope {
  const record = parseRecord(payload, 'agent resolved message-action projection');
  const schemaId = parseTrimmedString(record.schemaId, 'schemaId');
  if (schemaId !== NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID) {
    throw new Error(`schemaId must equal ${NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}`);
  }
  if (!record.message) {
    throw new Error('message is required');
  }
  if (!Array.isArray(record.actions)) {
    throw new Error('actions must be an array');
  }

  const message = parseResolvedMessage(record.message);
  const statusCue = Object.prototype.hasOwnProperty.call(record, 'statusCue') && record.statusCue != null
    ? parseResolvedStatusCue(record.statusCue, message.messageId)
    : null;
  const actionValues = record.actions as unknown[];
  const actions = actionValues.map((action, index) => parseResolvedModalityAction(action, index, actionValues.length));
  const actionIds = new Set<string>();
  for (const action of actions) {
    if (action.sourceMessageId !== message.messageId) {
      throw new Error(`action ${action.actionId} source message reference is inconsistent`);
    }
    if (actionIds.has(action.actionId)) {
      throw new Error(`duplicate actionId: ${action.actionId}`);
    }
    actionIds.add(action.actionId);
  }
  validatePhaseOneActionEnvelopeLimits(actions);
  return {
    schemaId: NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
    message,
    ...(statusCue ? { statusCue } : {}),
    actions,
  };
}

function requireSnakeTextField(record: Record<string, unknown>, field: string, label: string): string {
  const value = normalizeText(record[field]);
  if (!value) {
    throw new Error(`${label}.${field} is required`);
  }
  return value;
}

function canonicalizeStatusCue(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  const record = parseRecord(value, 'runtime.agent structured status_cue');
  const statusCue: Record<string, unknown> = {
    sourceMessageId: requireSnakeTextField(record, 'source_message_id', 'runtime.agent structured status_cue'),
  };
  if (Object.prototype.hasOwnProperty.call(record, 'mood')) statusCue.mood = record.mood;
  if (Object.prototype.hasOwnProperty.call(record, 'label')) statusCue.label = record.label;
  if (Object.prototype.hasOwnProperty.call(record, 'intensity')) statusCue.intensity = record.intensity;
  if (Object.prototype.hasOwnProperty.call(record, 'action_cue')) statusCue.actionCue = record.action_cue;
  return statusCue;
}

function canonicalizeAction(value: unknown, index: number): Record<string, unknown> {
  const record = parseRecord(value, `runtime.agent structured actions[${index}]`);
  const modality = requireSnakeTextField(record, 'modality', `runtime.agent structured actions[${index}]`);
  const promptPayload = parseRecord(record.prompt_payload, `runtime.agent structured actions[${index}].prompt_payload`);
  return {
    actionId: requireSnakeTextField(record, 'action_id', `runtime.agent structured actions[${index}]`),
    actionIndex: record.action_index,
    actionCount: record.action_count,
    modality,
    operation: requireSnakeTextField(record, 'operation', `runtime.agent structured actions[${index}]`),
    promptPayload: {
      kind: modality === 'image' ? 'image-prompt' : modality === 'voice' ? 'voice-prompt' : '',
      promptText: requireSnakeTextField(promptPayload, 'prompt_text', `runtime.agent structured actions[${index}].prompt_payload`),
    },
    sourceMessageId: requireSnakeTextField(record, 'source_message_id', `runtime.agent structured actions[${index}]`),
    deliveryCoupling: requireSnakeTextField(record, 'delivery_coupling', `runtime.agent structured actions[${index}]`),
  };
}

export function parseNimiRuntimeAgentStructuredMessageActionEnvelope(
  value: unknown,
): NimiRuntimeAgentResolvedMessageActionEnvelope {
  const record = parseRecord(value, 'runtime.agent structured payload');
  const message = parseRecord(record.message, 'runtime.agent structured message');
  const actions = Array.isArray(record.actions) ? record.actions : null;
  if (!actions) {
    throw new Error('runtime.agent structured actions must be an array');
  }
  const schemaId = normalizeText(record.schemaId)
    || normalizeText(record.schema_id)
    || NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID;
  if (schemaId !== NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID) {
    throw new Error(`runtime.agent structured schemaId must equal ${NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}`);
  }
  return parseNimiRuntimeAgentResolvedMessageActionEnvelopeFromPayload({
    schemaId,
    message: {
      messageId: requireSnakeTextField(message, 'message_id', 'runtime.agent structured message'),
      text: requireSnakeTextField(message, 'text', 'runtime.agent structured message'),
    },
    ...(record.status_cue == null ? {} : { statusCue: canonicalizeStatusCue(record.status_cue) }),
    actions: actions.map((action, index) => canonicalizeAction(action, index)),
  });
}

export function cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage(input: {
  readonly envelope: NimiRuntimeAgentResolvedMessageActionEnvelope;
  readonly messageId: string;
  readonly text: string;
}): NimiRuntimeAgentResolvedMessageActionEnvelope {
  const next = {
    ...input.envelope,
    message: {
      messageId: input.messageId,
      text: input.text,
    },
    ...(input.envelope.statusCue
      ? { statusCue: { ...input.envelope.statusCue, sourceMessageId: input.messageId } }
      : {}),
    actions: input.envelope.actions.map((action) => ({
      ...action,
      sourceMessageId: input.messageId,
    })),
  };
  return parseNimiRuntimeAgentResolvedMessageActionEnvelopeFromPayload(next);
}

export function buildNimiRuntimeAgentResolvedOutputText(
  envelope: NimiRuntimeAgentResolvedMessageActionEnvelope,
): string {
  return envelope.message.text;
}
