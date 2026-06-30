import type { Realm } from '../../realm';
import {
  createNimiDesktopLaunchedNimiAppRuntimeAccountCaller,
  type NimiDesktopLaunchedNimiAppRuntimeAccountCallerInput,
  type NimiRuntimeAccountCaller,
} from '../../runtime/account-caller';
import { createNimiError, type JsonObject, type JsonValue } from '../../types';
import {
  createRealmWithRuntimeAccountToken,
  type RuntimeAccountRealmFetch,
  type RuntimeAccountRealmRuntime,
} from './runtime-account-realm';

export type InstalledNimiAppStandardShellSurface = {
  readonly config: {
    readonly get: () => Promise<JsonObject> | JsonObject;
    readonly set: (config: JsonObject) => Promise<JsonObject> | JsonObject;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<JsonValue> | JsonValue;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<JsonValue> | JsonValue;
  };
  readonly localAssets: {
    readonly resolveUrl: (relativePath: string) => Promise<string> | string;
  };
};

export type InstalledNimiAppBootstrapInput<
  TRuntime extends RuntimeAccountRealmRuntime = RuntimeAccountRealmRuntime,
> = {
  readonly realmBaseUrl: string;
  readonly runtime: TRuntime;
  readonly launchBinding: NimiDesktopLaunchedNimiAppRuntimeAccountCallerInput;
  readonly standardShell: InstalledNimiAppStandardShellSurface;
  readonly fetchImpl?: RuntimeAccountRealmFetch;
};

export type InstalledNimiAppBootstrap<
  TRuntime extends RuntimeAccountRealmRuntime = RuntimeAccountRealmRuntime,
> = {
  readonly appId: string;
  readonly accountCaller: NimiRuntimeAccountCaller;
  readonly realm: Realm;
  readonly runtime: TRuntime;
  readonly standardShell: InstalledNimiAppStandardShellSurface;
};

export function createInstalledNimiAppBootstrap<
  TRuntime extends RuntimeAccountRealmRuntime,
>(
  input: InstalledNimiAppBootstrapInput<TRuntime>,
): InstalledNimiAppBootstrap<TRuntime> {
  assertNoRendererOwnedAuthCustody(input as Readonly<Record<string, unknown>>);
  const accountCaller = createNimiDesktopLaunchedNimiAppRuntimeAccountCaller(input.launchBinding);
  const standardShell = requireInstalledStandardShell(input.standardShell);
  return {
    appId: accountCaller.appId,
    accountCaller,
    realm: createRealmWithRuntimeAccountToken({
      baseUrl: requireText(input.realmBaseUrl, 'realmBaseUrl'),
      fetchImpl: input.fetchImpl,
      runtime: input.runtime,
      accountCaller,
    }),
    runtime: input.runtime,
    standardShell,
  };
}

function requireInstalledStandardShell(
  surface: InstalledNimiAppStandardShellSurface | undefined,
): InstalledNimiAppStandardShellSurface {
  if (
    !surface
    || typeof surface.config?.get !== 'function'
    || typeof surface.config?.set !== 'function'
    || typeof surface.storage?.readJson !== 'function'
    || typeof surface.storage?.writeJson !== 'function'
    || typeof surface.localAssets?.resolveUrl !== 'function'
  ) {
    throw createNimiError({
      message: 'Installed Nimi App bootstrap requires host-provided standard shell config, storage, and local asset surfaces.',
      reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_STANDARD_SHELL_REQUIRED',
      actionHint: 'compose_bootstrap_from_installed_app_standard_shell_host',
      source: 'sdk',
    });
  }
  return surface;
}

function assertNoRendererOwnedAuthCustody(input: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(input)) {
    const normalized = key.toLowerCase().replace(/[-_]/gu, '');
    if (
      normalized === 'authorization'
      || normalized === 'bearertoken'
      || normalized === 'accesstoken'
      || normalized === 'sessionid'
      || normalized === 'sessiontoken'
      || normalized === 'appsession'
      || normalized === 'protectedaccesstoken'
      || normalized === 'runtimeaccountmetadata'
      || normalized === 'metadata'
      || normalized === 'headers'
    ) {
      throw createNimiError({
        message: `Installed Nimi App bootstrap cannot accept renderer-owned auth custody field: ${key}.`,
        reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_HOST_METADATA_ONLY',
        actionHint: 'use_host_owned_runtime_account_and_standard_shell_surfaces',
        source: 'sdk',
        details: { field: key },
      });
    }
  }
}

function requireText(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw createNimiError({
      message: `Installed Nimi App bootstrap requires ${field}.`,
      reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_INPUT_INVALID',
      actionHint: 'provide_runtime_launch_resolution_binding',
      source: 'sdk',
      details: { field },
    });
  }
  return normalized;
}
