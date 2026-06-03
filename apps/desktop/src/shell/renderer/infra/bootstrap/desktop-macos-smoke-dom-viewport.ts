import { type DesktopMacosSmokeCanvasStats } from './desktop-macos-smoke-shared';

export async function mutateDesktopMacosSmokeViewportHost(
  selector: string,
  size: { width: number; height: number },
): Promise<void> {
  const root = document.querySelector(selector) as HTMLElement | null;
  if (!root) {
    throw new Error(`missing selector ${selector}`);
  }
  root.style.width = `${size.width}px`;
  root.style.height = `${size.height}px`;
  window.dispatchEvent(new Event('resize'));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export async function pulseDesktopMacosSmokeViewportTinyHost(selector: string): Promise<void> {
  const root = document.querySelector(selector) as HTMLElement | null;
  if (!root) {
    throw new Error(`missing selector ${selector}`);
  }
  const previousWidth = root.style.width;
  const previousHeight = root.style.height;
  root.style.width = '48px';
  root.style.height = '64px';
  window.dispatchEvent(new Event('resize'));
  await new Promise((resolve) => setTimeout(resolve, 180));
  root.style.width = previousWidth;
  root.style.height = previousHeight;
  window.dispatchEvent(new Event('resize'));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export async function triggerDesktopMacosSmokeViewportContextLossAndRestore(
  selector: string,
  debugKey: 'live2d' | 'vrm',
): Promise<void> {
  const root = document.querySelector(selector) as HTMLElement | null;
  const canvas = root?.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error(`missing canvas for selector ${selector}`);
  }
  const runtimeWindow = window as typeof window & {
    __NIMI_DESKTOP_SMOKE_DEBUG_ACTION__?: { kind: 'context-loss-restore'; target: 'live2d' | 'vrm' } | null;
  };
  runtimeWindow.__NIMI_DESKTOP_SMOKE_DEBUG_ACTION__ = {
    kind: 'context-loss-restore',
    target: debugKey,
  };
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  runtimeWindow.__NIMI_DESKTOP_SMOKE_DEBUG_ACTION__ = null;
}

export async function readDesktopMacosSmokeCanvasStats(
  selector: string,
  input: {
    statusAttribute: string;
    stageAttribute?: string;
    debugWindowKey: '__NIMI_LIVE2D_DEBUG__' | '__NIMI_VRM_DEBUG__';
    fallbackSelector: string;
  },
): Promise<DesktopMacosSmokeCanvasStats> {
  const root = document.querySelector(selector) as HTMLElement | null;
  if (!root) {
    return {
      status: null,
      stage: null,
      fallbackText: null,
      width: 0,
      height: 0,
      canvasPresent: false,
      contextKind: null,
      sampleCount: 0,
      nonTransparentSampleCount: 0,
      sampleError: null,
      runtimeDebug: null,
    };
  }

  const canvas = root.querySelector('canvas') as HTMLCanvasElement | null;
  const fallbackElement = root.querySelector(input.fallbackSelector) as HTMLElement | null;
  const status = root.getAttribute(input.statusAttribute);
  const stage = input.stageAttribute ? root.getAttribute(input.stageAttribute) : null;
  const fallbackText = fallbackElement?.textContent?.trim() || null;
  if (!canvas) {
    return {
      status,
      stage,
      fallbackText,
      width: 0,
      height: 0,
      canvasPresent: false,
      contextKind: null,
      sampleCount: 0,
      nonTransparentSampleCount: 0,
      sampleError: null,
      runtimeDebug: null,
    };
  }

  const gl2 = canvas.getContext('webgl2');
  const gl = (gl2 || canvas.getContext('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
  const contextKind: DesktopMacosSmokeCanvasStats['contextKind'] = gl2 ? 'webgl2' : (gl ? 'webgl' : null);
  const width = Math.max(canvas.width, 0);
  const height = Math.max(canvas.height, 0);
  const sampleColumns = Math.min(12, Math.max(3, Math.floor(width / 64) || 3));
  const sampleRows = Math.min(16, Math.max(4, Math.floor(height / 64) || 4));
  let nonTransparentSampleCount = 0;
  let sampleError: string | null = null;

  if (gl && width > 0 && height > 0) {
    const pixel = new Uint8Array(4);
    try {
      for (let row = 0; row < sampleRows; row += 1) {
        const y = Math.min(height - 1, Math.floor(((row + 0.5) / sampleRows) * height));
        for (let column = 0; column < sampleColumns; column += 1) {
          const x = Math.min(width - 1, Math.floor(((column + 0.5) / sampleColumns) * width));
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          const red = pixel[0] ?? 0;
          const green = pixel[1] ?? 0;
          const blue = pixel[2] ?? 0;
          const alpha = pixel[3] ?? 0;
          if (alpha > 8 || (red + green + blue) > 24) {
            nonTransparentSampleCount += 1;
          }
        }
      }
    } catch (error) {
      sampleError = error instanceof Error ? error.message : String(error || 'unknown pixel sampling error');
    }
  }

  return {
    status,
    stage,
    fallbackText,
    width,
    height,
    canvasPresent: true,
    contextKind,
    sampleCount: sampleColumns * sampleRows,
    nonTransparentSampleCount,
    sampleError,
    runtimeDebug: (window as typeof window & {
      __NIMI_LIVE2D_DEBUG__?: Record<string, unknown> | null;
      __NIMI_VRM_DEBUG__?: Record<string, unknown> | null;
    })[input.debugWindowKey] || null,
  };
}
