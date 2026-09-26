import { zh, type Copy } from '../i18n/zh.js';

type ReferenceSource = { integrationId: string; operation: string; displayName: string };
export type ReferenceDocument = { title: string; content: string };
export type GoVersionReference = { reference: { workId: string; deliverableId: string; revisionId: string }; title?: string; version?: number };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Day consumes Go's published document shape, not its private storage or workflow. */
export function integrationReferenceDocument(source: ReferenceSource, value: unknown, parameters: unknown, copy: Copy['references'] = zh.references): ReferenceDocument {
  const document = object(value);
  if (source.integrationId === 'nimi.go.deliverables' && source.operation === 'deliverable.read') {
    if (!document || typeof document.title !== 'string' || !document.title.trim()
      || typeof document.content !== 'string' || !document.content.trim()
      || typeof document.revisionId !== 'string' || !document.revisionId
      || typeof document.createdAt !== 'string' || !document.createdAt) {
      throw new Error(copy.missingDocument);
    }
    if (document.revisionId !== object(parameters)?.revisionId) throw new Error(copy.wrongVersion);
    return { title: document.title, content: document.content };
  }
  const title = typeof document?.title === 'string' && document.title.trim() ? document.title : copy.defaultTitle(source.displayName);
  if (typeof value === 'string') return { title, content: value };
  if (typeof document?.content === 'string') return { title, content: document.content };
  const blocks = Array.isArray(document?.content) ? document.content : null;
  if (blocks?.length && blocks.every(block => { const item = object(block); return item?.type === 'text' && typeof item.text === 'string'; })) {
    return { title, content: blocks.map(block => object(block)!.text as string).join('\n') };
  }
  // Unknown structured results remain an advanced inspection result. They are
  // never presented or saved as a document merely because they are valid JSON.
  return { title, content: '' };
}

export function referenceHandbookNote(document: ReferenceDocument, source: string, copy: Copy['references'] = zh.references): { circleId: null; title: string; body: string } {
  const title = document.title.trim();
  if (!title || title.length > 120) throw new Error(copy.titleBound);
  if (!document.content.trim()) throw new Error(copy.bodyRequired);
  const body = `${copy.sourceLine(source)}\n\n${document.content}`;
  if (body.length > 4000) throw new Error(copy.bodyBound);
  return { circleId: null, title, body };
}

/** Go's App-owned clipboard reference: display hints never enter the exact read operation. */
export function parseGoVersionReference(value: string, copy: Copy['references'] = zh.references): GoVersionReference {
  try {
    if (new TextEncoder().encode(value).byteLength > 4096) throw new Error();
    const row = object(JSON.parse(value));
    if (!row || Object.keys(row).some(key => !['workId', 'deliverableId', 'revisionId', 'title', 'version'].includes(key))) throw new Error();
    const id = (key: string): string => { const entry = row[key]; if (typeof entry !== 'string' || !entry.trim() || new TextEncoder().encode(entry).byteLength > 256) throw new Error(); return entry; };
    if (row.title !== undefined && (typeof row.title !== 'string' || !row.title.trim() || new TextEncoder().encode(row.title).byteLength > 256)) throw new Error();
    if (row.version !== undefined && (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1)) throw new Error();
    return { reference: { workId: id('workId'), deliverableId: id('deliverableId'), revisionId: id('revisionId') }, ...(typeof row.title === 'string' ? { title: row.title } : {}), ...(typeof row.version === 'number' ? { version: row.version } : {}) };
  } catch { throw new Error(copy.invalidReference); }
}
