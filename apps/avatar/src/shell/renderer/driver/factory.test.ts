import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDriverKind } from './factory.js';

describe('resolveDriverKind', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to sdk when no explicit env is set', () => {
    vi.stubEnv('VITE_AVATAR_DRIVER', '');
    expect(resolveDriverKind()).toBe('sdk');
  });

  it('allows explicit mock fixture mode', () => {
    vi.stubEnv('VITE_AVATAR_DRIVER', 'mock');
    expect(resolveDriverKind()).toBe('mock');
  });

  it('fails closed on unsupported driver mode', () => {
    vi.stubEnv('VITE_AVATAR_DRIVER', 'legacy');
    expect(() => resolveDriverKind()).toThrow(/Unsupported VITE_AVATAR_DRIVER=legacy/);
  });
});
