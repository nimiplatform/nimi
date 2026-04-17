import assert from 'node:assert/strict';
import { E2E_IDS } from '../helpers/selectors.mjs';
import {
  assertScenario,
  clickByTestId,
  waitForTestId,
} from '../helpers/app.mjs';

const LIVE2D_VIEWPORT_SELECTOR = '[data-avatar-live2d-status]';

async function readLive2dCanvasStats() {
  return browser.execute((selector) => {
    const root = document.querySelector(selector);
    const fallbackText = document.querySelector('[data-live2d-fallback-reason="true"]')?.textContent?.trim() || null;
    if (!root) {
      return {
        status: null,
        fallbackText,
        width: 0,
        height: 0,
        canvasPresent: false,
        contextKind: null,
        sampleCount: 0,
        nonTransparentSampleCount: 0,
        sampleError: null,
      };
    }

    const canvas = root.querySelector('canvas');
    const status = root.getAttribute('data-avatar-live2d-status');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return {
        status,
        fallbackText,
        width: 0,
        height: 0,
        canvasPresent: false,
        contextKind: null,
        sampleCount: 0,
        nonTransparentSampleCount: 0,
        sampleError: null,
      };
    }

    const gl2 = canvas.getContext('webgl2');
    const gl = gl2 || canvas.getContext('webgl');
    const width = Math.max(canvas.width, 0);
    const height = Math.max(canvas.height, 0);
    const sampleColumns = Math.min(12, Math.max(3, Math.floor(width / 64) || 3));
    const sampleRows = Math.min(16, Math.max(4, Math.floor(height / 64) || 4));
    let nonTransparentSampleCount = 0;
    let sampleError = null;

    if (gl && width > 0 && height > 0) {
      const pixel = new Uint8Array(4);
      try {
        for (let row = 0; row < sampleRows; row += 1) {
          const y = Math.min(height - 1, Math.floor(((row + 0.5) / sampleRows) * height));
          for (let column = 0; column < sampleColumns; column += 1) {
            const x = Math.min(width - 1, Math.floor(((column + 0.5) / sampleColumns) * width));
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            if (pixel[3] > 8 || (pixel[0] + pixel[1] + pixel[2]) > 24) {
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
      fallbackText,
      width,
      height,
      canvasPresent: true,
      contextKind: gl2 ? 'webgl2' : (gl ? 'webgl' : null),
      sampleCount: sampleColumns * sampleRows,
      nonTransparentSampleCount,
      sampleError,
    };
  }, LIVE2D_VIEWPORT_SELECTOR);
}

describe('chat.live2d-render-smoke', () => {
  it('renders non-transparent pixels for the bound official Cubism 5 sample model', async () => {
    assertScenario('chat.live2d-render-smoke');
    await waitForTestId(E2E_IDS.panel('chat'));
    await clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));

    await browser.waitUntil(async () => Boolean(await $(LIVE2D_VIEWPORT_SELECTOR).isExisting()), {
      timeout: 15000,
      timeoutMsg: 'expected live2d viewport root to exist',
    });

    let lastStats = await readLive2dCanvasStats();
    await browser.waitUntil(async () => {
      lastStats = await readLive2dCanvasStats();
      if (lastStats.status === 'error') {
        throw new Error(lastStats.fallbackText || 'live2d viewport failed closed');
      }
      return lastStats.status === 'ready' && lastStats.nonTransparentSampleCount >= 3;
    }, {
      timeout: 15000,
      interval: 150,
      timeoutMsg: 'expected live2d canvas to render non-transparent pixels',
    });

    assert.equal(lastStats.status, 'ready');
    assert.equal(lastStats.canvasPresent, true);
    assert.ok(lastStats.width > 0);
    assert.ok(lastStats.height > 0);
    assert.ok(lastStats.nonTransparentSampleCount >= 3);
  });
});
