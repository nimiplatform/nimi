import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCreateImageBitmapSuspendForTests,
  installCreateImageBitmapSuspendForTauri,
  suspendCreateImageBitmapForTauriVrmLoad,
} from './vrm-tauri-quirks.js';

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
    __resetCreateImageBitmapSuspendForTests();
    delete (window as unknown as Record<string, unknown>)['__TAURI_IPC__'];
    if (original === undefined) {
      delete (window as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap;
    } else {
      (window as unknown as { createImageBitmap: CreateImageBitmapFn }).createImageBitmap = original;
    }
  });

  it('sets createImageBitmap to undefined while suspended', () => {
    const restore = suspendCreateImageBitmapForTauriVrmLoad();
    expect(
      (window as unknown as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap,
    ).toBeUndefined();
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
    // While both layers are active, GLTFLoader sees no createImageBitmap and
    // chooses its HTMLImageElement fallback.
    expect(
      (window as unknown as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap,
    ).toBeUndefined();
    r2();
    r1();
    expect(
      (window as unknown as { createImageBitmap: CreateImageBitmapFn }).createImageBitmap,
    ).toBe(stub);
  });

  it('restores even when window had no createImageBitmap originally', () => {
    delete (window as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap;
    const restore = suspendCreateImageBitmapForTauriVrmLoad();
    expect(
      (window as unknown as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap,
    ).toBeUndefined();
    restore();
    expect(
      (window as unknown as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap,
    ).toBeUndefined();
  });

  it('permanently disables createImageBitmap in Tauri runtime', () => {
    (window as unknown as Record<string, unknown>)['__TAURI_IPC__'] = {};

    installCreateImageBitmapSuspendForTauri();

    expect(
      (window as unknown as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap,
    ).toBeUndefined();
  });
});
