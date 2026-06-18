const DEFAULT_GRID_SIZE = 24;
const VISIBLE_ALPHA_THRESHOLD = 127;
const DEFAULT_HIT_ALPHA_THRESHOLD = 10 / 255;

export class Nimi2DVisualProofError extends Error {
  constructor(message, stats) {
    super(message);
    this.name = 'Nimi2DVisualProofError';
    this.stats = stats;
  }
}

export class Nimi2DMountedVisualFrameError extends Error {
  constructor(message, stats) {
    super(message);
    this.name = 'Nimi2DMountedVisualFrameError';
    this.stats = stats;
  }
}

function defaultOutfitLayerRefs(renderPlan) {
  const defaultOutfit = renderPlan.manifest.wardrobe.assets.find(
    (asset) => asset.wardrobe_asset_id === renderPlan.manifest.wardrobe.default_outfit_ref,
  );
  return new Set(defaultOutfit?.layer_refs ?? []);
}

function sampleImageAlpha(input) {
  const placement = input.decodedLayer.renderLayer.placementPx;
  const bounds = input.decodedLayer.renderLayer.textureBoundsPx;
  const sourceX = input.x * (input.sourceCanvasWidth / input.canvasWidth);
  const sourceY = input.y * (input.sourceCanvasHeight / input.canvasHeight);
  const localX = sourceX - placement.x;
  const localY = sourceY - placement.y;
  if (localX < 0 || localY < 0 || localX >= bounds.width || localY >= bounds.height) {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }

  const image = input.decodedLayer.image;
  const imageX = Math.max(0, Math.min(image.width - 1, Math.round(bounds.x + localX)));
  const imageY = Math.max(0, Math.min(image.height - 1, Math.round(bounds.y + localY)));
  const offset = ((imageY * image.width) + imageX) * 4;
  let alpha = image.rgba[offset + 3] ?? 0;

  if (input.decodedLayer.mask) {
    const mask = input.decodedLayer.mask;
    const maskBounds = mask.textureBoundsPx;
    const maskX = Math.max(0, Math.min(mask.image.width - 1, Math.round(maskBounds.x + localX)));
    const maskY = Math.max(0, Math.min(mask.image.height - 1, Math.round(maskBounds.y + localY)));
    const maskOffset = ((maskY * mask.image.width) + maskX) * 4;
    alpha = Math.min(alpha, mask.image.rgba[maskOffset + 3] ?? 0);
  }

  return {
    red: image.rgba[offset] ?? 0,
    green: image.rgba[offset + 1] ?? 0,
    blue: image.rgba[offset + 2] ?? 0,
    alpha,
  };
}

function sampleCompositedPixel(input) {
  let final = { red: 0, green: 0, blue: 0, alpha: 0 };
  let defaultVisibleAtSample = false;
  for (const layer of input.decodedLayers) {
    const pixel = sampleImageAlpha({
      decodedLayer: layer,
      x: input.x,
      y: input.y,
      canvasWidth: input.canvasWidth,
      canvasHeight: input.canvasHeight,
      sourceCanvasWidth: input.sourceCanvasWidth,
      sourceCanvasHeight: input.sourceCanvasHeight,
    });
    if (pixel.alpha <= 0) continue;
    if (layer.isDefaultOutfit && pixel.alpha > VISIBLE_ALPHA_THRESHOLD) {
      defaultVisibleAtSample = true;
    }
    final = pixel;
  }
  return {
    ...final,
    defaultVisibleAtSample,
  };
}

async function decodeBrowserImage(input) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('Nimi2D visual proof requires browser image decoding');
  }
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`Nimi2D visual proof failed to load layer ${input.layerRef}`));
    element.src = input.src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.naturalWidth || image.width);
  canvas.height = Math.max(1, image.naturalHeight || image.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Nimi2D visual proof requires a 2D canvas context');
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    rgba: context.getImageData(0, 0, canvas.width, canvas.height).data,
  };
}

function canvasPixelSize(canvas) {
  const rect = typeof canvas.getBoundingClientRect === 'function'
    ? canvas.getBoundingClientRect()
    : null;
  return {
    width: Math.max(1, Math.floor(canvas.width || canvas.clientWidth || rect?.width || 1)),
    height: Math.max(1, Math.floor(canvas.height || canvas.clientHeight || rect?.height || 1)),
  };
}

function mountedVisualArtifactId(stats) {
  return `nimi2d-mounted-visible-frame-${stats.canvasWidth}x${stats.canvasHeight}-${stats.sampledPixelChecksum}`;
}

export function captureNimi2DMountedVisualFrame(input) {
  if (typeof document === 'undefined') {
    throw new Error('Nimi2D mounted visual capture requires a browser document');
  }
  const gridSize = Math.max(1, Math.floor(input.gridSize ?? DEFAULT_GRID_SIZE));
  const { width, height } = canvasPixelSize(input.canvas);
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  const emptyStats = {
    modelKind: 'nimi2d',
    canvasWidth: width,
    canvasHeight: height,
    gridSize,
    sampledPixels: 0,
    visiblePixels: 0,
    sampledPixelChecksum: 0,
  };
  if (!context) {
    throw new Nimi2DMountedVisualFrameError('Nimi2D mounted visual capture requires a readable 2D canvas context', emptyStats);
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(input.canvas, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  let sampledPixels = 0;
  let visiblePixels = 0;
  let sampledPixelChecksum = 0;
  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      const x = Math.max(0, Math.min(width - 1, Math.floor(((column + 0.5) / gridSize) * width)));
      const y = Math.max(0, Math.min(height - 1, Math.floor(((row + 0.5) / gridSize) * height)));
      const offset = ((y * width) + x) * 4;
      const red = rgba[offset] ?? 0;
      const green = rgba[offset + 1] ?? 0;
      const blue = rgba[offset + 2] ?? 0;
      const alpha = rgba[offset + 3] ?? 0;
      sampledPixels += 1;
      if (alpha > VISIBLE_ALPHA_THRESHOLD) {
        visiblePixels += 1;
      }
      sampledPixelChecksum = (
        sampledPixelChecksum
        + ((red * 3) + (green * 5) + (blue * 7) + (alpha * 11)) * sampledPixels
      ) >>> 0;
    }
  }
  const stats = {
    modelKind: 'nimi2d',
    canvasWidth: width,
    canvasHeight: height,
    gridSize,
    sampledPixels,
    visiblePixels,
    sampledPixelChecksum,
  };
  if (sampledPixels <= 0) {
    throw new Nimi2DMountedVisualFrameError('Nimi2D mounted visual capture sampled no pixels', stats);
  }
  if (visiblePixels <= 0) {
    throw new Nimi2DMountedVisualFrameError('Nimi2D mounted visual capture found no visible pixels', stats);
  }
  return {
    stats,
    artifactId: mountedVisualArtifactId(stats),
    dataUrl: scratch.toDataURL('image/png'),
  };
}

async function decodeRenderLayers(input) {
  const defaultRefs = defaultOutfitLayerRefs(input.renderPlan);
  const decode = input.decodeImage ?? decodeBrowserImage;
  const decodedLayers = await Promise.all(input.renderPlan.renderLayers.map(async (layer) => {
    const maskImage = layer.mask
      ? await decode({ src: layer.mask.src, layerRef: `${layer.layerRef}:mask` })
      : null;
    return {
      layerRef: layer.layerRef,
      renderLayer: layer,
      isDefaultOutfit: defaultRefs.has(layer.layerRef),
      image: await decode({ src: layer.src, layerRef: layer.layerRef }),
      mask: layer.mask && maskImage ? {
        image: maskImage,
        textureBoundsPx: layer.mask.textureBoundsPx,
      } : null,
    };
  }));
  return { defaultRefs, decodedLayers };
}

export async function createNimi2DAlphaHitProbe(input) {
  const canvasWidth = Math.max(1, Math.floor(input.renderPlan.canvas.width));
  const canvasHeight = Math.max(1, Math.floor(input.renderPlan.canvas.height));
  const defaultViewport = { left: 0, top: 0, width: canvasWidth, height: canvasHeight };
  const { defaultRefs, decodedLayers } = await decodeRenderLayers(input);
  const defaultOutfitLayerCount = decodedLayers.filter((layer) => layer.isDefaultOutfit).length;

  return {
    modelKind: 'nimi2d',
    layerCount: decodedLayers.length,
    defaultOutfitLayerCount,
    isOpaqueAtClientPoint(clientX, clientY, threshold = DEFAULT_HIT_ALPHA_THRESHOLD) {
      if (defaultRefs.size <= 0 || defaultOutfitLayerCount <= 0) return null;
      const viewport = typeof input.viewport === 'function'
        ? input.viewport()
        : input.viewport ?? defaultViewport;
      if (!viewport) return null;
      if (viewport.width <= 0 || viewport.height <= 0) return null;
      if (clientX < viewport.left
        || clientY < viewport.top
        || clientX > viewport.left + viewport.width
        || clientY > viewport.top + viewport.height) {
        return false;
      }
      const x = ((clientX - viewport.left) / viewport.width) * canvasWidth;
      const y = ((clientY - viewport.top) / viewport.height) * canvasHeight;
      const pixel = sampleCompositedPixel({
        decodedLayers,
        x,
        y,
        canvasWidth,
        canvasHeight,
        sourceCanvasWidth: input.renderPlan.sourceCanvas.width,
        sourceCanvasHeight: input.renderPlan.sourceCanvas.height,
      });
      return pixel.alpha > Math.max(0, Math.min(1, threshold)) * 255;
    },
  };
}

export async function probeNimi2DVisualFrame(input) {
  const gridSize = Math.max(1, Math.floor(input.gridSize ?? DEFAULT_GRID_SIZE));
  const canvasWidth = Math.max(1, Math.floor(input.renderPlan.canvas.width));
  const canvasHeight = Math.max(1, Math.floor(input.renderPlan.canvas.height));
  const { defaultRefs, decodedLayers } = await decodeRenderLayers(input);

  let sampledPixels = 0;
  let visiblePixels = 0;
  let defaultOutfitVisiblePixels = 0;
  let sampledPixelChecksum = 0;

  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      const x = ((column + 0.5) / gridSize) * canvasWidth;
      const y = ((row + 0.5) / gridSize) * canvasHeight;
      sampledPixels += 1;
      const final = sampleCompositedPixel({
        decodedLayers,
        x,
        y,
        canvasWidth,
        canvasHeight,
        sourceCanvasWidth: input.renderPlan.sourceCanvas.width,
        sourceCanvasHeight: input.renderPlan.sourceCanvas.height,
      });
      if (final.alpha > VISIBLE_ALPHA_THRESHOLD) {
        visiblePixels += 1;
      }
      if (final.defaultVisibleAtSample) {
        defaultOutfitVisiblePixels += 1;
      }
      sampledPixelChecksum = (
        sampledPixelChecksum
        + ((final.red * 3) + (final.green * 5) + (final.blue * 7) + (final.alpha * 11)) * sampledPixels
      ) >>> 0;
    }
  }

  const stats = {
    modelKind: 'nimi2d',
    canvasWidth,
    canvasHeight,
    gridSize,
    sampledPixels,
    visiblePixels,
    defaultOutfitVisiblePixels,
    baseBodyOnlyFrame: visiblePixels > 0 && defaultOutfitVisiblePixels === 0,
    layerCount: decodedLayers.length,
    defaultOutfitLayerCount: defaultRefs.size,
    sampledPixelChecksum,
  };
  assertNimi2DVisualFrame(stats);
  return stats;
}

export function assertNimi2DVisualFrame(stats) {
  if (stats.canvasWidth <= 0 || stats.canvasHeight <= 0) {
    throw new Nimi2DVisualProofError('Nimi2D visual frame has no renderable size', stats);
  }
  if (stats.sampledPixels <= 0 || stats.visiblePixels <= 0) {
    throw new Nimi2DVisualProofError('Nimi2D visual frame produced no visible pixels', stats);
  }
  if (stats.defaultOutfitLayerCount <= 0 || stats.defaultOutfitVisiblePixels <= 0) {
    throw new Nimi2DVisualProofError('Nimi2D visual frame has no visible default outfit pixels', stats);
  }
  if (stats.baseBodyOnlyFrame) {
    throw new Nimi2DVisualProofError('Nimi2D visual frame is base-body-only', stats);
  }
}
