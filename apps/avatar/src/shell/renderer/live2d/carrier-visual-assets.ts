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

export async function loadLive2DTextureFromBytes(input: {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  path: string;
  bytes: ArrayBuffer;
}): Promise<WebGLTexture> {
  const bitmap = await createImageBitmap(new Blob([input.bytes], { type: 'image/png' }), {
    premultiplyAlpha: 'premultiply',
  });
  const texture = input.gl.createTexture();
  if (!texture) {
    bitmap.close();
    throw new Error(`Failed to allocate Live2D texture: ${input.path}`);
  }

  input.gl.bindTexture(input.gl.TEXTURE_2D, texture);
  input.gl.pixelStorei(input.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  input.gl.texParameteri(input.gl.TEXTURE_2D, input.gl.TEXTURE_MIN_FILTER, input.gl.LINEAR);
  input.gl.texParameteri(input.gl.TEXTURE_2D, input.gl.TEXTURE_MAG_FILTER, input.gl.LINEAR);
  input.gl.texParameteri(input.gl.TEXTURE_2D, input.gl.TEXTURE_WRAP_S, input.gl.CLAMP_TO_EDGE);
  input.gl.texParameteri(input.gl.TEXTURE_2D, input.gl.TEXTURE_WRAP_T, input.gl.CLAMP_TO_EDGE);
  input.gl.texImage2D(input.gl.TEXTURE_2D, 0, input.gl.RGBA, input.gl.RGBA, input.gl.UNSIGNED_BYTE, bitmap);
  input.gl.bindTexture(input.gl.TEXTURE_2D, null);
  bitmap.close();

  return texture;
}
