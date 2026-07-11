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
      get: () => rejectInstalledAppCarrier('nimi.shell.aiConfig.get'),
      set: () => rejectInstalledAppCarrier('nimi.shell.aiConfig.set'),
    },
    config: {
      get: () => rejectInstalledAppCarrier('nimi.shell.config.get'),
      set: () => rejectInstalledAppCarrier('nimi.shell.config.set'),
    },
    data: {
      resolvePath: () => rejectInstalledAppCarrier('nimi.shell.data.pathResolve'),
    },
    storage: {
      readJson: () => rejectInstalledAppCarrier('nimi.shell.storage.readJson'),
      writeJson: () => rejectInstalledAppCarrier('nimi.shell.storage.writeJson'),
      removeJson: () => rejectInstalledAppCarrier('nimi.shell.storage.removeJson'),
    },
    localAssets: {
      resolveUrl: () => rejectInstalledAppCarrier('nimi.shell.localAssets.resolveUrl'),
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
    'Installed Nimi App operations require the A.1 installed-app carrier.',
    command,
    {
      code: 'capability-unavailable',
      reasonCode: 'renderer-installed-app-carrier-required',
      actionHint: 'wait_for_a1_installed_app_carrier',
      source: 'renderer',
      details: { command },
    },
  );
}
