import type { NimiLocalAppAssetsClient } from './sdk-contract.js';

type Assets = Pick<NimiLocalAppAssetsClient, 'list' | 'read' | 'write' | 'remove'>;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;

/** Independent App-owned documents. Runtime owns atomic publication and the
 * account/registered-subject partition; the caller owns schema and retention.
 * There is no shared index or collection-wide cleanup of unpublished records. */
// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-030
export function createNimiAppRecordStore<T extends { readonly id: string }>(
  assets: Assets,
  prefix: string,
  parse: (value: unknown) => T,
) {
  const path = (id: string) => `${prefix}/${encodeURIComponent(id)}.json`;
  async function readPath(relativePath: string): Promise<T | null> {
    try {
      const source = await assets.read({ relativePath });
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = '';
      let bytes = 0;
      for await (const chunk of source.body) {
        bytes += chunk.byteLength;
        if (bytes > MAX_RECORD_BYTES) throw new Error('App record exceeds 16 MiB.');
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
      const record = parse(JSON.parse(text));
      if (path(record.id) !== relativePath) throw new Error('Stored record identity does not match its path.');
      return record;
    } catch (error) {
      const code = (error as { reasonCode?: string; code?: string } | null)?.reasonCode
        ?? (error as { code?: string } | null)?.code;
      // A record can be explicitly removed after a non-snapshot listing.
      if (code === 'APP_STORAGE_ENTRY_NOT_FOUND' || code === 'not-found') return null;
      throw error;
    }
  }
  return {
    read: (id: string) => readPath(path(id)),
    async list(): Promise<T[]> {
      const records: T[] = [];
      let cursor = '';
      do {
        const page = await assets.list({ prefix: `${prefix}/`, ...(cursor ? { cursor } : {}) });
        for (const asset of page.assets) {
          const record = await readPath(asset.relativePath);
          if (record) records.push(record);
        }
        cursor = page.nextCursor;
      } while (cursor);
      return records;
    },
    async write(record: T): Promise<void> {
      const normalized = parse(JSON.parse(JSON.stringify(record)));
      const body = new TextEncoder().encode(JSON.stringify(normalized));
      if (body.byteLength > MAX_RECORD_BYTES) throw new Error('App record exceeds 16 MiB.');
      await assets.write({ relativePath: path(normalized.id), mediaType: 'application/json',
        body, overwrite: true });
    },
    async remove(id: string): Promise<void> { await assets.remove(path(id)); },
  };
}
