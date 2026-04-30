import { afterEach, describe, expect, it } from 'vitest';
import type { VRM } from '@pixiv/three-vrm';

import {
  VRM_INSTANCE_CACHE_MAX_ENTRIES,
  clearVrmCache,
  getCachedVrm,
  setCachedVrm,
  vrmCacheStats,
} from './vrm-instance-cache.js';

function makeVrm(tag: string): VRM {
  return { __tag: tag } as unknown as VRM;
}

describe('vrm-instance-cache', () => {
  afterEach(() => {
    clearVrmCache();
  });

  it('get returns null for absent URLs', () => {
    expect(getCachedVrm('https://example/missing.vrm')).toBeNull();
  });

  it('round-trips a VRM through set/get', () => {
    const vrm = makeVrm('alpha');
    setCachedVrm('https://example/a.vrm', vrm);
    expect(getCachedVrm('https://example/a.vrm')).toBe(vrm);
  });

  it('clear empties the cache', () => {
    setCachedVrm('https://example/a.vrm', makeVrm('a'));
    setCachedVrm('https://example/b.vrm', makeVrm('b'));
    clearVrmCache();
    expect(vrmCacheStats()).toEqual({ size: 0, urls: [] });
  });

  it('vrmCacheStats reflects current state in insertion order', () => {
    setCachedVrm('https://example/a.vrm', makeVrm('a'));
    setCachedVrm('https://example/b.vrm', makeVrm('b'));
    expect(vrmCacheStats()).toEqual({
      size: 2,
      urls: ['https://example/a.vrm', 'https://example/b.vrm'],
    });
  });

  it(`evicts the oldest entry FIFO when adding past the cap (${VRM_INSTANCE_CACHE_MAX_ENTRIES})`, () => {
    expect(VRM_INSTANCE_CACHE_MAX_ENTRIES).toBe(4);
    setCachedVrm('u1', makeVrm('1'));
    setCachedVrm('u2', makeVrm('2'));
    setCachedVrm('u3', makeVrm('3'));
    setCachedVrm('u4', makeVrm('4'));
    expect(vrmCacheStats().size).toBe(4);
    setCachedVrm('u5', makeVrm('5'));
    const stats = vrmCacheStats();
    expect(stats.size).toBe(4);
    expect(stats.urls).toEqual(['u2', 'u3', 'u4', 'u5']);
    expect(getCachedVrm('u1')).toBeNull();
    expect(getCachedVrm('u5')).not.toBeNull();
  });

  it('overwriting an existing URL does not evict another entry', () => {
    setCachedVrm('u1', makeVrm('1'));
    setCachedVrm('u2', makeVrm('2'));
    setCachedVrm('u3', makeVrm('3'));
    setCachedVrm('u4', makeVrm('4'));
    const replacement = makeVrm('1-replaced');
    setCachedVrm('u1', replacement);
    const stats = vrmCacheStats();
    expect(stats.size).toBe(4);
    expect(stats.urls.sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(getCachedVrm('u1')).toBe(replacement);
  });
});
