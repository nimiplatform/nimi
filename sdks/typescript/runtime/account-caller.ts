import { AccountCallerMode, type AccountCaller } from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';

export type NimiRuntimeAccountCaller = AccountCaller;

export type NimiRuntimeAccountCallerInput = {
  readonly appId: string;
  readonly appInstanceId?: string;
  readonly deviceId?: string;
  readonly scopes?: readonly string[];
};

export const NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID = 'desktop-electron-installed-app-host';
export const NIMI_HOST_OWNED_INSTALLED_APP_BINDING_SOURCE = 'host-owned-installed-app-bridge';

export type NimiDesktopLaunchedNimiAppRuntimeAccountCallerInput = NimiRuntimeAccountCallerInput & {
  readonly bindingSource: typeof NIMI_HOST_OWNED_INSTALLED_APP_BINDING_SOURCE;
  readonly launchHostId: string;
  readonly launchNonce: string;
  readonly releaseDescriptorRef: string;
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

export function createNimiDesktopLaunchedNimiAppRuntimeAccountCaller(
  input: NimiDesktopLaunchedNimiAppRuntimeAccountCallerInput,
): NimiRuntimeAccountCaller {
  const appId = requireText(input.appId, 'appId');
  const appInstanceId = requireInstalledBindingText(input.appInstanceId, 'appInstanceId');
  const deviceId = requireInstalledBindingText(input.deviceId, 'deviceId');
  requireHostOwnedInstalledAppBindingSource(input.bindingSource, 'bindingSource');
  const launchHostId = requireInstalledBindingText(input.launchHostId, 'launchHostId');
  requireInstalledBindingText(input.launchNonce, 'launchNonce');
  requireInstalledBindingText(input.releaseDescriptorRef, 'releaseDescriptorRef');
  if (launchHostId !== NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID) {
    throw createNimiError({
      message: `Desktop-launched installed Nimi App caller requires launchHostId ${NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID}.`,
      reasonCode: 'SDK_RUNTIME_INSTALLED_APP_CALLER_BINDING_REQUIRED',
      actionHint: 'use_runtime_open_app_launch_resolution_binding',
      source: 'sdk',
    });
  }
  return createNimiRuntimeAccountCaller(
    {
      ...input,
      appId,
      appInstanceId,
      deviceId,
      launchHostId,
      launchNonce: requireInstalledBindingText(input.launchNonce, 'launchNonce'),
      releaseDescriptorRef: requireInstalledBindingText(input.releaseDescriptorRef, 'releaseDescriptorRef'),
    },
    AccountCallerMode.DESKTOP_LAUNCHED_NIMI_APP,
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
  input: NimiRuntimeAccountCallerInput & Partial<NimiDesktopLaunchedNimiAppRuntimeAccountCallerInput>,
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
  if (mode === AccountCallerMode.DESKTOP_LAUNCHED_NIMI_APP) {
    return {
      ...caller,
      launchHostId: requireInstalledBindingText(input.launchHostId, 'launchHostId'),
      launchNonce: requireInstalledBindingText(input.launchNonce, 'launchNonce'),
      releaseDescriptorRef: requireInstalledBindingText(input.releaseDescriptorRef, 'releaseDescriptorRef'),
    } as NimiRuntimeAccountCaller;
  }
  return caller;
}

function requireHostOwnedInstalledAppBindingSource(value: unknown, field: string): void {
  const normalized = String(value || '').trim();
  if (normalized !== NIMI_HOST_OWNED_INSTALLED_APP_BINDING_SOURCE) {
    throw createNimiError({
      message: `Desktop-launched installed Nimi App caller requires ${field} ${NIMI_HOST_OWNED_INSTALLED_APP_BINDING_SOURCE}.`,
      reasonCode: 'SDK_RUNTIME_INSTALLED_APP_CALLER_BINDING_REQUIRED',
      actionHint: 'use_host_owned_installed_app_bridge_binding',
      source: 'sdk',
    });
  }
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

function requireInstalledBindingText(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw createNimiError({
      message: `Desktop-launched installed Nimi App caller requires ${field} from Runtime launch resolution.`,
      reasonCode: 'SDK_RUNTIME_INSTALLED_APP_CALLER_BINDING_REQUIRED',
      actionHint: 'use_runtime_open_app_launch_resolution_binding',
      source: 'sdk',
    });
  }
  return normalized;
}
