import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { invokeChecked } from './invoke.js';
import type { JsonObject, JsonValue } from './types.js';
import {
  assertRecord,
  parseRequiredString,
} from './types.js';

export type InstalledNimiAppStandardShellSurface = {
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
  };
  readonly localAssets: {
    readonly resolveUrl: (relativePath: string) => Promise<string>;
  };
};

export function createInstalledNimiAppStandardShellSurface(): InstalledNimiAppStandardShellSurface {
  return {
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

function parseLocalAssetUrlResult(value: unknown, command: string): string {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return parseRequiredString(record.url, 'url', command);
}
