import type {
  Nimi2DComposerSnapshot,
  Nimi2DLayerTransformBinding,
  Nimi2DRenderPlan,
} from '@nimiplatform/nimi2d/runtime';
import type {
  Application as PixiApplication,
  Container as PixiContainer,
  Rectangle as PixiRectangle,
  Sprite as PixiSprite,
  Texture as PixiTexture,
} from 'pixi.js';

type PixiApplicationConstructor = new () => PixiApplication;
type PixiContainerConstructor = new () => PixiContainer;
type PixiSpriteConstructor = new (options: { texture: PixiTexture }) => PixiSprite;
type PixiTextureConstructor = new (options?: {
  source?: PixiTexture['source'];
  frame?: PixiRectangle;
  orig?: PixiRectangle;
  trim?: PixiRectangle;
  label?: string;
}) => PixiTexture;
type PixiRectangleConstructor = new (
  x?: string | number,
  y?: string | number,
  width?: string | number,
  height?: string | number,
) => PixiRectangle;

export type Nimi2DPixiModule = {
  Application: PixiApplicationConstructor;
  Container: PixiContainerConstructor;
  Sprite: PixiSpriteConstructor;
  Texture: PixiTextureConstructor;
  Rectangle: PixiRectangleConstructor;
  Assets: {
    load(src: string): Promise<PixiTexture>;
  };
};

export type Nimi2DPixiRendererReady = {
  renderer: 'pixi.js';
  layerRefs: string[];
  canvas: HTMLCanvasElement;
};

export type Nimi2DPixiRendererHandle = {
  readonly renderer: 'pixi.js';
  readonly layerRefs: string[];
  updateSnapshot(snapshot: Nimi2DComposerSnapshot): void;
  resize(width: number, height: number): void;
  destroy(): void;
};

export type Nimi2DPixiRendererInput = {
  host: HTMLElement;
  renderPlan: Nimi2DRenderPlan;
  initialSnapshot: Nimi2DComposerSnapshot;
  width: number;
  height: number;
  pixi?: Nimi2DPixiModule;
  onReady?: (ready: Nimi2DPixiRendererReady) => void;
};

type LayerSprite = {
  layerRef: string;
  renderLayer: Nimi2DRenderPlan['renderLayers'][number];
  sprite: PixiSprite;
  maskSprite: PixiSprite | null;
  baseX: number;
  baseY: number;
  baseScaleX: number;
  baseScaleY: number;
  canvasWidth: number;
  canvasHeight: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lerp(range: [number, number] | undefined, fallback: [number, number], weight: number): number {
  const [from, to] = range ?? fallback;
  return from + (to - from) * clamp01(weight);
}

function bindingIncludes(binding: Nimi2DLayerTransformBinding | undefined, layerRef: string): boolean {
  return Boolean(binding?.layer_refs.includes(layerRef));
}

async function loadPixiModule(): Promise<Nimi2DPixiModule> {
  return await import('pixi.js');
}

function setCanvasAttributes(canvas: HTMLCanvasElement): void {
  canvas.setAttribute('data-testid', 'avatar-nimi2d-pixi-canvas');
  canvas.setAttribute('data-nimi2d-renderer', 'pixi.js');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
}

function resizeSpriteToCanvas(layer: LayerSprite, renderPlan: Nimi2DRenderPlan, width: number, height: number): void {
  const scaleX = width / Math.max(1, renderPlan.sourceCanvas.width);
  const scaleY = height / Math.max(1, renderPlan.sourceCanvas.height);
  layer.sprite.x = layer.renderLayer.placementPx.x * scaleX;
  layer.sprite.y = layer.renderLayer.placementPx.y * scaleY;
  layer.sprite.width = layer.renderLayer.textureBoundsPx.width * scaleX;
  layer.sprite.height = layer.renderLayer.textureBoundsPx.height * scaleY;
  layer.baseX = layer.sprite.x;
  layer.baseY = layer.sprite.y;
  layer.baseScaleX = layer.sprite.scale.x;
  layer.baseScaleY = layer.sprite.scale.y;
  layer.canvasWidth = width;
  layer.canvasHeight = height;
  syncMaskSprite(layer);
}

function syncMaskSprite(layer: LayerSprite): void {
  if (!layer.maskSprite) return;
  layer.maskSprite.x = layer.sprite.x;
  layer.maskSprite.y = layer.sprite.y;
  layer.maskSprite.scale.x = layer.sprite.scale.x;
  layer.maskSprite.scale.y = layer.sprite.scale.y;
}

function assertBoundsWithinSource(
  layerRef: string,
  bounds: Nimi2DRenderPlan['renderLayers'][number]['textureBoundsPx'],
  texture: PixiTexture,
  errorKind: string,
): void {
  const textureWidth = Number(texture.width);
  const textureHeight = Number(texture.height);
  const invalidBounds = !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.width)
    || !Number.isFinite(bounds.height)
    || bounds.x < 0
    || bounds.y < 0
    || bounds.width <= 0
    || bounds.height <= 0;
  if (invalidBounds) {
    throw new Error(`${errorKind}_invalid:${layerRef}`);
  }
  if (!Number.isFinite(textureWidth)
    || !Number.isFinite(textureHeight)
    || bounds.x + bounds.width > textureWidth
    || bounds.y + bounds.height > textureHeight) {
    throw new Error(`${errorKind}_out_of_range:${layerRef}`);
  }
}

function createCroppedTextureFromBounds(
  pixi: Nimi2DPixiModule,
  input: {
    layerRef: string;
    bounds: Nimi2DRenderPlan['renderLayers'][number]['textureBoundsPx'];
    label: string;
    errorKind: string;
  },
  sourceTexture: PixiTexture,
): PixiTexture {
  assertBoundsWithinSource(input.layerRef, input.bounds, sourceTexture, input.errorKind);
  const bounds = input.bounds;
  return new pixi.Texture({
    source: sourceTexture.source,
    frame: new pixi.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height),
    orig: new pixi.Rectangle(0, 0, bounds.width, bounds.height),
    label: input.label,
  });
}

function createCroppedTexture(
  pixi: Nimi2DPixiModule,
  layer: Nimi2DRenderPlan['renderLayers'][number],
  sourceTexture: PixiTexture,
): PixiTexture {
  return createCroppedTextureFromBounds(pixi, {
    layerRef: layer.layerRef,
    bounds: layer.textureBoundsPx,
    label: `nimi2d:${layer.layerRef}:texture_bounds`,
    errorKind: 'nimi2d_texture_bounds',
  }, sourceTexture);
}

function applySnapshotToLayer(input: {
  layer: LayerSprite;
  snapshot: Nimi2DComposerSnapshot;
  bindings: NonNullable<Nimi2DRenderPlan['capabilityProfile']>['renderer']['bindings'] | undefined;
}): void {
  const { layer, snapshot, bindings } = input;
  layer.sprite.alpha = 1;
  layer.sprite.x = layer.baseX;
  layer.sprite.y = layer.baseY;
  layer.sprite.scale.x = layer.baseScaleX;
  layer.sprite.scale.y = layer.baseScaleY;

  if (bindingIncludes(bindings?.speech_mouth, layer.layerRef)) {
    const scale = lerp(bindings?.speech_mouth?.scale_y_range, [1, 1.32], snapshot.mouthOpen);
    layer.sprite.scale.y = layer.baseScaleY * scale;
  }

  if (bindingIncludes(bindings?.expression, layer.layerRef)) {
    layer.sprite.alpha = lerp(bindings?.expression?.opacity_range, [0.72, 1], snapshot.expressionWeight);
  }

  if (bindingIncludes(bindings?.idle_life, layer.layerRef)) {
    const intensity = snapshot.activity === 'idle' ? 1 : 0.35;
    const schedulerBreath = Math.sin(snapshot.schedulerTimeMs / 500) * 1.25 * clamp01(snapshot.activityWeight);
    layer.sprite.y -= intensity + schedulerBreath;
  }

  const motionBinding = bindings?.motion_routes?.[snapshot.motion];
  if (bindingIncludes(motionBinding, layer.layerRef)) {
    const weight = clamp01(snapshot.motionWeight);
    layer.sprite.x += lerp(motionBinding?.translate_x_range_px, [0, 0], weight);
    layer.sprite.y += lerp(motionBinding?.translate_y_range_px, [0, 0], weight);
    layer.sprite.scale.x *= lerp(motionBinding?.scale_x_range, [1, 1], weight);
    layer.sprite.scale.y *= lerp(motionBinding?.scale_y_range, [1, 1], weight);
    layer.sprite.alpha *= lerp(motionBinding?.opacity_range, [1, 1], weight);
  }

  syncMaskSprite(layer);
}

export async function createNimi2DPixiRenderer(input: Nimi2DPixiRendererInput): Promise<Nimi2DPixiRendererHandle> {
  const pixi = input.pixi ?? await loadPixiModule();
  const app = new pixi.Application();
  const canvasWidth = Math.max(1, Math.floor(input.width || input.renderPlan.canvas.width));
  const canvasHeight = Math.max(1, Math.floor(input.height || input.renderPlan.canvas.height));

  await app.init({
    width: canvasWidth,
    height: canvasHeight,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    preference: 'webgl',
  });

  const root = new pixi.Container();
  root.sortableChildren = true;
  app.stage.addChild(root);

  const canvas = app.canvas as HTMLCanvasElement;
  setCanvasAttributes(canvas);
  input.host.replaceChildren(canvas);

  const layerSprites: LayerSprite[] = [];
  for (const [index, layer] of input.renderPlan.renderLayers.entries()) {
    const loadedTexture = await pixi.Assets.load(layer.src);
    const texture = createCroppedTexture(pixi, layer, loadedTexture);
    const sprite = new pixi.Sprite({ texture });
    sprite.anchor.set(0, 0);
    sprite.zIndex = layer.drawOrderIndex;
    sprite.eventMode = 'none';
    sprite.label = layer.layerRef;
    let maskSprite: PixiSprite | null = null;
    if (layer.mask) {
      const loadedMaskTexture = await pixi.Assets.load(layer.mask.src);
      const maskTexture = createCroppedTextureFromBounds(pixi, {
        layerRef: layer.layerRef,
        bounds: layer.mask.textureBoundsPx,
        label: `nimi2d:${layer.layerRef}:alpha_mask`,
        errorKind: 'nimi2d_mask_bounds',
      }, loadedMaskTexture);
      maskSprite = new pixi.Sprite({ texture: maskTexture });
      maskSprite.anchor.set(0, 0);
      maskSprite.zIndex = layer.drawOrderIndex;
      maskSprite.eventMode = 'none';
      maskSprite.label = `${layer.layerRef}:mask`;
      (maskSprite as PixiSprite & { renderable?: boolean }).renderable = false;
      (sprite as PixiSprite & { mask?: PixiSprite | null }).mask = maskSprite;
      root.addChild(maskSprite);
    }
    root.addChild(sprite);
    const layerSprite = {
      layerRef: layer.layerRef,
      renderLayer: layer,
      sprite,
      maskSprite,
      baseX: 0,
      baseY: 0,
      baseScaleX: 1,
      baseScaleY: 1,
      canvasWidth,
      canvasHeight,
    };
    resizeSpriteToCanvas(layerSprite, input.renderPlan, canvasWidth, canvasHeight);
    layerSprites.push(layerSprite);
  }

  const bindings = input.renderPlan.capabilityProfile?.renderer.bindings;
  let currentSnapshot = input.initialSnapshot;

  const handle: Nimi2DPixiRendererHandle = {
    renderer: 'pixi.js',
    layerRefs: layerSprites.map((layer) => layer.layerRef),
    updateSnapshot(snapshot) {
      currentSnapshot = snapshot;
      for (const layer of layerSprites) {
        applySnapshotToLayer({ layer, snapshot, bindings });
      }
      app.render();
    },
    resize(width, height) {
      const nextWidth = Math.max(1, Math.floor(width || input.renderPlan.canvas.width));
      const nextHeight = Math.max(1, Math.floor(height || input.renderPlan.canvas.height));
      app.renderer.resize(nextWidth, nextHeight);
      for (const layer of layerSprites) {
        resizeSpriteToCanvas(layer, input.renderPlan, nextWidth, nextHeight);
      }
      this.updateSnapshot(currentSnapshot);
    },
    destroy() {
      app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false, context: true });
      input.host.replaceChildren();
    },
  };

  handle.updateSnapshot(input.initialSnapshot);
  input.onReady?.({
    renderer: 'pixi.js',
    layerRefs: handle.layerRefs,
    canvas,
  });
  return handle;
}
