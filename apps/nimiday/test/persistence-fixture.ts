import { createDayStore } from '../src/nimiday/store/day-store.js';
import { createDayPersistence } from '../src/nimiday/store/persistence.js';
import type { CollectionName } from '../src/nimiday/store/collection-layout.js';
import type { JsonDocumentStore } from '../src/nimiday/store/json-documents.js';

// Controller tests use the actual Host persistence implementation with their
// in-memory document adapter. This is not a product acceptance substitute.
export function createTestDayStore(documents: JsonDocumentStore, options: Parameters<typeof createDayStore>[1]) {
  return createDayStore(createDayPersistence(documents), options);
}
export async function readCollection(documents: JsonDocumentStore, name: CollectionName) {
  const owner = createDayPersistence(documents);
  try { return (await owner.readCollection(name)).records; } finally { owner.close(); }
}
export async function writeCollection(documents: JsonDocumentStore, name: CollectionName, records: readonly unknown[]) {
  const owner = createDayPersistence(documents);
  try { return await owner.writeCollection(name, records); } finally { owner.close(); }
}
