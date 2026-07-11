import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { BridgeError } from './invoke.js';
import type { JsonObject, JsonValue } from './types.js';

export type InstalledNimiAppLaunchBinding = {
  readonly appId: string;
  readonly appInstanceId: string;
  readonly deviceId: string;
  readonly launchHostId: string;
  readonly launchNonce: string;
  readonly releaseDescriptorRef: string;
  readonly realmBaseUrl: string;
};

export type InstalledNimiAppStandardShellSurface = {
  readonly aiConfig: {
    readonly get: (scopeRef: string) => Promise<JsonObject>;
    readonly set: (scopeRef: string, config: JsonObject) => Promise<JsonObject>;
  };
  readonly config: {
    readonly get: () => Promise<JsonObject>;
    readonly set: (config: JsonObject) => Promise<JsonObject>;
  };
  readonly data: {
    readonly resolvePath: (relativePath: string) => Promise<string>;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<JsonValue>;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<JsonValue>;
    readonly removeJson: (relativePath: string) => Promise<InstalledNimiAppStorageRemoveJsonResult>;
  };
  readonly localAssets: {
    readonly resolveUrl: (relativePath: string) => Promise<string>;
  };
};

export type InstalledNimiAppStorageRemoveJsonResult = {
  readonly path: string;
  readonly removed: boolean;
};

export function createInstalledNimiAppStandardShellSurface(): InstalledNimiAppStandardShellSurface {
  return {
    aiConfig: {
      get: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['ai-config.get']),
      set: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']),
    },
    config: {
      get: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['config.get']),
      set: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['config.set']),
    },
    data: {
      resolvePath: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve']),
    },
    storage: {
      readJson: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']),
      writeJson: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']),
      removeJson: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson']),
    },
    localAssets: {
      resolveUrl: () => rejectInstalledAppCarrier(NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl']),
    },
  };
}

export function readInstalledNimiAppLaunchBinding(): InstalledNimiAppLaunchBinding {
  throw installedAppCarrierRequired('nimi.shell.installedApp.launchBinding');
}

function rejectInstalledAppCarrier<T>(command: string): Promise<T> {
  return Promise.reject(installedAppCarrierRequired(command));
}

function installedAppCarrierRequired(command: string): BridgeError {
  return new BridgeError(
    'Installed Nimi App standard-shell operations require explicit A.4 operation admission.',
    command,
    {
      code: 'capability-unavailable',
      reasonCode: 'renderer-installed-app-carrier-required',
      actionHint: 'wait_for_a4_installed_operation_admission',
      source: 'renderer',
      details: { command },
    },
  );
}
