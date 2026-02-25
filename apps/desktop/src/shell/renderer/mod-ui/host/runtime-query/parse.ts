import type { ActionDefinition, QueryDefinition } from './types';

export function parseQueries(extension: Record<string, unknown>): QueryDefinition[] {
  const raw = Array.isArray(extension.queries) ? extension.queries : [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const id = String(record.id || '').trim();
      const label = String(record.label || id).trim();
      const capability = String(record.capability || '').trim();
      if (!id || !capability) {
        return null;
      }
      return {
        id,
        label,
        capability,
        query:
          record.query && typeof record.query === 'object'
            ? (record.query as Record<string, unknown>)
            : {},
        autoload: Boolean(record.autoload),
      } as QueryDefinition;
    })
    .filter((item): item is QueryDefinition => item !== null);
}

export function parseActions(extension: Record<string, unknown>): ActionDefinition[] {
  const raw = Array.isArray(extension.actions) ? extension.actions : [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const id = String(record.id || '').trim();
      const label = String(record.label || id).trim();
      const type = String(record.type || '').trim();
      if (!id || !label) {
        return null;
      }

      if (type === 'set-fields') {
        const rawFields =
          record.fields && typeof record.fields === 'object'
            ? (record.fields as Record<string, unknown>)
            : null;
        if (!rawFields) {
          return null;
        }
        const fields: Record<string, string> = {};
        for (const [key, value] of Object.entries(rawFields)) {
          fields[String(key)] = String(value ?? '');
        }
        return { id, label, type: 'set-fields', fields } as ActionDefinition;
      }

      if (type === 'set-fields-from-query-selection') {
        const queryId = String(record.queryId || '').trim();
        if (!queryId) {
          return null;
        }
        const rawBindings =
          record.bindings && typeof record.bindings === 'object'
            ? (record.bindings as Record<string, unknown>)
            : {};
        const rawDefaults =
          record.defaults && typeof record.defaults === 'object'
            ? (record.defaults as Record<string, unknown>)
            : {};
        const bindings: Record<string, string> = {};
        for (const [key, value] of Object.entries(rawBindings)) {
          const normalizedKey = String(key || '').trim();
          const normalizedPath = String(value || '').trim();
          if (!normalizedKey || !normalizedPath) {
            continue;
          }
          bindings[normalizedKey] = normalizedPath;
        }
        const defaults: Record<string, string> = {};
        for (const [key, value] of Object.entries(rawDefaults)) {
          const normalizedKey = String(key || '').trim();
          if (!normalizedKey) {
            continue;
          }
          defaults[normalizedKey] = String(value ?? '');
        }
        return {
          id,
          label,
          type: 'set-fields-from-query-selection',
          queryId,
          bindings,
          defaults,
        } as ActionDefinition;
      }

      return null;
    })
    .filter((item): item is ActionDefinition => item !== null);
}
