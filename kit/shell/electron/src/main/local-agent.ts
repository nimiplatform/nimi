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
  const mode = normalizeText(input.mode) || 'local-developer-app';
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
  const expectedLocalAgentRef = buildElectronLocalAgentRef(ownerUserId, runtimeSourceRef);
  const localAgentRef = normalizeText(input.localAgentRef) || expectedLocalAgentRef;
  if (!isElectronLocalAgentRef(localAgentRef)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron local-agent identity localAgentRef is malformed: ${localAgentRef}`,
      reasonCode: 'electron-local-agent-ref-malformed',
      actionHint: 'provide_local_agent_ref_as_local-agent_owner_runtime-source',
      details: { command, localAgentRef },
    });
  }
  if (localAgentRef !== expectedLocalAgentRef) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron local-agent identity localAgentRef must match ownerUserId and runtimeSourceRef',
      reasonCode: 'electron-local-agent-ref-mismatch',
      actionHint: 'derive_local_agent_ref_from_identity_parts',
      details: { command, ownerUserId, runtimeSourceRef, localAgentRef },
    });
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
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
  if (mode === 'local-developer-app') {
    return {
      defaultInstanceSuffix: 'local-developer',
      defaultDeviceId: 'local-developer-device',
      modeValue: 7,
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
function buildElectronLocalAgentRef(ownerUserId: string, runtimeSourceRef: string): string {
  return `local-agent:${ownerUserId}:${runtimeSourceRef}`;
}

function isElectronLocalAgentRef(value: string): boolean {
  return value.startsWith('local-agent:') && value.split(':').length === 3;
}
