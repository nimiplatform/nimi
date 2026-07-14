import { NimiElectronShellHostError, type NimiElectronStandardShellHost } from './types.js';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { assertNoRendererLocalAgentCallerPayload } from './runtime.js';
import { normalizeRequiredToken, normalizeStringArray, normalizeText } from './paths.js';

export function resolveElectronLocalAgentIdentity(
  host: NimiElectronStandardShellHost | undefined,
  command: string,
): Record<string, string> {
  const input = host?.localAgentIdentity;
  if (!input) {
    throw createElectronCapabilityUnavailableError(command);
  }
  return projectElectronLocalAgentIdentity(input, command);
}

export function resolveElectronRuntimeTrustedCaller(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  appId: string,
  command: string,
): Record<string, unknown> {
  assertNoRendererLocalAgentCallerPayload(payload);
  const input = host?.runtimeTrustedCaller;
  if (!input) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const mode = normalizeText(input.mode);
  const modeSpec = runtimeTrustedCallerModeSpec(mode, command);
  const normalizedAppId = normalizeRequiredToken(appId, 'appId');
  const appInstanceId = normalizeText(input.appInstanceId) || `${normalizedAppId}.${modeSpec.defaultInstanceSuffix}`;
  const deviceId = normalizeText(input.deviceId) || modeSpec.defaultDeviceId;
  const scopes = normalizeStringArray(input.scopes ?? [], 'scopes', command);
  return {
    appId: normalizedAppId,
    appInstanceId: normalizeRequiredToken(appInstanceId, 'appInstanceId'),
    deviceId: normalizeRequiredToken(deviceId, 'deviceId'),
    mode: modeSpec.modeValue,
    scopes,
  };
}
export function projectElectronLocalAgentIdentity(
  input: NonNullable<NimiElectronStandardShellHost['localAgentIdentity']>,
  command: string,
): Record<string, string> {
  const ownerUserId = normalizeRequiredToken(input.ownerUserId, 'ownerUserId');
  const runtimeSourceRef = normalizeRequiredToken(input.runtimeSourceRef, 'runtimeSourceRef');
  const localAgentRef = normalizeRequiredToken(input.localAgentRef, 'localAgentRef');
  if (!isElectronLocalAgentRef(localAgentRef)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron local-agent identity localAgentRef is malformed: ${localAgentRef}`,
      reasonCode: 'electron-local-agent-ref-malformed',
      actionHint: 'provide_opaque_local_agent_ref',
      details: { command, localAgentRef },
    });
  }
  assertOpaqueElectronLocalAgentRef({
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    command,
  });
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
}
export function assertOpaqueElectronLocalAgentRef(input: {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly command: string;
}): void {
  const ownerUserId = normalizeRequiredToken(input.ownerUserId, 'ownerUserId');
  const runtimeSourceRef = normalizeRequiredToken(input.runtimeSourceRef, 'runtimeSourceRef');
  const localAgentRef = normalizeRequiredToken(input.localAgentRef, 'localAgentRef');
  if (localAgentRef === runtimeSourceRef) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron local-agent identity localAgentRef must not be a bare runtimeSourceRef',
      reasonCode: 'electron-local-agent-ref-bare-runtime-source',
      actionHint: 'provide_opaque_local_agent_ref',
      details: { command: input.command, ownerUserId, runtimeSourceRef, localAgentRef },
    });
  }
  if (localAgentRefContainsIdentityPart(localAgentRef, ownerUserId) && localAgentRefContainsIdentityPart(localAgentRef, runtimeSourceRef)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron local-agent identity localAgentRef must be Runtime-owned opaque identity, not owner/runtimeSource-derived',
      reasonCode: 'electron-local-agent-ref-derived-from-runtime-source',
      actionHint: 'provide_runtime_owned_opaque_local_agent_ref',
      details: { command: input.command, ownerUserId, runtimeSourceRef, localAgentRef },
    });
  }
}
function runtimeTrustedCallerModeSpec(mode: string, command: string): {
  readonly defaultInstanceSuffix: string;
  readonly defaultDeviceId: string;
  readonly modeValue: number;
} {
  if (mode === 'local-first-party-app') {
    return {
      defaultInstanceSuffix: 'local-first-party',
      defaultDeviceId: 'local-first-party-device',
      modeValue: 1,
    };
  }
  if (mode === 'desktop-shell') {
    return {
      defaultInstanceSuffix: 'local-first-party',
      defaultDeviceId: 'desktop-shell',
      modeValue: 2,
    };
  }
  throw new NimiElectronShellHostError({
    code: 'invalid-payload',
    message: `Electron Runtime trusted caller mode is invalid: ${mode}`,
    reasonCode: 'electron-runtime-trusted-caller-mode-invalid',
    actionHint: 'use_a_standard_runtime_trusted_caller_mode',
    details: { command, mode },
  });
}

function isElectronLocalAgentRef(value: string): boolean {
  return value.startsWith('local-agent:');
}

function localAgentRefContainsIdentityPart(localAgentRef: string, identityPart: string): boolean {
  const normalizedRef = localAgentRef.trim().toLowerCase();
  const normalizedPart = identityPart.trim().toLowerCase();
  return Boolean(normalizedPart) && normalizedRef.includes(normalizedPart);
}
