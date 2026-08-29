import { AccountCallerMode, type AccountCaller } from '../core-generated/runtime-typed-client.js';
import { createNimiError } from '../types/index.js';

export type NimiRuntimeAccountCaller = AccountCaller;

export type NimiSDKRuntimeAccountCallerProfile =
  | 'local-app'
  | 'third-party-nimi-app'
  | 'dev-standalone'
  | 'desktop-account-ux';

export const NIMI_SDK_RUNTIME_ACCOUNT_CALLER_PROFILE_MODE: Readonly<Record<NimiSDKRuntimeAccountCallerProfile, AccountCallerMode | null>> = {
  // LOCAL_APP identity is inherited from the verified native carrier. It is
  // deliberately not constructible as an AccountCaller in SDK/app code.
  'local-app': null,
  'third-party-nimi-app': null,
  'dev-standalone': null,
  'desktop-account-ux': AccountCallerMode.DESKTOP_SHELL,
};

export function resolveNimiSDKRuntimeAccountCallerProfile(
  callerProfile: NimiSDKRuntimeAccountCallerProfile,
): AccountCallerMode | null {
  return NIMI_SDK_RUNTIME_ACCOUNT_CALLER_PROFILE_MODE[callerProfile];
}

export type NimiRuntimeAccountCallerInput = {
  readonly appId: string;
  readonly appInstanceId?: string;
  readonly deviceId?: string;
  readonly scopes?: readonly string[];
};

export function createNimiDesktopShellRuntimeAccountCaller(
  input: NimiRuntimeAccountCallerInput,
): NimiRuntimeAccountCaller {
  return createNimiRuntimeAccountCaller(
    input,
    AccountCallerMode.DESKTOP_SHELL,
    'desktop-shell',
	'desktop-shell',
  );
}

function createNimiRuntimeAccountCaller(
  input: NimiRuntimeAccountCallerInput,
  mode: AccountCallerMode,
  defaultDeviceId: string,
	defaultInstanceSuffix: string,
): NimiRuntimeAccountCaller {
  const appId = requireText(input.appId, 'appId');
  const appInstanceId = requireText(
	input.appInstanceId === undefined ? `${appId}.${defaultInstanceSuffix}` : input.appInstanceId,
    'appInstanceId',
  );
  const deviceId = requireText(
    input.deviceId === undefined ? defaultDeviceId : input.deviceId,
    'deviceId',
  );
  const caller = {
    appId,
    appInstanceId,
    deviceId,
    mode,
    scopes: [...new Set((input.scopes || []).map((scope) => String(scope).trim()).filter(Boolean))],
    launchHostId: '',
    launchNonce: '',
    releaseDescriptorRef: '',
  };
  return caller;
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
