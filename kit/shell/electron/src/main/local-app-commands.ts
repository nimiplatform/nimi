import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  NimiElectronLocalAppHostError,
  type NimiElectronLocalAppHost,
  type NimiElectronLocalAppRecord,
} from './local-app-host.js';
import { NimiElectronShellHostError } from './types.js';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_PERMISSION_REASON_BYTES = 240;
const FORBIDDEN_RENDERER_FIELDS = new Set([
  'endpoint', 'authorization', 'token', 'localAppPrincipalId', 'localAppRecordId',
  'trustClass', 'provenanceRevision', 'launchLease', 'bootstrap', 'processId',
  'sessionId', 'sessionProof', 'accountId', 'grantId', 'runtimeBootEpoch',
]);

type RendererLocalAppHostMethod = Exclude<
  keyof NimiElectronLocalAppHost,
  'renewTechnicalSession' | 'conversationStreamNext' | 'conversationStreamClose'
>;

const ACTIVE_CONVERSATION_STREAMS = new WeakMap<NimiElectronLocalAppHost, Set<string>>();

const COMMAND_METHODS = new Map<string, RendererLocalAppHostMethod>([
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'], 'sessionStatus'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionStatus'], 'permissionStatus'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionRequest'], 'permissionRequest'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationOpen'], 'conversationOpen'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSendTurn'], 'conversationSendTurn'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationInterruptTurn'], 'conversationInterruptTurn'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSubscribe'], 'conversationSubscribe'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSnapshot'], 'conversationSnapshot'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentConfigurationSnapshot'], 'agentConfigurationSnapshot'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentUpdateConfiguration'], 'agentUpdateConfiguration'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentReadinessSnapshot'], 'agentReadinessSnapshot'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentAutonomySnapshot'], 'agentAutonomySnapshot'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentUpdateAutonomy'], 'agentUpdateAutonomy'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentPresentationSnapshot'], 'agentPresentationSnapshot'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentCommitPresentation'], 'agentCommitPresentation'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'], 'storageReadJson'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'], 'storageWriteJson'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'], 'storageRemoveJson'],
]);

export function isElectronLocalAppCommand(command: string): boolean {
  return COMMAND_METHODS.has(command);
}

export async function dispatchElectronLocalAppCommand(input: {
  readonly host: NimiElectronLocalAppHost | undefined;
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sendEvent?: (eventName: string, payload: NimiElectronLocalAppRecord) => void;
}): Promise<unknown> {
  const method = COMMAND_METHODS.get(input.command);
  if (!method) throw invalidPayload(input.command, 'unknown local-app operation');
  assertNoForbiddenAuthority(input.payload, input.command);
  const payload = validatePayload(method, input.payload, input.command);
  if (!input.host) throw carrierRequired(input.command);
  try {
    if (method === 'sessionStatus') return await input.host.sessionStatus();
    if (method === 'storageReadJson') return await input.host.storageReadJson(payload);
    if (method === 'storageWriteJson') return await input.host.storageWriteJson(payload);
    if (method === 'storageRemoveJson') return await input.host.storageRemoveJson(payload);
    if (method === 'conversationSubscribe') {
      if (payload.action === 'cancel') {
        const subscriptionId = String(payload.subscriptionId);
        activeConversationStreams(input.host).delete(subscriptionId);
        const result = await input.host.conversationStreamClose({ streamId: subscriptionId });
        return { subscriptionId, closed: result.closed };
      }
      if (!input.sendEvent) throw carrierRequired(input.command);
      const opened = await input.host.conversationSubscribe(payload);
      const subscriptionId = String(opened.streamId);
      const eventName = `local-app-conversation.${subscriptionId}`;
      activeConversationStreams(input.host).add(subscriptionId);
      const pumpTimer = setTimeout(() => {
        void pumpConversationStream(input.host!, subscriptionId, eventName, input.sendEvent!, input.command);
      }, 0);
      pumpTimer.unref?.();
      return { subscriptionId, eventName };
    }
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
  method: RendererLocalAppHostMethod,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): NimiElectronLocalAppRecord {
  switch (method) {
    case 'sessionStatus':
      assertExactKeys(payload, [], command);
      return {};
    case 'permissionStatus':
      return identifiers(payload, ['permissionId'], command);
    case 'permissionRequest':
      assertExactKeys(payload, ['permissionId', 'reason', 'requestId'], command);
      return {
        permissionId: requiredText(payload.permissionId, 'permissionId', command, MAX_IDENTIFIER_LENGTH),
        reason: requiredUtf8Text(payload.reason, 'reason', command, MAX_PERMISSION_REASON_BYTES),
        requestId: requiredText(payload.requestId, 'requestId', command, MAX_IDENTIFIER_LENGTH),
      };
    case 'conversationOpen':
      assertExactKeys(payload, ['agentHandle', 'disposition'], command);
      if (payload.disposition !== 'create-or-resume' && payload.disposition !== 'create-new') {
        throw invalidPayload(command, 'disposition is invalid');
      }
      return {
        agentHandle: requiredText(payload.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
        disposition: payload.disposition,
      };
    case 'conversationSendTurn':
      assertExactKeys(payload, ['agentHandle', 'conversationAnchorId', 'requestId', 'text'], command);
      return {
        ...identifiers(payload, ['agentHandle', 'conversationAnchorId', 'requestId'], command,
          new Set(), ['agentHandle', 'conversationAnchorId', 'requestId', 'text']),
        text: requiredUtf8Text(payload.text, 'text', command, 64 * 1024),
      };
    case 'conversationInterruptTurn':
      return identifiers(payload, ['agentHandle', 'conversationAnchorId'], command);
    case 'conversationSubscribe':
      if (payload.action === 'cancel') {
        return {
          ...identifiers(payload, ['subscriptionId'], command, new Set(), ['action', 'subscriptionId']),
          action: 'cancel',
        };
      }
      return identifiers(payload, ['agentHandle', 'conversationAnchorId'], command);
    case 'conversationSnapshot':
      return identifiers(payload, ['agentHandle', 'conversationAnchorId'], command);
    case 'agentConfigurationSnapshot':
    case 'agentReadinessSnapshot':
    case 'agentAutonomySnapshot':
    case 'agentPresentationSnapshot':
      return identifiers(payload, ['agentHandle'], command);
    case 'agentUpdateConfiguration':
      assertExactKeys(payload, ['agentHandle', 'expectedConfigurationRevision', 'routeIntents'], command);
      if (!Array.isArray(payload.routeIntents) || payload.routeIntents.length === 0) {
        throw invalidPayload(command, 'routeIntents is invalid');
      }
      assertNoForbiddenAuthorityValue(payload.routeIntents, command);
      validateStorageJsonValue(payload.routeIntents, command);
      return {
        agentHandle: requiredText(payload.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
        expectedConfigurationRevision: decimalRevision(payload.expectedConfigurationRevision, 'expectedConfigurationRevision', command, false),
        routeIntents: payload.routeIntents as NimiElectronLocalAppRecord[string],
      };
    case 'agentUpdateAutonomy':
      assertExactKeys(payload, ['agentHandle', 'expectedAutonomyRevision', 'intent'], command);
      assertNoForbiddenAuthorityValue(payload.intent, command);
      validateStorageJsonValue(payload.intent, command);
      return {
        agentHandle: requiredText(payload.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
        expectedAutonomyRevision: decimalRevision(payload.expectedAutonomyRevision, 'expectedAutonomyRevision', command, false),
        intent: payload.intent as NimiElectronLocalAppRecord[string],
      };
    case 'agentCommitPresentation':
      assertExactKeys(payload, ['agentHandle', 'expectedPresentationRevision', 'intent', 'importedAssets'], command);
      assertNoForbiddenAuthorityValue(payload.intent, command);
      assertNoForbiddenAuthorityValue(payload.importedAssets, command);
      validateStorageJsonValue(payload.intent, command);
      validateStorageJsonValue(payload.importedAssets, command);
      if (!Array.isArray(payload.importedAssets)) throw invalidPayload(command, 'importedAssets is invalid');
      return {
        agentHandle: requiredText(payload.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
        expectedPresentationRevision: decimalRevision(payload.expectedPresentationRevision, 'expectedPresentationRevision', command, true),
        intent: payload.intent as NimiElectronLocalAppRecord[string],
        importedAssets: payload.importedAssets as NimiElectronLocalAppRecord[string],
      };
    case 'storageReadJson':
    case 'storageRemoveJson':
      return storagePathPayload(payload, command);
    case 'storageWriteJson':
      assertExactKeys(payload, ['relativePath', 'value'], command);
      validateStorageJsonValue(payload.value, command);
      return { ...storagePathPayload({ relativePath: payload.relativePath }, command), value: payload.value as NimiElectronLocalAppRecord[string] };
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

function assertNoForbiddenAuthorityValue(value: unknown, command: string): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoForbiddenAuthorityValue(entry, command);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_RENDERER_FIELDS.has(key)) {
      throw invalidPayload(command, `renderer authority field ${key} is forbidden`);
    }
    assertNoForbiddenAuthorityValue(entry, command);
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

function decimalRevision(value: unknown, field: string, command: string, allowZero: boolean): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value) || (!allowZero && value === '0')) {
    throw invalidPayload(command, `${field} is invalid`);
  }
  return value;
}

function requiredUtf8Text(value: unknown, field: string, command: string, maxBytes: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw invalidPayload(command, `${field} is invalid`);
  }
  return normalized;
}

function activeConversationStreams(host: NimiElectronLocalAppHost): Set<string> {
  let streams = ACTIVE_CONVERSATION_STREAMS.get(host);
  if (!streams) {
    streams = new Set();
    ACTIVE_CONVERSATION_STREAMS.set(host, streams);
  }
  return streams;
}

async function pumpConversationStream(
  host: NimiElectronLocalAppHost,
  subscriptionId: string,
  eventName: string,
  sendEvent: (eventName: string, payload: NimiElectronLocalAppRecord) => void,
  command: string,
): Promise<void> {
  const streams = activeConversationStreams(host);
  try {
    while (streams.has(subscriptionId)) {
      const next = await host.conversationStreamNext({ streamId: subscriptionId });
      if (!streams.has(subscriptionId)) return;
      if (next.completed === true) {
        streams.delete(subscriptionId);
        sendEvent(eventName, { subscriptionId, eventType: 'completed' });
        return;
      }
      sendEvent(eventName, { subscriptionId, eventType: 'next', event: next.event ?? null });
    }
  } catch (error) {
    if (!streams.delete(subscriptionId)) return;
    const mapped = error instanceof NimiElectronLocalAppHostError
      ? mapHostError(error, command)
      : new NimiElectronShellHostError({
          code: 'runtime-service-untrusted',
          message: 'Electron local-app stream returned an untrusted failure',
          reasonCode: 'runtime-service-untrusted',
          actionHint: 'restart_fixed_runtime_service',
          details: { command },
        });
    sendEvent(eventName, {
      subscriptionId,
      eventType: 'error',
      error: {
        code: mapped.code,
        reasonCode: mapped.reasonCode,
        actionHint: mapped.actionHint,
        source: mapped.source,
        details: { command, retryable: error instanceof NimiElectronLocalAppHostError && error.retryable },
      },
    });
  } finally {
    if (!streams.has(subscriptionId)) {
      await host.conversationStreamClose({ streamId: subscriptionId }).catch(() => undefined);
    }
  }
}

function mapHostError(error: NimiElectronLocalAppHostError, command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: standardCode(error.reasonCode),
    message: error.reasonCode,
    reasonCode: error.reasonCode,
    actionHint: actionHint(error.reasonCode),
    source: error.reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: {
      command,
      retryable: error.retryable,
      ...(Object.keys(error.reasonMetadata).length > 0
        ? { reasonMetadata: error.reasonMetadata }
        : {}),
    },
  });
}

function standardCode(reasonCode: string) {
  switch (reasonCode) {
    case 'protected-carrier-required': return 'protected-carrier-required' as const;
    case 'runtime-service-unavailable': return 'runtime-service-unavailable' as const;
    case 'runtime-service-untrusted': return 'runtime-service-untrusted' as const;
    case 'runtime-service-error-unclassified': return 'runtime-service-error-unclassified' as const;
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
    case 'runtime-service-error-unclassified': return 'inspect_runtime_service_error';
    case 'runtime-service-repair-required': return 'repair_fixed_runtime_service';
    case 'runtime-unauthenticated': return 'open_request_empty_local_app_session';
    case 'permission-unavailable': return 'continue_without_optional_permission';
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
