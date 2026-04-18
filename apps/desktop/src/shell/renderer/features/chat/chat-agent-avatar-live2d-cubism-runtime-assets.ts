const PRESERVE_LIVE2D_URL_PATTERN = /^(blob:|asset:|file:|https?:|data:|live2d-memory:)/i;
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

export function describeLive2dRuntimeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'Live2D Cubism runtime failed to initialize';
}

function decodeBase64Bytes(base64: string): Uint8Array {
  const runtimeGlobal = globalThis as typeof globalThis & {
    atob?: (value: string) => string;
    Buffer?: {
      from: (value: string, encoding: string) => {
        toString: (targetEncoding: string) => string;
      };
    };
  };
  if (typeof runtimeGlobal.atob === 'function') {
    const binary = runtimeGlobal.atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  if (runtimeGlobal.Buffer) {
    const binary = runtimeGlobal.Buffer.from(base64, 'base64').toString('binary');
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  throw new Error('Live2D asset payload cannot be decoded');
}

export function arrayBufferFromBase64(base64: string): ArrayBuffer {
  const bytes = decodeBase64Bytes(base64);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function toLive2dAssetLoadError(input: {
  label: string;
  url: string;
  cause?: unknown;
  status?: number | null;
}): Error & { url?: string; status?: number } {
  const error = new Error(`${input.label}: ${input.url} (${describeLive2dRuntimeError(input.cause)})`) as Error & {
    url?: string;
    status?: number;
  };
  error.url = input.url;
  if (typeof input.status === 'number') {
    error.status = input.status;
  }
  return error;
}

export async function fetchArrayBufferFromUrl(url: string): Promise<ArrayBuffer> {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      throw toLive2dAssetLoadError({
        label: 'Failed to load Live2D asset',
        url,
        status: response.status,
        cause: new Error(`HTTP ${response.status}`),
      });
    }
    return response.arrayBuffer();
  } catch (error) {
    if (typeof (error as { url?: string } | null | undefined)?.url === 'string') {
      throw error;
    }
    throw toLive2dAssetLoadError({
      label: 'Failed to load Live2D asset',
      url,
      cause: error,
    });
  }
}

export function resolveLive2dAssetUrl(baseUrl: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (PRESERVE_LIVE2D_URL_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return new URL(trimmed, baseUrl).toString();
}

export function resolveLive2dShaderUrl(): string {
  return new URL(LIVE2D_SHADER_PATH, globalThis.location.href).toString();
}

export async function verifyLive2dShaderAssets(): Promise<readonly string[]> {
  const shaderRoot = resolveLive2dShaderUrl();
  const shaderUrls = LIVE2D_SHADER_FILES.map((fileName) => new URL(fileName, shaderRoot).toString());
  await Promise.all(shaderUrls.map(async (url) => {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        throw toLive2dAssetLoadError({
          label: 'Failed to load Live2D shader',
          url,
          status: response.status,
          cause: new Error(`HTTP ${response.status}`),
        });
      }
      await response.text();
    } catch (error) {
      if (typeof (error as { url?: string } | null | undefined)?.url === 'string') {
        throw error;
      }
      throw toLive2dAssetLoadError({
        label: 'Failed to load Live2D shader',
        url,
        cause: error,
      });
    }
  }));
  return shaderUrls;
}

export async function loadLive2dTexture(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  url: string,
  payload?: { mimeType: string; base64: string } | null,
): Promise<WebGLTexture> {
  try {
    const blob = payload
      ? new Blob([arrayBufferFromBase64(payload.base64)], {
          type: payload.mimeType || 'application/octet-stream',
        })
      : await (async () => {
          const response = await fetch(url, { method: 'GET' });
          if (!response.ok) {
            throw toLive2dAssetLoadError({
              label: 'Failed to load Live2D texture',
              url,
              status: response.status,
              cause: new Error(`HTTP ${response.status}`),
            });
          }
          return response.blob();
        })();
    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'premultiply',
    });
    const texture = gl.createTexture();
    if (!texture) {
      bitmap.close();
      throw new Error(`Failed to allocate WebGL texture for ${url}`);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.bindTexture(gl.TEXTURE_2D, null);
    bitmap.close();

    return texture;
  } catch (error) {
    if (typeof (error as { url?: string } | null | undefined)?.url === 'string') {
      throw error;
    }
    throw toLive2dAssetLoadError({
      label: 'Failed to load Live2D texture',
      url,
      cause: error,
    });
  }
}
