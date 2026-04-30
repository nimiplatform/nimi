import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { suspendCreateImageBitmapForTauriVrmLoad } from './vrm-tauri-quirks.js';

type CreateImageBitmapFn = typeof globalThis.createImageBitmap;

describe('suspendCreateImageBitmapForTauriVrmLoad', () => {
  let original: CreateImageBitmapFn | undefined;
  let stub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    original = (window as unknown as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap;
    stub = vi.fn(() => Promise.resolve('original-result' as unknown as ImageBitmap));
    (window as unknown as { createImageBitmap: CreateImageBitmapFn }).createImageBitmap =
      stub as unknown as CreateImageBitmapFn;
  });

  afterEach(() => {
    if (original === undefined) {
      delete (window as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap;
    } else {
      (window as unknown as { createImageBitmap: CreateImageBitmapFn }).createImageBitmap = original;
    }
  });

  it('replaces createImageBitmap with a throwing stub while suspended', () => {
    const restore = suspendCreateImageBitmapForTauriVrmLoad();
    const replacement = (window as unknown as { createImageBitmap: CreateImageBitmapFn })
      .createImageBitmap;
    expect(replacement).not.toBe(stub);
    expect(() => replacement(undefined as unknown as ImageBitmapSource)).toThrow(
      /createImageBitmap is suspended/,
    );
    restore();
  });

  it('restores the original reference after restore()', () => {
    const restore = suspendCreateImageBitmapForTauriVrmLoad();
    restore();
    expect(
      (window as unknown as { createImageBitmap: CreateImageBitmapFn }).createImageBitmap,
    ).toBe(stub);
  });

  it('restore is idempotent — calling twice is safe', () => {
    const restore = suspendCreateImageBitmapForTauriVrmLoad();
    restore();
    expect(() => restore()).not.toThrow();
    expect(
      (window as unknown as { createImageBitmap: CreateImageBitmapFn }).createImageBitmap,
    ).toBe(stub);
  });

  it('nested suspend stacks correctly — outer restore returns to original', () => {
    const r1 = suspendCreateImageBitmapForTauriVrmLoad();
    const r2 = suspendCreateImageBitmapForTauriVrmLoad();
    // While both layers are active, calling createImageBitmap throws.
    const replacement = (window as unknown as { createImageBitmap: CreateImageBitmapFn })
      .createImageBitmap;
    expect(() => replacement(undefined as unknown as ImageBitmapSource)).toThrow();
    r2();
    r1();
    expect(
      (window as unknown as { createImageBitmap: CreateImageBitmapFn }).createImageBitmap,
    ).toBe(stub);
  });

  it('restores even when window had no createImageBitmap originally', () => {
    delete (window as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap;
    const restore = suspendCreateImageBitmapForTauriVrmLoad();
    const replacement = (window as unknown as { createImageBitmap?: CreateImageBitmapFn })
      .createImageBitmap;
    expect(typeof replacement).toBe('function');
    restore();
    expect(
      (window as unknown as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap,
    ).toBeUndefined();
  });
});
