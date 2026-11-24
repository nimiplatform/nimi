import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { extractNimiErrorFields, isJsonObject } from '@nimiplatform/sdk/types';

export type Material = { name: string; ref: string };
export type TaskDraft = { text: string; files: Material[]; requestId: string };
export const emptyDraft = (): TaskDraft => ({ text: '', files: [], requestId: crypto.randomUUID() });

export function createSessionDrafts(scope: Pick<NimiAppScope, 'client' | 'signal'>) {
  const drafts = new Map<string, TaskDraft>();
  const writes = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const key = (id: string) => 'desktop-draft-' + id + '.json';
  function put(id: string, draft: TaskDraft) {
    drafts.set(id, draft);
    for (const notify of listeners) notify();
  }
  return {
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    async load(id: string): Promise<TaskDraft> {
      const cached = drafts.get(id);
      if (cached) return cached;
      let draft = emptyDraft();
      try {
        const { value } = await scope.client.storage.readJson(key(id));
        if (!isJsonObject(value) || typeof value.text !== 'string' || typeof value.requestId !== 'string'
          || !/^[0-9a-f-]{36}$/.test(value.requestId) || !Array.isArray(value.files)) throw new Error('This saved draft is unreadable.');
        const files = value.files.map(file => {
          if (!isJsonObject(file) || typeof file.name !== 'string' || typeof file.ref !== 'string') throw new Error('Invalid attachment in saved draft.');
          return { name: file.name, ref: file.ref };
        });
        draft = { text: value.text, requestId: value.requestId, files };
      } catch (err) {
        if (!['APP_STORAGE_ENTRY_NOT_FOUND', 'not-found'].includes(extractNimiErrorFields(err).reasonCode ?? '')) throw err;
      }
      scope.signal.throwIfAborted();
      const current = drafts.get(id);
      if (current) return current;
      put(id, draft);
      return draft;
    },
    put,
    async attach(id: string, file: Material) {
      await this.load(id);
      scope.signal.throwIfAborted();
      const current = drafts.get(id)!;
      if (!current.files.some(item => item.ref === file.ref)) {
        put(id, { ...current, requestId: crypto.randomUUID(), files: [...current.files, file] });
      }
      await this.flush(id);
    },
    current(id: string) { return drafts.get(id); },
    async flush(id: string) {
      const draft = drafts.get(id);
      if (!draft) return;
      const previous = writes.get(id);
      const next = (previous ?? Promise.resolve()).catch(() => {}).then(async () => {
        scope.signal.throwIfAborted();
        if (drafts.get(id) === draft) await scope.client.storage.writeJson(key(id), { ...draft, files: draft.files.map(f => ({ ...f })) });
      });
      writes.set(id, next);
      try { await next; } finally { if (writes.get(id) === next) writes.delete(id); }
    },
  };
}
export type SessionDrafts = ReturnType<typeof createSessionDrafts>;

const stores = new WeakMap<NimiAppScope, SessionDrafts>();
export function draftsForScope(scope: NimiAppScope): SessionDrafts {
  let store = stores.get(scope);
  if (!store) { store = createSessionDrafts(scope); stores.set(scope, store); }
  return store;
}
