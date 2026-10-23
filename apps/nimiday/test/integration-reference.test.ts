import { describe, expect, it } from 'vitest';
import { integrationReferenceDocument, parseGoVersionReference, referenceFailure, referenceHandbookNote } from '../src/nimiday/domain/integration-reference.js';
import { copyFor } from '../src/nimiday/i18n/index.js';
import { dayActions } from '../src/nimiday/store/actions.js';
import { createTestDayStore as createDayStore } from './persistence-fixture.js';
import { readCollection } from './persistence-fixture.js';
import type { JsonDocumentStore } from '../src/nimiday/store/json-documents.js';

const go = { integrationId: 'nimi.go.deliverables', operation: 'deliverable.read', displayName: 'NimiGo 成果' };
const reference = { workId: 'work-one', deliverableId: 'document-one', revisionId: 'revision-one' };
// The four-field response published by Go's deliverable.read operation.
const response = { title: '周末安排说明', content: '# 周末安排\n\n请先确认参与者，再决定地点。\n\n- 已确认：只联系指定对象\n- 待确认：时间', revisionId: 'revision-one', createdAt: '2026-09-25T18:00:00.000Z' };

describe('Integration reference documents', () => {
  it.each(['zh', 'en'] as const)('keeps actionable %s validation visible and technical failures separate', (language) => {
    const copy = copyFor(language).references;
    for (const [run, message] of [
      [() => parseGoVersionReference('invalid', copy), copy.invalidReference],
      [() => referenceHandbookNote({ title: 'x'.repeat(121), content: 'text' }, 'Go', copy), copy.titleBound],
      [() => referenceHandbookNote({ title: 'title', content: 'x'.repeat(4000) }, 'Go', copy), copy.bodyBound],
      [() => integrationReferenceDocument(go, { ...response, revisionId: 'wrong' }, reference, copy), copy.wrongVersion],
    ] as const) {
      let failure: unknown;
      try { run(); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(referenceFailure(failure, copy)).toEqual({ message });
    }
    expect(referenceFailure({ message: 'local-app-operation-unavailable', reasonCode: 'local-app-operation-unavailable' }, copy))
      .toEqual({ message: copy.readFailed, details: 'local-app-operation-unavailable' });
  });

  it('projects the requested Go version as a document and persists ordinary handbook content', async () => {
    const document = integrationReferenceDocument(go, JSON.parse(JSON.stringify(response)), reference);
    expect(document).toEqual({ title: response.title, content: response.content });
    const data = new Map<string, unknown>();
    const storage: JsonDocumentStore = {
      read: async path => data.has(path) ? structuredClone(data.get(path)) : undefined,
      write: async (path, value) => { data.set(path, structuredClone(value)); },
      remove: async path => { data.delete(path); },
    };
    const store = createDayStore(storage, { language: () => 'zh' }); await store.load();
    dayActions(store).saveNote(referenceHandbookNote(document, 'NimiGo 成果'));
    expect(await store.persist()).toEqual({ ok: true });
    const saved = await readCollection(storage, 'notes');
    expect(saved).toEqual([expect.objectContaining({ title: response.title, body: `来源：NimiGo 成果\n\n${response.content}` })]);
  });

  it('rejects incomplete or mismatched Go responses instead of falling back to JSON as a document', () => {
    expect(() => integrationReferenceDocument(go, { ...response, revisionId: 'another-version' }, reference)).toThrow('版本不一致');
    expect(() => integrationReferenceDocument(go, { title: response.title, content: { text: '正文' } }, reference)).toThrow('完整的成果标题与正文');
    expect(() => integrationReferenceDocument(go, { ...response, content: '' }, reference)).toThrow('完整的成果标题与正文');
  });

  it('keeps unrecognized structured results out of the document while preserving supported MCP text', () => {
    const source = { integrationId: 'remote.docs', operation: 'read', displayName: '公开资料' };
    expect(integrationReferenceDocument(source, { results: [{ title: '条目', data: { value: 42 } }] }, {})).toEqual({ title: '参考资料 · 公开资料', content: '' });
    expect(integrationReferenceDocument(source, { content: [{ type: 'text', text: '# 文档' }, { type: 'text', text: '正文' }] }, {})).toEqual({ title: '参考资料 · 公开资料', content: '# 文档\n正文' });
  });

  it('refuses handbook overflow before the existing note action could truncate it', () => {
    expect(() => referenceHandbookNote({ title: '标题', content: '文'.repeat(4000) }, 'NimiGo 成果')).toThrow('4000');
    expect(() => referenceHandbookNote({ title: '题'.repeat(121), content: '正文' }, 'NimiGo 成果')).toThrow('120');
    expect(referenceHandbookNote({ title: response.title, content: '用户选择保留的摘录' }, 'NimiGo 成果').body).toBe('来源：NimiGo 成果\n\n用户选择保留的摘录');
  });
  it('accepts Go clipboard hints but sends only the three exact read identifiers', () => {
    const clipboard = JSON.stringify({ ...reference, title: '已复制成果', version: 2 });
    const parsed = parseGoVersionReference(clipboard);
    expect(parsed).toEqual({ reference, title: '已复制成果', version: 2 });
    expect(Object.keys(parsed.reference).sort()).toEqual(['deliverableId', 'revisionId', 'workId']);
    expect(parseGoVersionReference(JSON.stringify(reference))).toEqual({ reference });
    // The fetched title remains authoritative over the clipboard preview.
    expect(integrationReferenceDocument(go, response, parsed.reference).title).toBe(response.title);
    expect(() => parseGoVersionReference(JSON.stringify({ ...reference, version: 0 }))).toThrow();
    expect(() => parseGoVersionReference(JSON.stringify({ workId: 'one' }))).toThrow();
  });
  it('uses the selected language for reference validation and handbook provenance', () => {
    const text = copyFor('en').references;
    expect(() => parseGoVersionReference('not-json', text)).toThrow('Go version reference');
    expect(() => integrationReferenceDocument(go, { ...response, revisionId: 'wrong' }, reference, text)).toThrow('does not match');
    expect(referenceHandbookNote({ title: 'Reading', content: 'Keep the source.' }, 'Go', text).body).toBe('Source: Go\n\nKeep the source.');
  });
});
