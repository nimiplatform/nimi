import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type DockIconFrame = Readonly<{
  /** True when the artwork already paints its own square/squircle background. */
  hasOwnBackground: boolean;
  /** Uniform scale to crop macOS-style transparent padding around self-framed squircles. */
  scale: number;
  /** Horizontal re-centering shift in percent (applied before scale). */
  offsetXPercent: number;
  /** Vertical re-centering shift in percent (applied before scale). */
  offsetYPercent: number;
}>;

const SAMPLE_SIZE = 64;
const ALPHA_SOLID_THRESHOLD = 128;
const ALPHA_PROBE_THRESHOLD = 200;
const MIN_SQUARE_FILL_RATIO = 0.85;
const MIN_SQUARE_ASPECT = 0.9;
const MAX_CROP_SCALE = 1.45;
const MIN_CROP_COVERAGE = 0.65;
const FULL_BLEED_COVERAGE = 0.98;

const DEFAULT_TRANSPARENT_FRAME: DockIconFrame = Object.freeze({
  hasOwnBackground: false,
  scale: 1,
  offsetXPercent: 0,
  offsetYPercent: 0,
});

const frameCache = new Map<string, DockIconFrame>();

/**
 * Classifies whether an icon raster already carries its own square/squircle
 * background or is a free-floating transparent glyph that needs a white
 * rounded-square backing tile.
 */
export function analyzeIconArtworkPixels(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): DockIconFrame {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return DEFAULT_TRANSPARENT_FRAME;
  }

  const alphaAt = (x: number, y: number): number => {
    const cx = Math.min(height - 1, Math.max(0, y));
    const rx = Math.min(width - 1, Math.max(0, x));
    return rgba[(cx * width + rx) * 4 + 3] ?? 0;
  };

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaqueCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alphaAt(x, y) >= ALPHA_SOLID_THRESHOLD) {
        opaqueCount += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (opaqueCount === 0 || maxX < minX || maxY < minY) {
    return DEFAULT_TRANSPARENT_FRAME;
  }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const fillRatio = opaqueCount / (bw * bh);
  const aspect = Math.min(bw, bh) / Math.max(bw, bh);

  const ix1 = Math.round(minX + bw * 0.12);
  const ix2 = Math.round(maxX - bw * 0.12);
  const iy1 = Math.round(minY + bh * 0.12);
  const iy2 = Math.round(maxY - bh * 0.12);
  const insetCornersOpaque = [
    [ix1, iy1],
    [ix2, iy1],
    [ix1, iy2],
    [ix2, iy2],
  ].filter(([x, y]) => alphaAt(x!, y!) >= ALPHA_PROBE_THRESHOLD).length;

  const mx = Math.round(minX + bw * 0.5);
  const my = Math.round(minY + bh * 0.5);
  const ex1 = Math.round(minX + bw * 0.04);
  const ex2 = Math.round(maxX - bw * 0.04);
  const ey1 = Math.round(minY + bh * 0.04);
  const ey2 = Math.round(maxY - bh * 0.04);
  const edgeMidsOpaque = [
    [mx, ey1],
    [mx, ey2],
    [ex1, my],
    [ex2, my],
  ].filter(([x, y]) => alphaAt(x!, y!) >= ALPHA_PROBE_THRESHOLD).length;

  const hasOwnBackground = fillRatio >= MIN_SQUARE_FILL_RATIO
    && insetCornersOpaque === 4
    && edgeMidsOpaque === 4
    && aspect >= MIN_SQUARE_ASPECT;

  if (!hasOwnBackground) {
    return DEFAULT_TRANSPARENT_FRAME;
  }

  const coverage = Math.min(bw / width, bh / height);
  if (coverage >= FULL_BLEED_COVERAGE || coverage < MIN_CROP_COVERAGE) {
    return {
      hasOwnBackground: true,
      scale: 1,
      offsetXPercent: 0,
      offsetYPercent: 0,
    };
  }

  const scale = Math.min(MAX_CROP_SCALE, Number((1 / coverage).toFixed(3)));
  const bboxCenterX = (minX + maxX + 1) / 2;
  const bboxCenterY = (minY + maxY + 1) / 2;
  const offsetXPercent = Number((((width / 2 - bboxCenterX) / width) * 100).toFixed(2));
  const offsetYPercent = Number((((height / 2 - bboxCenterY) / height) * 100).toFixed(2));

  return {
    hasOwnBackground: true,
    scale,
    offsetXPercent,
    offsetYPercent,
  };
}

function inspectLoadedImage(img: HTMLImageElement): DockIconFrame | null {
  if (typeof document === 'undefined' || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return analyzeIconArtworkPixels(data, SAMPLE_SIZE, SAMPLE_SIZE);
  } catch {
    return null;
  }
}

export function useDockIconFrame(src: string | null): {
  frame: DockIconFrame | null;
  imgRef: RefObject<HTMLImageElement | null>;
  onLoad: () => void;
} {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [frame, setFrame] = useState<DockIconFrame | null>(() => (src ? frameCache.get(src) ?? null : null));

  const measure = useCallback(() => {
    if (!src) {
      setFrame(null);
      return;
    }
    const cached = frameCache.get(src);
    if (cached) {
      setFrame(cached);
      return;
    }
    const img = imgRef.current;
    if (!img) return;
    const measured = inspectLoadedImage(img);
    if (!measured) return;
    frameCache.set(src, measured);
    setFrame(measured);
  }, [src]);

  useLayoutEffect(() => {
    if (!src) {
      setFrame(null);
      return;
    }
    const cached = frameCache.get(src);
    if (cached) {
      setFrame(cached);
      return;
    }
    setFrame(null);
    measure();
  }, [src, measure]);

  return { frame, imgRef, onLoad: measure };
}
