import {
  createInstalledNimiAppStandardShellSurface,
  extractShellBridgeErrorCode,
  toShellBridgeNimiError,
  type JsonValue,
} from '@nimiplatform/kit/shell/renderer/bridge';

const standardShellSurface = createInstalledNimiAppStandardShellSurface();

/**
 * Standard-storage `not-found` reason code emitted by the kit shell hosts when a
 * relative JSON path has never been written. Callers translate this into an
 * app-owned default (empty history) instead of surfacing a hard failure.
 */
const STORAGE_NOT_FOUND_CODE = 'not-found';

export async function readTesterStandardStorageJson(relativePath: string): Promise<JsonValue | undefined> {
  try {
    return await standardShellSurface.storage.readJson(relativePath);
  } catch (error) {
    const normalized = toShellBridgeNimiError(error);
    if (
      normalized.code === STORAGE_NOT_FOUND_CODE
      || extractShellBridgeErrorCode(normalized.message) === STORAGE_NOT_FOUND_CODE
    ) {
      return undefined;
    }
    throw normalized;
  }
}

export async function writeTesterStandardStorageJson(relativePath: string, value: JsonValue): Promise<void> {
  await standardShellSurface.storage.writeJson(relativePath, value);
}
