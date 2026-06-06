import { AccountCallerMode, type AccountCaller } from './generated/runtime/v1/account.js';

export type RuntimeAccountCallerInput = {
  appId: string;
  appInstanceId?: string;
  deviceId?: string;
  scopes?: readonly string[];
};

function normalizeRequiredText(value: string | undefined, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`Runtime account caller requires ${field}`);
  }
  return normalized;
}

function createRuntimeAccountCaller(
  input: RuntimeAccountCallerInput,
  mode: AccountCallerMode,
  defaultDeviceId: string,
): AccountCaller {
  const appId = normalizeRequiredText(input.appId, 'appId');
  const appInstanceId = normalizeRequiredText(
    input.appInstanceId === undefined ? `${appId}.local-first-party` : input.appInstanceId,
    'appInstanceId',
  );
  const deviceId = normalizeRequiredText(
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

export function createLocalFirstPartyRuntimeAccountCaller(input: RuntimeAccountCallerInput): AccountCaller {
  return createRuntimeAccountCaller(
    input,
    AccountCallerMode.LOCAL_FIRST_PARTY_APP,
    'local-first-party-device',
  );
}

export function createDesktopShellRuntimeAccountCaller(input: RuntimeAccountCallerInput): AccountCaller {
  return createRuntimeAccountCaller(
    input,
    AccountCallerMode.DESKTOP_SHELL,
    'desktop-shell',
  );
}
