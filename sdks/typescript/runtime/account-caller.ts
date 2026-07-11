import { AccountCallerMode, type AccountCaller } from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';

export type NimiRuntimeAccountCaller = AccountCaller;

export type NimiSDKSharedAuthAppMode =
  | 'first-party-local-app'
  | 'developer-registered-local-app'
  | 'third-party-nimi-app'
  | 'dev-standalone'
  | 'desktop-account-ux'
  | 'binding-only-avatar';

export const NIMI_SDK_SHARED_AUTH_RUNTIME_CALLER_MODE: Readonly<Record<NimiSDKSharedAuthAppMode, AccountCallerMode | null>> = {
  'first-party-local-app': AccountCallerMode.LOCAL_FIRST_PARTY_APP,
  'developer-registered-local-app': AccountCallerMode.LOCAL_DEVELOPER_APP,
  'third-party-nimi-app': null,
  'dev-standalone': null,
  'desktop-account-ux': AccountCallerMode.DESKTOP_SHELL,
  'binding-only-avatar': AccountCallerMode.DESKTOP_LAUNCHED_AVATAR,
};

export function resolveNimiSDKSharedAuthRuntimeCallerMode(
  appMode: NimiSDKSharedAuthAppMode,
): AccountCallerMode | null {
  return NIMI_SDK_SHARED_AUTH_RUNTIME_CALLER_MODE[appMode];
}

export type NimiRuntimeAccountCallerInput = {
  readonly appId: string;
  readonly appInstanceId?: string;
  readonly deviceId?: string;
  readonly scopes?: readonly string[];
};

export function createNimiLocalFirstPartyRuntimeAccountCaller(
  input: NimiRuntimeAccountCallerInput,
): NimiRuntimeAccountCaller {
  if (input.appInstanceId === undefined || input.deviceId === undefined) {
    requireText(input.appId, 'appId');
    throw createNimiError({
      message: 'Local first-party Runtime account caller identity requires explicit app instance and device identity before Runtime registration.',
      reasonCode: 'SDK_RUNTIME_ACCOUNT_CALLER_REGISTRATION_REQUIRED',
      actionHint: 'request_runtime_account_caller_registration',
      source: 'sdk',
    });
  }
  return createNimiRuntimeAccountCaller(
    input,
    AccountCallerMode.LOCAL_FIRST_PARTY_APP,
    '',
  );
}

export function createNimiDeveloperRegisteredRuntimeAccountCaller(
  input: NimiRuntimeAccountCallerInput,
): NimiRuntimeAccountCaller {
  if (input.appInstanceId === undefined || input.deviceId === undefined) {
    requireText(input.appId, 'appId');
    throw createNimiError({
      message: 'Developer-registered Runtime account caller identity requires explicit app instance and device identity before Runtime registration.',
      reasonCode: 'SDK_RUNTIME_ACCOUNT_CALLER_REGISTRATION_REQUIRED',
      actionHint: 'request_runtime_account_caller_registration',
      source: 'sdk',
    });
  }
  return createNimiRuntimeAccountCaller(
    input,
    AccountCallerMode.LOCAL_DEVELOPER_APP,
    '',
  );
}

export function createNimiBindingOnlyAvatarRuntimeAccountCaller(
  input: NimiRuntimeAccountCallerInput,
): NimiRuntimeAccountCaller {
  if (input.appInstanceId === undefined || input.deviceId === undefined) {
    requireText(input.appId, 'appId');
    throw createNimiError({
      message: 'Binding-only Avatar Runtime account caller identity requires explicit app instance and device identity.',
      reasonCode: 'SDK_RUNTIME_ACCOUNT_CALLER_REGISTRATION_REQUIRED',
      actionHint: 'use_desktop_avatar_launch_binding',
      source: 'sdk',
    });
  }
  return createNimiRuntimeAccountCaller(
    input,
    AccountCallerMode.DESKTOP_LAUNCHED_AVATAR,
    '',
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
  const caller = {
    appId,
    appInstanceId,
    deviceId,
    mode,
    scopes: [...new Set((input.scopes || []).map((scope) => String(scope).trim()).filter(Boolean))],
  } as NimiRuntimeAccountCaller;
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
