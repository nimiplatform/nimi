import type { NimiElectronAppBusinessServices, NimiElectronCommandHandler } from '@nimiplatform/kit/shell/electron/main';
import { CollectionPersistenceError, documentPath, persistenceReason, runtimeDocumentStore } from '../src/nimiday/store/json-documents.js';
import { COLLECTION_NAMES, type CollectionName } from '../src/nimiday/store/collection-layout.js';
import { createDayPersistence, type DayPersistence } from '../src/nimiday/store/persistence.js';

const DOCUMENTS = new Set(['profile', 'circles', 'rhythms', 'skills'].map(documentPath));

export function createDayStorageHost() {
  let services: NimiElectronAppBusinessServices | undefined;
  let persistence: DayPersistence | undefined;
  const current = () => {
    if (!persistence) throw new CollectionPersistenceError('NimiDay storage session is not ready.', 'closed');
    return persistence;
  };
  const name = (value: unknown): CollectionName => {
    if (typeof value !== 'string' || !COLLECTION_NAMES.includes(value as CollectionName)) throw new CollectionPersistenceError('Unknown NimiDay collection.', 'invalid-data');
    return value as CollectionName;
  };
  const path = (value: unknown): string => {
    if (typeof value !== 'string' || !DOCUMENTS.has(value)) throw new CollectionPersistenceError('Unknown NimiDay document.', 'invalid-data');
    return value;
  };
  const operation = (run: (owner: DayPersistence, payload: Record<string, unknown>) => Promise<unknown>): NimiElectronCommandHandler => async ({ payload }) => {
    const owner = current();
    try { return { ok: true, value: await run(owner, payload), maintenance: owner.status() }; }
    catch (error) {
      const reason = persistenceReason(error);
      const kind = error instanceof CollectionPersistenceError ? error.kind
        : ['APP_STORAGE_QUOTA_EXCEEDED', 'RESOURCE_EXHAUSTED'].includes(reason) ? 'capacity'
          : ['INVALID_PATH', 'INVALID_PAYLOAD', 'APP_STORAGE_PATH_INVALID', 'PROTOCOL_ENVELOPE_INVALID'].includes(reason) ? 'invalid-data' : 'temporary';
      return { ok: false, error: { kind, message: error instanceof Error ? error.message : 'NimiDay storage operation failed.', reasonCode: reason }, maintenance: owner.status() };
    }
  };
  const handlers: Record<string, NimiElectronCommandHandler> = {
    'nimiday.storage.read': operation((owner, payload) => owner.read(path(payload.path))),
    'nimiday.storage.write': operation((owner, payload) => owner.write(path(payload.path), payload.value)),
    'nimiday.storage.readCollection': operation((owner, payload) => owner.readCollection(name(payload.name))),
    'nimiday.storage.writeCollection': operation((owner, payload) => {
      if (!Array.isArray(payload.records)) throw new CollectionPersistenceError('NimiDay collection must be an array.', 'invalid-data');
      return owner.writeCollection(name(payload.name), payload.records);
    }),
    'nimiday.storage.maintain': operation(owner => owner.maintain()),
  };
  return {
    handlers,
    readCollection: async (collection: CollectionName) => (await current().readCollection(collection)).records,
    bind: (value: NimiElectronAppBusinessServices) => {
      // Routine ready notifications reuse the same business scope. Only an
      // actual invalidation creates a fresh recovery/writer lifetime.
      if (persistence) {
        if (services !== value) throw new Error('NimiDay storage must be invalidated before a different business scope is bound.');
        return;
      }
      services = value;
      persistence = createDayPersistence(runtimeDocumentStore(value.storage));
    },
    invalidate: () => { persistence?.close(); persistence = undefined; services = undefined; },
  };
}
