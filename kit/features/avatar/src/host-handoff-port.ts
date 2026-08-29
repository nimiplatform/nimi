const AGENT_HANDLE_PATTERN = /^agent_ref_[A-Za-z0-9_-]{43}$/u;
const MAX_OPAQUE_REF_LENGTH = 512;

export type AvatarHostHandoffCommand = 'presence' | 'launch' | 'focus';
export type AvatarHostPresenceState = 'absent' | 'launching' | 'present' | 'focused' | 'closing';

export type AvatarHostHandoffTarget = Readonly<{
  readonly agentHandle: string;
  readonly conversationAnchorId?: string | null;
  readonly avatarInstanceId: string | null;
  readonly launchSource: string | null;
  readonly committedPresentationRef: string | null;
  readonly temporaryCustodyRef: string | null;
}>;

export type AvatarHostHandoffRequest = Readonly<{
  readonly command: AvatarHostHandoffCommand;
  readonly target: AvatarHostHandoffTarget;
}>;

export type AvatarHostHandoffResult = Readonly<{
  readonly command: AvatarHostHandoffCommand;
  readonly state: AvatarHostPresenceState;
  readonly avatarInstanceRef: string | null;
  readonly committedPresentationRef: string | null;
  readonly temporaryCustodyRef: string | null;
}>;

export type AvatarHostHandoffPort = Readonly<{
  readonly invoke: (request: AvatarHostHandoffRequest) => Promise<unknown>;
}>;

const FORBIDDEN_FIELDS = Object.freeze([
  'account', 'accountId', 'appId', 'subject', 'subjectUserId', 'ownerUserId',
  'runtimeSourceRef', 'localAgentRef', 'agentId', 'configurationRef', 'capability',
  'coverage', 'availability', 'reasonCode', 'actionHint', 'error', 'result',
  'backend', 'renderer', 'motion', 'expression', 'pose', 'lookAt', 'viseme',
  'mouth', 'audioClock', 'provider', 'model', 'storage', 'path', 'root',
] as const);

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) throw new Error(`${label} is missing field: ${key}`);
  }
}

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(record, key)) throw new Error(`${label} is missing field: ${key}`);
  }
}

function assertNoForbiddenFields(record: Record<string, unknown>, label: string): void {
  for (const field of FORBIDDEN_FIELDS) {
    if (Object.hasOwn(record, field)) throw new Error(`${label} contains forbidden field: ${field}`);
  }
}

function requiredText(value: unknown, label: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Avatar Host handoff requires ${label}`);
  }
  return value;
}

function optionalOpaqueRef(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requiredText(value, label, MAX_OPAQUE_REF_LENGTH);
}

function command(value: unknown): AvatarHostHandoffCommand {
  if (value !== 'presence' && value !== 'launch' && value !== 'focus') {
    throw new Error('Avatar Host handoff command is invalid');
  }
  return value;
}

function presenceState(value: unknown): AvatarHostPresenceState {
  if (!['absent', 'launching', 'present', 'focused', 'closing'].includes(String(value))) {
    throw new Error('Avatar Host presence state is invalid');
  }
  return value as AvatarHostPresenceState;
}

function parseTarget(value: unknown): AvatarHostHandoffTarget {
  const target = asRecord(value, 'Avatar Host handoff target');
  const targetKeys = [
    'agentHandle',
    'conversationAnchorId',
    'avatarInstanceId',
    'launchSource',
    'committedPresentationRef',
    'temporaryCustodyRef',
  ] as const;
  assertAllowedKeys(target, targetKeys, targetKeys.filter((key) => key !== 'conversationAnchorId'), 'Avatar Host handoff target');
  assertNoForbiddenFields(target, 'Avatar Host handoff target');
  const agentHandle = requiredText(target.agentHandle, 'agentHandle');
  if (!AGENT_HANDLE_PATTERN.test(agentHandle)) {
    throw new Error('Avatar Host handoff requires a canonical agentHandle');
  }
  return Object.freeze({
    agentHandle,
    conversationAnchorId: target.conversationAnchorId === undefined
      ? null
      : optionalOpaqueRef(target.conversationAnchorId, 'conversationAnchorId'),
    avatarInstanceId: optionalOpaqueRef(target.avatarInstanceId, 'avatarInstanceId'),
    launchSource: optionalOpaqueRef(target.launchSource, 'launchSource'),
    committedPresentationRef: optionalOpaqueRef(target.committedPresentationRef, 'committedPresentationRef'),
    temporaryCustodyRef: optionalOpaqueRef(target.temporaryCustodyRef, 'temporaryCustodyRef'),
  });
}

// @nimi-authority: rule.nimi.avatar.embodiment.r023
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r011
export function buildAvatarHostHandoffRequest(input: Readonly<{
  readonly command: AvatarHostHandoffCommand;
  readonly target: AvatarHostHandoffTarget;
}>): AvatarHostHandoffRequest {
  const record = asRecord(input, 'Avatar Host handoff request');
  assertExactKeys(record, ['command', 'target'], 'Avatar Host handoff request');
  assertNoForbiddenFields(record, 'Avatar Host handoff request');
  return Object.freeze({
    command: command(record.command),
    target: parseTarget(record.target),
  });
}

export function parseAvatarHostHandoffResult(
  value: unknown,
  expectedCommand: AvatarHostHandoffCommand,
): AvatarHostHandoffResult {
  const record = asRecord(value, 'Avatar Host handoff result');
  assertExactKeys(record, [
    'command',
    'state',
    'avatarInstanceRef',
    'committedPresentationRef',
    'temporaryCustodyRef',
  ], 'Avatar Host handoff result');
  assertNoForbiddenFields(record, 'Avatar Host handoff result');
  const projectedCommand = command(record.command);
  if (projectedCommand !== expectedCommand) {
    throw new Error('Avatar Host handoff result command does not match the request');
  }
  const state = presenceState(record.state);
  const avatarInstanceRef = optionalOpaqueRef(record.avatarInstanceRef, 'avatarInstanceRef');
  if ((state === 'present' || state === 'focused' || state === 'closing') && !avatarInstanceRef) {
    throw new Error('Avatar Host handoff result requires an opaque instance ref');
  }
  if (state === 'absent' && (avatarInstanceRef !== null
    || record.committedPresentationRef !== null || record.temporaryCustodyRef !== null)) {
    throw new Error('Absent Avatar Host presence cannot carry instance or custody refs');
  }
  return Object.freeze({
    command: projectedCommand,
    state,
    avatarInstanceRef,
    committedPresentationRef: optionalOpaqueRef(record.committedPresentationRef, 'committedPresentationRef'),
    temporaryCustodyRef: optionalOpaqueRef(record.temporaryCustodyRef, 'temporaryCustodyRef'),
  });
}

export async function invokeAvatarHostHandoff(
  port: AvatarHostHandoffPort,
  request: AvatarHostHandoffRequest,
): Promise<AvatarHostHandoffResult> {
  if (!port || typeof port.invoke !== 'function') {
    throw new Error('Avatar Host handoff port is unavailable');
  }
  const exactRequest = buildAvatarHostHandoffRequest(request);
  return parseAvatarHostHandoffResult(
    await port.invoke(exactRequest),
    exactRequest.command,
  );
}
