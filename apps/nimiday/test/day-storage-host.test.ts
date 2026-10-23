import { describe, expect, it } from 'vitest';
import { createDayStorageHost } from '../src-electron/day-storage-host.js';

function nativeServices() {
  const data = new Map<string, unknown>(); let failure = ''; let attempts = 0;
  const services = { storage: {
    readJson: async (path: string) => {
      if (!data.has(path)) throw { reasonCode: 'not-found' };
      return { value: structuredClone(data.get(path)) };
    },
    writeJson: async (path: string, value: unknown) => {
      attempts++;
      if (failure) throw Object.assign(new Error(failure), { reasonCode: failure });
      data.set(path, structuredClone(value));
    },
    removeJson: async (path: string) => { data.delete(path); },
  } };
  return { services, refuse: (reason: string) => { failure = reason; }, attempts: () => attempts };
}

describe('NimiDay Host storage boundary', () => {
  it('returns the actual carrier quota reason as capacity and rejects arbitrary document paths', async () => {
    const native = nativeServices(); const host = createDayStorageHost(); host.bind(native.services as never);
    native.refuse('resource-exhausted');
    const write = host.handlers['nimiday.storage.write']!;
    expect(await write({ payload: { path: 'nimiday/v1/profile.json', value: {} } } as never)).toMatchObject({ ok: false, error: { kind: 'capacity', reasonCode: 'RESOURCE_EXHAUSTED' }, maintenance: { recoveryRequired: false } });
    const attempts = native.attempts();
    expect(await write({ payload: { path: 'another-app/value.json', value: {} } } as never)).toMatchObject({ ok: false, error: { kind: 'invalid-data' } });
    expect(native.attempts()).toBe(attempts); host.invalidate();
  });

  it('does not turn another ready notification or services object into an ambiguous-write barrier', async () => {
    const native = nativeServices(); const host = createDayStorageHost(); host.bind(native.services as never);
    native.refuse('runtime-service-unavailable');
    const write = host.handlers['nimiday.storage.write']!;
    const input = { payload: { path: 'nimiday/v1/profile.json', value: {} } } as never;
    expect(await write(input)).toMatchObject({ ok: false, error: { kind: 'uncertain' } });
    const attempts = native.attempts();
    host.bind(native.services as never);
    native.refuse('');
    expect(await write(input)).toMatchObject({ ok: false, error: { kind: 'uncertain' } });
    expect(native.attempts()).toBe(attempts);
    expect(() => host.bind({ ...native.services } as never)).toThrow('must be invalidated');
    host.invalidate(); host.bind({ ...native.services } as never);
    expect(await write(input)).toMatchObject({ ok: true });
    host.invalidate();
  });
});
