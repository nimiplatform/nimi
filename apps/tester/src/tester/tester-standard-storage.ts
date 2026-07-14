import { createNimiError } from '@nimiplatform/sdk/types';
import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';

export const TESTER_STANDARD_STORAGE_UNAVAILABLE_REASON_CODE = 'TESTER_LOCAL_APP_STORAGE_UNAVAILABLE';

function storageUnavailable(operation: 'read' | 'write', relativePath: string): never {
  throw createNimiError({
    message: 'Standard app storage is not admitted by the 0K local-app carrier.',
    code: 'capability-unavailable',
    reasonCode: TESTER_STANDARD_STORAGE_UNAVAILABLE_REASON_CODE,
    actionHint: 'await_local_app_storage_operation_admission',
    retryable: false,
    source: 'sdk',
    details: { operation, relativePath },
  });
}

export async function readTesterStandardStorageJson(relativePath: string): Promise<JsonValue | undefined> {
  return storageUnavailable('read', relativePath);
}

export async function writeTesterStandardStorageJson(relativePath: string, _value: JsonValue): Promise<void> {
  storageUnavailable('write', relativePath);
}
