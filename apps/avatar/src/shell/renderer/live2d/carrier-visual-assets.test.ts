import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createFakeGl() {
  return {
    TEXTURE_2D: 0x0DE1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812F,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    createTexture: vi.fn(() => ({}) as WebGLTexture),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
  } as unknown as WebGLRenderingContext;
}

describe('Live2D carrier visual texture loading', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:nimi-live2d-texture'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectURL,
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses HTMLImageElement texture decode when ImageBitmap is unavailable', async () => {
    class FakeImage {
      public decoding = '';
      public src = '';
      public decode = vi.fn(async () => {});
    }

    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('Image', FakeImage);

    const { loadLive2DTextureFromBytes } = await import('./carrier-visual-assets.js');
    const gl = createFakeGl();
    await loadLive2DTextureFromBytes({
      gl,
      path: '/models/ren/runtime/ren.4096/texture_00.png',
      bytes: new ArrayBuffer(8),
    });

    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      expect.any(FakeImage),
    );
  });

  it('keeps the ImageBitmap fast path in the Electron renderer', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const createImageBitmapMock = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const { loadLive2DTextureFromBytes } = await import('./carrier-visual-assets.js');
    const gl = createFakeGl();
    await loadLive2DTextureFromBytes({
      gl,
      path: '/models/ren/runtime/ren.4096/texture_00.png',
      bytes: new ArrayBuffer(8),
    });

    expect(createImageBitmapMock).toHaveBeenCalledOnce();
    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bitmap,
    );
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('falls back without leaking an ImageBitmap that resolves after the fast-path timeout', async () => {
    vi.useFakeTimers();
    const lateBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    let resolveBitmap!: (bitmap: ImageBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
    })));
    class FakeImage {
      public decoding = '';
      public src = '';
      public decode = vi.fn(async () => {});
    }
    vi.stubGlobal('Image', FakeImage);

    const { loadLive2DTextureFromBytes } = await import('./carrier-visual-assets.js');
    const gl = createFakeGl();
    const loading = loadLive2DTextureFromBytes({
      gl,
      path: '/models/ren/runtime/slow.png',
      bytes: new ArrayBuffer(8),
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await loading;
    resolveBitmap(lateBitmap);
    await Promise.resolve();
    await Promise.resolve();

    expect(lateBitmap.close).toHaveBeenCalledOnce();
    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      expect.any(FakeImage),
    );
  });
});
