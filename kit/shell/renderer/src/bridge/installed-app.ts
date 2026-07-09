import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { invokeChecked } from './invoke.js';
import type { JsonObject, JsonValue } from './types.js';
import {
  assertRecord,
  parseRequiredString,
} from './types.js';

export type InstalledNimiAppLaunchBinding = {
  readonly appId: string;
  readonly appInstanceId: string;
  readonly deviceId: string;
  readonly bindingSource: 'host-owned-installed-app-bridge';
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
      get: async (scopeRef) => invokeChecked(
        NIMI_STANDARD_SHELL_COMMANDS['ai-config.get'],
        { payload: { scopeRef } },
        (value) => parseAIConfigResult(value, NIMI_STANDARD_SHELL_COMMANDS['ai-config.get'], scopeRef),
      ),
      set: async (scopeRef, config) => invokeChecked(
        NIMI_STANDARD_SHELL_COMMANDS['ai-config.set'],
        { payload: { scopeRef, config } },
        (value) => parseAIConfigResult(value, NIMI_STANDARD_SHELL_COMMANDS['ai-config.set'], scopeRef),
      ),
    },
    config: {
      get: async () => invokeChecked(
        NIMI_STANDARD_SHELL_COMMANDS['config.get'],
        {},
        (value) => parseConfigResult(value, NIMI_STANDARD_SHELL_COMMANDS['config.get']),
      ),
      set: async (config) => invokeChecked(
        NIMI_STANDARD_SHELL_COMMANDS['config.set'],
        { payload: { config } },
        (value) => parseConfigResult(value, NIMI_STANDARD_SHELL_COMMANDS['config.set']),
      ),
    },
    data: {
      resolvePath: async (relativePath) => invokeChecked(
        NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
        { payload: { relativePath } },
        (value) => parsePathResult(value, NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve']),
      ),
    },
    storage: {
      readJson: async (relativePath) => invokeChecked(
        NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
        { payload: { relativePath } },
        (value) => parseStorageJsonResult(value, NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']),
      ),
      writeJson: async (relativePath, value) => invokeChecked(
        NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
        { payload: { relativePath, value } },
        (result) => parseStorageJsonResult(result, NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']),
      ),
      removeJson: async (relativePath) => invokeChecked(
        NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'],
        { payload: { relativePath } },
        (result) => parseStorageRemoveJsonResult(result, NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson']),
      ),
    },
    localAssets: {
      resolveUrl: async (relativePath) => invokeChecked(
        NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'],
        { payload: { relativePath } },
        (value) => parseLocalAssetUrlResult(value, NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl']),
      ),
    },
  };
}

export function readInstalledNimiAppLaunchBinding(
  scope: typeof globalThis = globalThis,
): InstalledNimiAppLaunchBinding {
  const candidate = (scope as { __NIMI_ELECTRON_RUNTIME__?: { installedAppLaunchBinding?: unknown } }).__NIMI_ELECTRON_RUNTIME__?.installedAppLaunchBinding
    ?? (scope as { window?: { __NIMI_ELECTRON_RUNTIME__?: { installedAppLaunchBinding?: unknown } } }).window?.__NIMI_ELECTRON_RUNTIME__?.installedAppLaunchBinding
    ?? (scope as { __NIMI_TAURI_RUNTIME__?: { installedAppLaunchBinding?: unknown } }).__NIMI_TAURI_RUNTIME__?.installedAppLaunchBinding
    ?? (scope as { window?: { __NIMI_TAURI_RUNTIME__?: { installedAppLaunchBinding?: unknown } } }).window?.__NIMI_TAURI_RUNTIME__?.installedAppLaunchBinding;
  return parseInstalledAppLaunchBinding(candidate);
}

function parseInstalledAppLaunchBinding(value: unknown): InstalledNimiAppLaunchBinding {
  const record = assertRecord(value, 'Installed Nimi app launch binding is unavailable');
  const bindingSource = parseRequiredString(record.bindingSource, 'bindingSource', 'readInstalledNimiAppLaunchBinding');
  if (bindingSource !== 'host-owned-installed-app-bridge') {
    throw new Error('Installed Nimi app launch binding must be host-owned.');
  }
  return {
    appId: parseRequiredString(record.appId, 'appId', 'readInstalledNimiAppLaunchBinding'),
    appInstanceId: parseRequiredString(record.appInstanceId, 'appInstanceId', 'readInstalledNimiAppLaunchBinding'),
    deviceId: parseRequiredString(record.deviceId, 'deviceId', 'readInstalledNimiAppLaunchBinding'),
    bindingSource,
    launchHostId: parseRequiredString(record.launchHostId, 'launchHostId', 'readInstalledNimiAppLaunchBinding'),
    launchNonce: parseRequiredString(record.launchNonce, 'launchNonce', 'readInstalledNimiAppLaunchBinding'),
    releaseDescriptorRef: parseRequiredString(record.releaseDescriptorRef, 'releaseDescriptorRef', 'readInstalledNimiAppLaunchBinding'),
    realmBaseUrl: parseRequiredString(record.realmBaseUrl, 'realmBaseUrl', 'readInstalledNimiAppLaunchBinding'),
  };
}

function parseAIConfigResult(value: unknown, command: string, expectedScopeRef: string): JsonObject {
  const record = assertRecord(value, `${command} returned invalid payload`);
  const scopeRef = parseRequiredString(record.scopeRef, 'scopeRef', command);
  if (scopeRef !== expectedScopeRef) {
    throw new Error(`${command} returned AI config for unexpected scopeRef`);
  }
  return assertRecord(record.config, `${command} config payload is invalid`);
}

function parseConfigResult(value: unknown, command: string): JsonObject {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return assertRecord(record.config, `${command} config payload is invalid`);
}

function parsePathResult(value: unknown, command: string): string {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return parseRequiredString(record.path, 'path', command);
}

function parseStorageJsonResult(value: unknown, command: string): JsonValue {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return record.value;
}

function parseStorageRemoveJsonResult(value: unknown, command: string): InstalledNimiAppStorageRemoveJsonResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return {
    path: parseRequiredString(record.path, 'path', command),
    removed: Boolean(record.removed),
  };
}

function parseLocalAssetUrlResult(value: unknown, command: string): string {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return parseRequiredString(record.url, 'url', command);
}
