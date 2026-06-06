import { AccountCallerMode, type AccountCaller } from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';

export type NimiRuntimeAccountCaller = AccountCaller;

export type NimiRuntimeAccountCallerInput = {
  readonly appId: string;
  readonly appInstanceId?: string;
  readonly deviceId?: string;
  readonly scopes?: readonly string[];
};

export function createNimiLocalFirstPartyRuntimeAccountCaller(
  input: NimiRuntimeAccountCallerInput,
): NimiRuntimeAccountCaller {
  return createNimiRuntimeAccountCaller(
    input,
    AccountCallerMode.LOCAL_FIRST_PARTY_APP,
    'local-first-party-device',
  );
}

export function createNimiDesktopShellRuntimeAccountCaller(
  input: NimiRuntimeAccountCallerInput,
): NimiRuntimeAccountCaller {
  return createNimiRuntimeAccountCaller(
    input,
    AccountCallerMode.DESKTOP_SHELL,
    'desktop-shell',
  );
}

function createNimiRuntimeAccountCaller(
  input: NimiRuntimeAccountCallerInput,
  mode: AccountCallerMode,
  defaultDeviceId: string,
): NimiRuntimeAccountCaller {
  const appId = requireText(input.appId, 'appId');
  const appInstanceId = requireText(
    input.appInstanceId === undefined ? `${appId}.local-first-party` : input.appInstanceId,
    'appInstanceId',
  );
  const deviceId = requireText(
    input.deviceId === undefined ? defaultDeviceId : input.deviceId,
    'deviceId',
  );
  return {
    appId,
    appInstanceId,
    deviceId,
    mode,
    scopes: [...new Set((input.scopes || []).map((scope) => String(scope).trim()).filter(Boolean))],
  };
}

function requireText(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw createNimiError({
      message: `Runtime account caller requires ${field}`,
      reasonCode: 'SDK_RUNTIME_ACCOUNT_CALLER_INVALID',
      actionHint: 'provide_runtime_account_caller_identity',
      source: 'sdk',
    });
  }
  return normalized;
}
