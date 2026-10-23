import { invoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { CollectionPersistenceError, type PersistenceFailureKind } from './json-documents.js';
import type { DayPersistence, Maintenance } from './persistence.js';

export function createHostPersistence(): DayPersistence {
  let closed = false;
  let maintenance: Maintenance = { cleanupPending: false, recoveryRequired: false, recoveryPending: false };
  const request = async <T>(command: string, payload: Record<string, unknown> = {}): Promise<T> => {
    if (closed) throw new CollectionPersistenceError('NimiDay storage session has ended.', 'closed');
    const result = await invoke(command, payload) as {
      ok: boolean; value?: T; maintenance: Maintenance;
      error?: { kind: PersistenceFailureKind; message: string; reasonCode: string };
    };
    if (closed) throw new CollectionPersistenceError('NimiDay storage session has ended.', 'closed');
    if (!result || typeof result.ok !== 'boolean' || !result.maintenance) throw new CollectionPersistenceError('NimiDay storage returned an invalid response.', 'uncertain');
    maintenance = result.maintenance;
    if (!result.ok) throw Object.assign(new CollectionPersistenceError(result.error?.message ?? 'NimiDay storage operation failed.', result.error?.kind ?? 'uncertain'), { reasonCode: result.error?.reasonCode });
    return result.value as T;
  };
  return {
    read: path => request('nimiday.storage.read', { path }),
    write: (path, value) => request('nimiday.storage.write', { path, value }),
    remove: async () => { throw new CollectionPersistenceError('Direct document removal is not a NimiDay operation.', 'invalid-data'); },
    readCollection: name => request('nimiday.storage.readCollection', { name }),
    writeCollection: (name, records) => request('nimiday.storage.writeCollection', { name, records }),
    maintain: () => request('nimiday.storage.maintain'),
    status: () => maintenance,
    // Closing one renderer proxy never kills accepted Host work. Real scope
    // invalidation is owned by the bridge and closes the Host persistence.
    close: () => { closed = true; },
  };
}
