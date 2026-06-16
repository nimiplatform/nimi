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
  const originalTauriInternals = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  const originalTauriIpc = (window as unknown as { __TAURI_IPC__?: unknown }).__TAURI_IPC__;
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
    const windowWithTauri = window as unknown as {
      __TAURI_INTERNALS__?: unknown;
      __TAURI_IPC__?: unknown;
    };
    if (originalTauriInternals === undefined) {
      delete windowWithTauri.__TAURI_INTERNALS__;
    } else {
      windowWithTauri.__TAURI_INTERNALS__ = originalTauriInternals;
    }
    if (originalTauriIpc === undefined) {
      delete windowWithTauri.__TAURI_IPC__;
    } else {
      windowWithTauri.__TAURI_IPC__ = originalTauriIpc;
    }
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

  it('uses HTMLImageElement texture decode in the Tauri WebView', async () => {
    class FakeImage {
      public decoding = '';
      public src = '';
      public decode = vi.fn(async () => {});
    }

    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const createImageBitmapMock = vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    vi.stubGlobal('Image', FakeImage);

    const { loadLive2DTextureFromBytes } = await import('./carrier-visual-assets.js');
    const gl = createFakeGl();
    await loadLive2DTextureFromBytes({
      gl,
      path: '/models/ren/runtime/ren.4096/texture_00.png',
      bytes: new ArrayBuffer(8),
    });

    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      expect.any(FakeImage),
    );
  });

  it('keeps the ImageBitmap fast path outside Tauri', async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (window as unknown as { __TAURI_IPC__?: unknown }).__TAURI_IPC__;
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
});
