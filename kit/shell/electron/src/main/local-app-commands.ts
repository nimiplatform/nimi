import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  NimiElectronLocalAppHostError,
  type NimiElectronLocalAppArtifactBytes,
  type NimiElectronLocalAppHost,
  type NimiElectronLocalAppRecord,
} from './local-app-host.js';
import { NimiElectronShellHostError } from './types.js';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_USER_TEXT_LENGTH = 256 * 1024;
const FORBIDDEN_RENDERER_FIELDS = new Set([
  'endpoint', 'authorization', 'token', 'localAppPrincipalId', 'localAppRecordId',
  'trustClass', 'provenanceRevision', 'launchLease', 'bootstrap', 'processId',
  'sessionId', 'sessionProof', 'accountId', 'grantId', 'runtimeBootEpoch',
]);

const COMMAND_METHODS = new Map<string, keyof NimiElectronLocalAppHost>([
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'], 'sessionStatus'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionPosture'], 'permissionPosture'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionRequest'], 'permissionRequest'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactsReadRuntimeBytes'], 'artifactsReadRuntimeBytes'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'], 'storageReadJson'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'], 'storageWriteJson'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'], 'storageRemoveJson'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentInventory'], 'agentInventory'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentOpenConversation'], 'agentOpenConversation'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentSendTurn'], 'agentSendTurn'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentSubscribeTurn'], 'agentSubscribeTurn'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentGetConversationSnapshot'], 'agentGetConversationSnapshot'],
]);

export function isElectronLocalAppCommand(command: string): boolean {
  return COMMAND_METHODS.has(command);
}

export async function dispatchElectronLocalAppCommand(input: {
  readonly host: NimiElectronLocalAppHost | undefined;
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;
}): Promise<unknown> {
  const method = COMMAND_METHODS.get(input.command);
  if (!method) throw invalidPayload(input.command, 'unknown local-app operation');
  assertNoForbiddenAuthority(input.payload, input.command);
  const payload = validatePayload(method, input.payload, input.command);
  if (!input.host) throw carrierRequired(input.command);
  try {
    if (method === 'sessionStatus') return await input.host.sessionStatus();
    if (method === 'agentInventory') return await input.host.agentInventory();
    if (method === 'artifactsReadRuntimeBytes') {
      return projectArtifact(await input.host.artifactsReadRuntimeBytes(payload));
    }
    if (method === 'storageReadJson') return await input.host.storageReadJson(payload);
    if (method === 'storageWriteJson') return await input.host.storageWriteJson(payload);
    if (method === 'storageRemoveJson') return await input.host.storageRemoveJson(payload);
    return await input.host[method](payload);
  } catch (error) {
    if (error instanceof NimiElectronLocalAppHostError) throw mapHostError(error, input.command);
    throw new NimiElectronShellHostError({
      code: 'runtime-service-untrusted',
      message: 'Electron local-app carrier returned an untrusted failure',
      reasonCode: 'runtime-service-untrusted',
      actionHint: 'restart_fixed_runtime_service',
      details: { command: input.command },
    });
  }
}

function validatePayload(
  method: keyof NimiElectronLocalAppHost,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): NimiElectronLocalAppRecord {
  switch (method) {
    case 'sessionStatus':
    case 'agentInventory':
      assertExactKeys(payload, [], command);
      return {};
    case 'permissionPosture':
      return identifiers(payload, ['operationId', 'resourceRef'], command);
    case 'permissionRequest':
      return identifiers(payload, ['operationId', 'resourceRef', 'purpose'], command);
    case 'artifactsReadRuntimeBytes':
      return identifiers(payload, ['artifactId'], command);
    case 'storageReadJson':
    case 'storageRemoveJson':
      return storagePathPayload(payload, command);
    case 'storageWriteJson':
      assertExactKeys(payload, ['relativePath', 'value'], command);
      validateStorageJsonValue(payload.value, command);
      return { ...storagePathPayload({ relativePath: payload.relativePath }, command), value: payload.value as NimiElectronLocalAppRecord[string] };
    case 'agentOpenConversation':
      return identifiers(payload, ['agentId', 'requestedAnchorDisposition'], command);
    case 'agentSendTurn': {
      assertExactKeys(payload, ['agentId', 'conversationAnchorId', 'clientTurnId', 'userText'], command);
      const record = identifiers(
        payload,
        ['agentId', 'conversationAnchorId', 'clientTurnId'],
        command,
        new Set(),
        ['agentId', 'conversationAnchorId', 'clientTurnId', 'userText'],
      );
      const userText = requiredText(payload.userText, 'userText', command, MAX_USER_TEXT_LENGTH);
      return { ...record, userText };
    }
    case 'agentSubscribeTurn':
      return identifiers(payload, ['agentId', 'conversationAnchorId', 'cursor'], command, new Set(['cursor']));
    case 'agentGetConversationSnapshot':
      return identifiers(payload, ['agentId', 'conversationAnchorId'], command);
  }
}

function identifiers(
  payload: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  command: string,
  optional = new Set<string>(),
  exactKeys: readonly string[] = keys,
): NimiElectronLocalAppRecord {
  assertExactKeys(payload, exactKeys, command);
  const record: Record<string, string> = {};
  for (const key of keys) {
    const value = typeof payload[key] === 'string' ? payload[key] : '';
    if (optional.has(key) && value === '') {
      record[key] = '';
      continue;
    }
    record[key] = requiredText(payload[key], key, command, MAX_IDENTIFIER_LENGTH);
  }
  return record;
}

function storagePathPayload(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): NimiElectronLocalAppRecord {
  assertExactKeys(payload, ['relativePath'], command);
  const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';
  if (!isCanonicalStoragePath(relativePath)) throw invalidPayload(command, 'relativePath is invalid');
  return { relativePath };
}

function isCanonicalStoragePath(value: string): boolean {
  if (!value || value.trim() !== value || Buffer.byteLength(value, 'utf8') > 240 || !value.endsWith('.json') || value.startsWith('/') || /[\\:\0]/u.test(value)) return false;
  return value.split('/').every((segment) => {
    if (!segment || segment === '.' || segment === '..' || segment.length > 128 || segment.endsWith('.')) return false;
    const base = segment.split('.', 1)[0]?.toUpperCase() ?? '';
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base)) return false;
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment);
  });
}

function validateStorageJsonValue(value: unknown, command: string): void {
  const state = { nodes: 0, ancestors: new Set<object>() };
  const visit = (entry: unknown, depth = 0): void => {
    state.nodes += 1;
    if (depth > 32 || state.nodes > 100_000) {
      throw invalidPayload(command, 'value exceeds structural bounds');
    }
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number' && Number.isFinite(entry)) return;
    if (!entry || typeof entry !== 'object' || state.ancestors.has(entry)) {
      throw invalidPayload(command, 'value is not JSON-compatible');
    }
    state.ancestors.add(entry);
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item, depth + 1);
    } else if (Object.getPrototypeOf(entry) === Object.prototype) {
      for (const item of Object.values(entry as Record<string, unknown>)) visit(item, depth + 1);
    } else {
      throw invalidPayload(command, 'value is not JSON-compatible');
    }
    state.ancestors.delete(entry);
  };
  visit(value);
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > 256 * 1024) {
    throw invalidPayload(command, 'value exceeds the JSON document bound');
  }
}

function assertNoForbiddenAuthority(payload: Readonly<Record<string, unknown>>, command: string): void {
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_RENDERER_FIELDS.has(key)) {
      throw invalidPayload(command, `renderer authority field ${key} is forbidden`);
    }
  }
}

function assertExactKeys(payload: Readonly<Record<string, unknown>>, keys: readonly string[], command: string): void {
  if (JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify([...keys].sort())) {
    throw invalidPayload(command, `payload fields must be exactly ${keys.join(', ') || '<empty>'}`);
  }
}

function requiredText(value: unknown, field: string, command: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    throw invalidPayload(command, `${field} is invalid`);
  }
  return normalized;
}

function projectArtifact(value: NimiElectronLocalAppArtifactBytes) {
  return {
    dataBase64: Buffer.from(value.bytes).toString('base64'),
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    mimeInferred: value.mimeInferred,
  };
}

function mapHostError(error: NimiElectronLocalAppHostError, command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: standardCode(error.reasonCode),
    message: error.reasonCode,
    reasonCode: error.reasonCode,
    actionHint: actionHint(error.reasonCode),
    source: error.reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: { command, retryable: error.retryable },
  });
}

function standardCode(reasonCode: string) {
  switch (reasonCode) {
    case 'protected-carrier-required': return 'protected-carrier-required' as const;
    case 'runtime-service-unavailable': return 'runtime-service-unavailable' as const;
    case 'runtime-service-untrusted': return 'runtime-service-untrusted' as const;
    case 'runtime-service-repair-required': return 'runtime-service-repair-required' as const;
    case 'runtime-unauthenticated': return 'runtime-unauthenticated' as const;
    case 'invalid-payload': return 'invalid-payload' as const;
    case 'invalid-path': return 'invalid-path' as const;
    case 'not-found': return 'not-found' as const;
    case 'resource-exhausted': return 'resource-exhausted' as const;
    default: return 'runtime-permission-denied' as const;
  }
}

function actionHint(reasonCode: string): string {
  switch (reasonCode) {
    case 'protected-carrier-required': return 'install_verified_electron_protected_carrier';
    case 'runtime-service-unavailable': return 'start_fixed_runtime_service';
    case 'runtime-service-repair-required': return 'repair_fixed_runtime_service';
    case 'runtime-unauthenticated': return 'open_request_empty_local_app_session';
    case 'no-grant': return 'request_local_app_operation_grant';
    default: return 'refresh_local_app_runtime_projection';
  }
}

function carrierRequired(command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'protected-carrier-required',
    message: 'Electron local-app operation requires the native protected carrier',
    reasonCode: 'protected-carrier-required',
    actionHint: 'install_verified_electron_protected_carrier',
    details: { command },
  });
}

function invalidPayload(command: string, reason: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-payload',
    message: `Electron local-app payload is invalid: ${reason}`,
    reasonCode: 'invalid-payload',
    actionHint: 'send_only_declared_local_app_operation_fields',
    details: { command },
  });
}
