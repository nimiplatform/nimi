const LIVE2D_SHADER_PATH = 'assets/js/live2d-cubism-framework-shaders/WebGL/';
const LIVE2D_SHADER_FILES = [
  'vertshadersrc.vert',
  'vertshadersrcmasked.vert',
  'vertshadersrcsetupmask.vert',
  'fragshadersrcsetupmask.frag',
  'fragshadersrcpremultipliedalpha.frag',
  'fragshadersrcmaskpremultipliedalpha.frag',
  'fragshadersrcmaskinvertedpremultipliedalpha.frag',
  'vertshadersrccopy.vert',
  'fragshadersrccopy.frag',
  'fragshadersrccolorblend.frag',
  'fragshadersrcalphablend.frag',
  'vertshadersrcblend.vert',
  'fragshadersrcpremultipliedalphablend.frag',
] as const;

export function resolveLive2DShaderRootUrl(): string {
  return new URL(LIVE2D_SHADER_PATH, globalThis.location.href).toString();
}

export async function verifyLive2DShaderAssets(): Promise<readonly string[]> {
  const shaderRoot = resolveLive2DShaderRootUrl();
  const shaderUrls = LIVE2D_SHADER_FILES.map((fileName) => new URL(fileName, shaderRoot).toString());
  await Promise.all(shaderUrls.map(async (url) => {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Failed to load Live2D shader: ${url} -> HTTP ${response.status}`);
    }
    await response.text();
  }));
  return shaderUrls;
}

async function decodeTextureBitmap(bytes: ArrayBuffer, path: string): Promise<ImageBitmap | HTMLImageElement> {
  const blob = new Blob([bytes], { type: 'image/png' });
  if (typeof createImageBitmap === 'function') {
    const bitmapAttempt = createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
    let bitmapAdopted = false;
    let timeoutId: number | null = null;
    try {
      const bitmap = await Promise.race([
        bitmapAttempt,
        new Promise<ImageBitmap>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error(`Timed out decoding Live2D texture via createImageBitmap: ${path}`));
          }, 5_000);
        }),
      ]);
      bitmapAdopted = true;
      return bitmap;
    } catch {
      void bitmapAttempt.then((lateBitmap) => {
        if (!bitmapAdopted) lateBitmap.close();
      }).catch(() => undefined);
      // Some Chromium drivers can fail or stall on blob-backed PNGs. Fall
      // through to the standards-based HTMLImageElement decode path.
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    // The final standards-based decode has no product timeout: a slow valid
    // local texture stays transient until it resolves or rejects.
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadLive2DTextureFromBytes(input: {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  path: string;
  bytes: ArrayBuffer;
}): Promise<WebGLTexture> {
  const source = await decodeTextureBitmap(input.bytes, input.path);
  const texture = input.gl.createTexture();
  if (!texture) {
    if ('close' in source) source.close();
    throw new Error(`Failed to allocate Live2D texture: ${input.path}`);
  }

  input.gl.bindTexture(input.gl.TEXTURE_2D, texture);
  input.gl.pixelStorei(input.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  input.gl.texParameteri(input.gl.TEXTURE_2D, input.gl.TEXTURE_MIN_FILTER, input.gl.LINEAR);
  input.gl.texParameteri(input.gl.TEXTURE_2D, input.gl.TEXTURE_MAG_FILTER, input.gl.LINEAR);
  input.gl.texParameteri(input.gl.TEXTURE_2D, input.gl.TEXTURE_WRAP_S, input.gl.CLAMP_TO_EDGE);
  input.gl.texParameteri(input.gl.TEXTURE_2D, input.gl.TEXTURE_WRAP_T, input.gl.CLAMP_TO_EDGE);
  input.gl.texImage2D(input.gl.TEXTURE_2D, 0, input.gl.RGBA, input.gl.RGBA, input.gl.UNSIGNED_BYTE, source);
  input.gl.bindTexture(input.gl.TEXTURE_2D, null);
  if ('close' in source) source.close();

  return texture;
}
