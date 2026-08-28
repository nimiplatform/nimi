import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { BridgeError, invokeChecked } from './invoke.js';
import { assertRecord, parseRequiredString } from './types.js';

export type AgentCenterShellAvatarBackendKind = 'live2d' | 'vrm';

export interface AgentCenterAvatarAssetImportPayload {
  readonly backendKind: AgentCenterShellAvatarBackendKind;
}

export interface AgentCenterAvatarAssetImportResult {
  readonly role: 'avatar';
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
  readonly sha256: string;
  readonly custodyRef: string;
  readonly backendKind: AgentCenterShellAvatarBackendKind;
}

export type AgentCenterBackgroundImportPayload = Readonly<Record<never, never>>;

export interface AgentCenterBackgroundImportResult {
  readonly role: 'background';
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
  readonly sha256: string;
  readonly custodyRef: string;
}

/** Host Control Plane bridge: selection plus temporary material custody only. */
export interface AgentCenterShellBridge {
  readonly pickAvatarAssetMaterial: (
    backendKind: AgentCenterShellAvatarBackendKind,
  ) => Promise<AgentCenterAvatarAssetImportResult | null>;
  readonly pickBackgroundAssetMaterial: () => Promise<AgentCenterBackgroundImportResult | null>;
}

export async function importAgentCenterAvatarAsset(
  payload: AgentCenterAvatarAssetImportPayload,
): Promise<AgentCenterAvatarAssetImportResult | null> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'];
  const canonical = exactPayload(payload, {
    backendKind: requireAvatarBackendKind(payload.backendKind, command),
  }, command);
  return invokeChecked(command, { payload: canonical }, (value) => (
    value === null ? null : parseAvatarAssetImportResult(value, command)
  ));
}

export async function importAgentCenterBackground(
  payload: AgentCenterBackgroundImportPayload = {},
): Promise<AgentCenterBackgroundImportResult | null> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'];
  const canonical = exactPayload(payload, {}, command);
  return invokeChecked(command, { payload: canonical }, (value) => (
    value === null ? null : parseBackgroundImportResult(value, command)
  ));
}

export function createAgentCenterShellBridge(): AgentCenterShellBridge {
  return {
    async pickAvatarAssetMaterial(backendKind) {
      return importAgentCenterAvatarAsset({ backendKind });
    },
    async pickBackgroundAssetMaterial() {
      return importAgentCenterBackground();
    },
  };
}

function exactPayload<T extends object>(raw: unknown, canonical: T, command: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidRendererPayload(command, 'payload must be an object');
  }
  const actualKeys = Object.keys(raw).sort();
  const expectedKeys = Object.keys(canonical).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw invalidRendererPayload(command, `payload keys must be exactly: ${expectedKeys.join(', ')}`);
  }
  return { ...canonical } as Record<string, unknown>;
}

function requireAvatarBackendKind(value: unknown, command: string): AgentCenterShellAvatarBackendKind {
  if (value !== 'live2d' && value !== 'vrm') {
    throw invalidRendererPayload(command, 'backendKind must be live2d or vrm');
  }
  return value;
}

function parseAvatarAssetImportResult(value: unknown, command: string): AgentCenterAvatarAssetImportResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  assertExactResultKeys(record, ['role', 'fileName', 'mediaType', 'content', 'sha256', 'custodyRef', 'backendKind'], command);
  if (record.role !== 'avatar') throw new Error(`${command}: role must be avatar`);
  const backendKind = requireAvatarBackendKind(record.backendKind, command);
  const mediaType = parseRequiredString(record.mediaType, 'mediaType', command);
  if ((backendKind === 'live2d' && mediaType !== 'application/zip')
    || (backendKind === 'vrm' && mediaType !== 'model/gltf-binary')) {
    throw new Error(`${command}: mediaType does not match backendKind`);
  }
  return {
    role: 'avatar',
    fileName: parseRequiredString(record.fileName, 'fileName', command),
    mediaType,
    content: parseMaterialBytes(record.content, command),
    sha256: parseSha256(record.sha256, command),
    custodyRef: parseOpaqueRef(record.custodyRef, 'custodyRef', command),
    backendKind,
  };
}

function parseBackgroundImportResult(value: unknown, command: string): AgentCenterBackgroundImportResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  assertExactResultKeys(record, ['role', 'fileName', 'mediaType', 'content', 'sha256', 'custodyRef'], command);
  if (record.role !== 'background') throw new Error(`${command}: role must be background`);
  const mediaType = parseRequiredString(record.mediaType, 'mediaType', command);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) {
    throw new Error(`${command}: mediaType is not an admitted background image type`);
  }
  return {
    role: 'background',
    fileName: parseRequiredString(record.fileName, 'fileName', command),
    mediaType,
    content: parseMaterialBytes(record.content, command),
    sha256: parseSha256(record.sha256, command),
    custodyRef: parseOpaqueRef(record.custodyRef, 'custodyRef', command),
  };
}

function parseMaterialBytes(value: unknown, command: string): Uint8Array {
  if (value instanceof Uint8Array && value.byteLength > 0) return Uint8Array.from(value);
  if (Array.isArray(value) && value.length > 0
    && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return Uint8Array.from(value as number[]);
  }
  throw new Error(`${command}: content must be non-empty bytes`);
}

function parseSha256(value: unknown, command: string): string {
  const sha256 = parseRequiredString(value, 'sha256', command);
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error(`${command}: sha256 is invalid`);
  return sha256;
}

function parseOpaqueRef(value: unknown, fieldName: string, command: string): string {
  const ref = parseRequiredString(value, fieldName, command);
  if (/^(?:file:|data:)/u.test(ref) || /^[A-Za-z]:[\\/]/u.test(ref) || ref.startsWith('/') || ref.startsWith('\\\\')) {
    throw new Error(`${command}: ${fieldName} must be an opaque managed ref`);
  }
  return ref;
}

function assertExactResultKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  command: string,
): void {
  const actual = Object.keys(record).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${command}: result keys must be exactly ${canonical.join(', ')}`);
  }
}

function invalidRendererPayload(command: string, cause: string): BridgeError {
  return new BridgeError(`${command}: ${cause}`, command, {
    code: 'invalid-payload',
    reasonCode: 'renderer-agent-center-payload-invalid',
    actionHint: 'provide_valid_agent_center_payload',
    source: 'renderer',
    details: { command, cause },
  });
}
