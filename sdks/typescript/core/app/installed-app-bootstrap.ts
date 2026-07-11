import type { Realm } from '../../realm';
import type {
  NimiDesktopLaunchedNimiAppRuntimeAccountCallerInput,
  NimiRuntimeAccountCaller,
} from '../../runtime/account-caller';
import { createNimiError, type JsonObject, type JsonValue } from '../../types';
import type { RuntimeAccountMediatedRealmRuntime } from './runtime-account-realm';

export type InstalledNimiAppStandardShellSurface = {
  readonly aiConfig: {
    readonly get: (scopeRef: string) => Promise<JsonObject> | JsonObject;
    readonly set: (scopeRef: string, config: JsonObject) => Promise<JsonObject> | JsonObject;
  };
  readonly config: {
    readonly get: () => Promise<JsonObject> | JsonObject;
    readonly set: (config: JsonObject) => Promise<JsonObject> | JsonObject;
  };
  readonly data: {
    readonly resolvePath: (relativePath: string) => Promise<string> | string;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<JsonValue> | JsonValue;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<JsonValue> | JsonValue;
    readonly removeJson: (relativePath: string) => Promise<InstalledNimiAppStorageRemoveJsonResult> | InstalledNimiAppStorageRemoveJsonResult;
  };
  readonly localAssets: {
    readonly resolveUrl: (relativePath: string) => Promise<string> | string;
  };
};

export type InstalledNimiAppStorageRemoveJsonResult = {
  readonly path: string;
  readonly removed: boolean;
};

export type InstalledNimiAppBootstrapInput<
  TRuntime extends RuntimeAccountMediatedRealmRuntime = RuntimeAccountMediatedRealmRuntime,
> = {
  readonly runtime: TRuntime;
  readonly launchBinding: NimiDesktopLaunchedNimiAppRuntimeAccountCallerInput;
  readonly standardShell: InstalledNimiAppStandardShellSurface;
};

export type InstalledNimiAppBootstrap<
  TRuntime extends RuntimeAccountMediatedRealmRuntime = RuntimeAccountMediatedRealmRuntime,
> = {
  readonly appId: string;
  readonly accountCaller: NimiRuntimeAccountCaller;
  readonly realm: Realm;
  readonly runtime: TRuntime;
  readonly standardShell: InstalledNimiAppStandardShellSurface;
};

export function createInstalledNimiAppBootstrap<
  TRuntime extends RuntimeAccountMediatedRealmRuntime,
>(
  _input: InstalledNimiAppBootstrapInput<TRuntime>,
): InstalledNimiAppBootstrap<TRuntime> {
  throw createNimiError({
    message: 'Installed Nimi App bootstrap requires the A.1 protected carrier.',
    reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_A1_CARRIER_REQUIRED',
    actionHint: 'wait_for_a1_installed_app_carrier',
    source: 'sdk',
  });
}
