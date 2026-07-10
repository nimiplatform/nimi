import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { NimiElectronShellHostError } from './types.js';

export type AvatarBackendKind = 'live2d' | 'vrm';
export type ValidationStatus = 'valid' | 'invalid' | 'not_checked';

export type AgentCenterScope = {
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
};

export const MAX_AVATAR_ASSET_BYTES = 524_288_000;
export const MAX_AVATAR_ASSET_FILE_BYTES = 104_857_600;
export const MAX_AVATAR_ASSET_FILE_COUNT = 2_048;
export const MAX_BACKGROUND_BYTES = 20_971_520;
export const MAX_BACKGROUND_PIXELS = 8_192;

export type AgentCenterDispatchCommand =
  typeof NIMI_STANDARD_SHELL_COMMANDS[keyof Pick<typeof NIMI_STANDARD_SHELL_COMMANDS,
    | 'agent-center.avatarAssetImport'
    | 'agent-center.avatarAssetValidate'
    | 'agent-center.avatarAssetResolvePreview'
    | 'agent-center.live2dAdapterImport'
    | 'agent-center.backgroundImport'
    | 'agent-center.backgroundGet'
    | 'agent-center.backgroundValidate'
    | 'agent-center.backgroundRemove'
    | 'agent-center.agentResourcesRemove'
    | 'agent-center.accountResourcesRemove'
  >];

export function parseElectronAgentCenterPayload(
  command: AgentCenterDispatchCommand,
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidPayload(command, 'payload must be an object');
  }
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove']) {
    return exactPayload(payload, {
      hostScope: 'account',
      accountId: parseAccountScope(payload, command),
    }, command);
  }

  const scope = parseLocalAgentScope(payload, command);
  const common = { hostScope: 'local-agent', ...scope } as const;
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']) {
    return exactPayload(payload, {
      ...common,
      sourcePath: parseRequiredPayloadText(payload.sourcePath, 'sourcePath', command),
      backendKind: parseBackendKind(payload.backendKind, command),
    }, command);
  }
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate']) {
    return exactPayload(payload, {
      ...common,
      avatarAssetRef: parseAvatarAssetRef(payload.avatarAssetRef, command),
    }, command);
  }
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview']) {
    const avatarAssetRef = parseAvatarAssetRef(payload.avatarAssetRef, command);
    const canonical: Record<string, unknown> = { ...common, avatarAssetRef };
    if (payload.backendKind !== undefined) {
      const backendKind = parseBackendKind(payload.backendKind, command);
      if (!avatarAssetRef.startsWith(`${backendKind}_`)) {
        throw invalidPayload(command, 'backendKind must match avatarAssetRef');
      }
      canonical.backendKind = backendKind;
    }
    return exactPayload(payload, canonical, command);
  }
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport']) {
    const avatarAssetRef = parseAvatarAssetRef(payload.avatarAssetRef, command);
    if (!avatarAssetRef.startsWith('live2d_')) {
      throw invalidPayload(command, 'avatarAssetRef must reference a Live2D avatar asset');
    }
    return exactPayload(payload, {
      ...common,
      avatarAssetRef,
      sourcePath: parseRequiredPayloadText(payload.sourcePath, 'sourcePath', command),
    }, command);
  }
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport']) {
    return exactPayload(payload, {
      ...common,
      sourcePath: parseRequiredPayloadText(payload.sourcePath, 'sourcePath', command),
    }, command);
  }
  if (
    command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet']
    || command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate']
    || command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove']
  ) {
    return exactPayload(payload, {
      ...common,
      backgroundAssetRef: parseBackgroundAssetRef(payload.backgroundAssetRef, command),
    }, command);
  }
  return exactPayload(payload, common, command);
}

function exactPayload(
  raw: Readonly<Record<string, unknown>>,
  canonical: Readonly<Record<string, unknown>>,
  command: string,
): Readonly<Record<string, unknown>> {
  const actualKeys = Object.keys(raw).sort();
  const expectedKeys = Object.keys(canonical).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw invalidPayload(command, `payload keys must be exactly: ${expectedKeys.join(', ')}`);
  }
  return canonical;
}

export function parseLocalAgentScope(payload: Readonly<Record<string, unknown>>, command: string): AgentCenterScope {
  const hostScope = typeof payload.hostScope === 'string' ? payload.hostScope.trim() : '';
  if (hostScope !== 'local-agent') {
    throw invalidPayload(command, 'Agent Center asset custody requires hostScope=local-agent');
  }
  const scope = {
    accountId: validateId(payload.accountId, 'accountId', command),
    ownerUserId: validateId(payload.ownerUserId, 'ownerUserId', command),
    runtimeSourceRef: validateId(payload.runtimeSourceRef, 'runtimeSourceRef', command),
    localAgentRef: validateId(payload.localAgentRef, 'localAgentRef', command),
  };
  if (!scope.localAgentRef.startsWith('local-agent:')) {
    throw invalidPayload(command, 'localAgentRef must start with local-agent:');
  }
  if (scope.localAgentRef === scope.runtimeSourceRef) {
    throw invalidPayload(command, 'localAgentRef must differ from runtimeSourceRef');
  }
  return scope;
}

export function parseAccountScope(payload: Readonly<Record<string, unknown>>, command: string): string {
  const hostScope = typeof payload.hostScope === 'string' ? payload.hostScope.trim() : '';
  if (hostScope !== 'account') {
    throw invalidPayload(command, 'Account resource cleanup requires hostScope=account');
  }
  return validateId(payload.accountId, 'accountId', command);
}

function validateId(value: unknown, field: string, command: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidPayload(command, `${field} is required`);
  }
  const normalized = value.trim();
  if (
    normalized.length > 256
    || normalized === '.'
    || normalized === '..'
    || normalized.includes('://')
    || !/[A-Za-z0-9]/u.test(normalized)
    || !/^[A-Za-z0-9_.~:@+-]+$/u.test(normalized)
  ) {
    throw invalidPayload(command, `${field} is not an admitted opaque identifier`);
  }
  return normalized;
}

export function parseBackendKind(value: unknown, command: string): AvatarBackendKind {
  const kind = parseRequiredPayloadText(value, 'backendKind', command);
  if (kind !== 'live2d' && kind !== 'vrm') {
    throw invalidPayload(command, 'backendKind must be live2d or vrm');
  }
  return kind;
}

export function parseAvatarAssetRef(value: unknown, command: string): string {
  const ref = parseRequiredPayloadText(value, 'avatarAssetRef', command);
  if (!/^(live2d|vrm)_[a-f0-9]{12}$/u.test(ref)) {
    throw invalidPayload(command, 'avatarAssetRef is invalid');
  }
  return ref;
}

export function parseBackgroundAssetRef(value: unknown, command: string): string {
  const ref = parseRequiredPayloadText(value, 'backgroundAssetRef', command);
  if (!/^bg_[a-f0-9]{12}$/u.test(ref)) {
    throw invalidPayload(command, 'backgroundAssetRef is invalid');
  }
  return ref;
}

function parseRequiredPayloadText(value: unknown, field: string, command: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidPayload(command, `${field} is required`);
  }
  return value.trim();
}

export function kindFromAvatarRef(ref: string): AvatarBackendKind {
  return ref.startsWith('live2d_') ? 'live2d' : 'vrm';
}

export function backendCapabilityProfileRefFor(kind: AvatarBackendKind, avatarAssetRef: string): string {
  return `avatar.backend_profile:${kind}:${avatarAssetRef}:import_validated`;
}

export function invalidPayload(command: string, message: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-payload',
    message,
    reasonCode: 'electron-agent-center-payload-invalid',
    actionHint: 'send_standard_agent_center_payload',
    details: { command },
  });
}

export function invalidPath(command: string, message: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-path',
    message,
    reasonCode: 'electron-agent-center-path-invalid',
    actionHint: 'repair_agent_center_managed_resource',
    details: { command },
  });
}

export function invalidAsset(command: string, message: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-payload',
    message,
    reasonCode: 'electron-agent-center-asset-invalid',
    actionHint: 'inspect_agent_center_asset_manifest',
    details: { command },
  });
}

export function notFound(command: string, message: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'not-found',
    message,
    reasonCode: 'electron-agent-center-resource-not-found',
    actionHint: 'import_or_repair_agent_center_resource',
    details: { command },
  });
}
