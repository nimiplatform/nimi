import { describe, expect, it, vi } from 'vitest';
import type { Nimi2DRenderPlan } from '@nimiplatform/nimi2d/runtime';
import {
  createNimi2DPixiRenderer,
  type Nimi2DPixiModule,
} from './nimi2d-pixi-renderer.js';

function renderPlan(): Nimi2DRenderPlan {
  return {
    manifest: {
      manifest_kind: 'nimi.nimi2d.package',
      schema_version: 1,
      package_id: 'n2d_agent_skin',
      package_kind: 'character_package',
      canvas: {
        width_px: 512,
        height_px: 512,
      },
      integrity: null,
      governance: {
        base_body_renderable: false,
        default_outfit_required: true,
        adult_capability: 'unavailable_v1',
        underage_body_content: 'rejected_or_not_present',
      },
      capability: {
        requested_tier: 'tier-1_agent_basic',
        proven_tier: 'tier-1_agent_basic',
      },
      base_body: {
        renderable: false,
        detail_neutral: true,
        layer_refs: ['layer_body', 'layer_mouth'],
      },
      wardrobe: {
        default_outfit_ref: 'n2d_default_outfit_agent',
        assets: [{
          wardrobe_asset_id: 'n2d_default_outfit_agent',
          wardrobe_kind: 'default_outfit',
          layer_refs: ['layer_outfit'],
        }],
      },
      assets: [],
      render_layers: [],
    },
    capabilityProfile: {
      profile_id: 'avatar.nimi2d.capability-profile:agent_skin',
      backend_kind: 'nimi2d',
      renderer: {
        canvas: {
          width_px: 512,
          height_px: 512,
        },
        bindings: {
          speech_mouth: {
            layer_refs: ['layer_mouth'],
            scale_y_range: [1, 1.4],
          },
          expression: {
            layer_refs: ['layer_mouth'],
            opacity_range: [0.5, 1],
          },
          idle_life: {
            layer_refs: ['layer_body'],
          },
          motion_routes: {
            lean_in: {
              layer_refs: ['layer_body', 'layer_mouth', 'layer_outfit'],
              translate_y_range_px: [0, -16],
              scale_x_range: [1, 1.05],
            },
          },
        },
      },
    },
    renderLayers: [
      { layerRef: 'layer_body', placementPx: { x: 40, y: 20 }, textureBoundsPx: { x: 12, y: 8, width: 420, height: 460 } },
      { layerRef: 'layer_mouth', placementPx: { x: 220, y: 245 }, textureBoundsPx: { x: 24, y: 16, width: 72, height: 36 } },
      { layerRef: 'layer_outfit', placementPx: { x: 64, y: 190 }, textureBoundsPx: { x: 4, y: 10, width: 384, height: 300 } },
    ].map((layer, index) => ({
      layerRef: layer.layerRef,
      asset: {
        asset_id: `asset_${layer.layerRef}`,
        asset_kind: layer.layerRef === 'layer_outfit' ? 'wardrobe_layer' : 'base_body_layer',
        ref: `${layer.layerRef}.png`,
        sha256: 'a'.repeat(64),
        format: 'png',
        width_px: 512,
        height_px: 512,
        byte_size: 1000,
        color_space: 'srgb',
        alpha_mode: 'straight',
        premultiplied_alpha: false,
      },
      src: `/runtime/${layer.layerRef}.png`,
      drawOrderIndex: index,
      placementPx: layer.placementPx,
      textureBoundsPx: layer.textureBoundsPx,
      visibleBoundsPx: layer.textureBoundsPx,
      mask: null,
    })),
    sourceCanvas: {
      width: 512,
      height: 512,
    },
    canvas: {
      width: 512,
      height: 512,
    },
  };
}

class FakeRectangle {
  public constructor(
    public readonly x = 0,
    public readonly y = 0,
    public readonly width = 0,
    public readonly height = 0,
  ) {}
}

class FakeTexture {
  public readonly source: unknown;
  public readonly frame?: FakeRectangle;
  public readonly orig?: FakeRectangle;
  public readonly label?: string;
  public readonly width: number;
  public readonly height: number;

  public constructor(options: {
    width?: number;
    height?: number;
    source?: unknown;
    frame?: FakeRectangle;
    orig?: FakeRectangle;
    label?: string;
  } = {}) {
    this.source = options.source ?? { fakeSource: true };
    this.frame = options.frame;
    this.orig = options.orig;
    this.label = options.label;
    this.width = options.orig?.width ?? options.frame?.width ?? options.width ?? 512;
    this.height = options.orig?.height ?? options.frame?.height ?? options.height ?? 512;
  }
}

class FakeContainer {
  public sortableChildren = false;
  public children: Array<FakeContainer | FakeSprite> = [];

  public addChild(child: FakeContainer | FakeSprite): FakeContainer | FakeSprite {
    if (child instanceof FakeSprite) {
      child.parent = this;
    }
    this.children.push(child);
    return child;
  }
}

class FakeSprite {
  public parent: FakeContainer | null = null;
  public alpha = 1;
  public x = 0;
  public y = 0;
  public zIndex = 0;
  public eventMode = 'auto';
  public label = '';
  public mask: FakeSprite | null = null;
  public renderable = true;
  public scale = { x: 1, y: 1 };
  public anchor = {
    x: 0,
    y: 0,
    set: (x: number, y: number) => {
      this.anchor.x = x;
      this.anchor.y = y;
    },
  };
  private widthValue = 0;
  private heightValue = 0;

  public constructor(public readonly options: { texture: FakeTexture }) {}

  public set width(value: number) {
    this.widthValue = value;
    this.scale.x = value / this.options.texture.width;
  }

  public get width(): number {
    return this.widthValue;
  }

  public set height(value: number) {
    this.heightValue = value;
    this.scale.y = value / this.options.texture.height;
  }

  public get height(): number {
    return this.heightValue;
  }
}

class FakeApplication {
  public stage = new FakeContainer();
  public canvas = document.createElement('canvas');
  public render = vi.fn();
  public destroy = vi.fn(() => {
    this.canvas.remove();
  });
  public renderer = {
    resize: vi.fn((width: number, height: number) => {
      this.canvas.width = width;
      this.canvas.height = height;
    }),
  };

  public async init(options: { width?: number; height?: number }): Promise<void> {
    this.canvas.width = options.width ?? 1;
    this.canvas.height = options.height ?? 1;
  }
}

function fakePixi(apps: FakeApplication[]): Nimi2DPixiModule {
  return {
    Application: class extends FakeApplication {
      public constructor() {
        super();
        apps.push(this);
      }
    } as unknown as Nimi2DPixiModule['Application'],
    Container: FakeContainer as unknown as Nimi2DPixiModule['Container'],
    Sprite: FakeSprite as unknown as Nimi2DPixiModule['Sprite'],
    Texture: FakeTexture as unknown as Nimi2DPixiModule['Texture'],
    Rectangle: FakeRectangle as unknown as Nimi2DPixiModule['Rectangle'],
    Assets: {
      load: vi.fn(async () => new FakeTexture({
        width: 512,
        height: 512,
      })) as unknown as Nimi2DPixiModule['Assets']['load'],
    },
  };
}

function snapshot() {
  return {
    activity: 'listen' as const,
    activityIntensity: 0.7,
    activityWeight: 0.7,
    emotion: 'neutral' as const,
    expression: 'neutral' as const,
    expressionWeight: 0,
    motion: 'idle' as const,
    motionWeight: 0,
    motionQueueLength: 0,
    motionCompletedCount: 0,
    motionInterruptedCount: 0,
    mouthOpen: 0,
    schedulerTimeMs: 0,
    sequence: 0,
  };
}

describe('createNimi2DPixiRenderer', () => {
  it('creates a Pixi canvas, sprites package layers in draw order, and applies tier-1 transforms', async () => {
    const host = document.createElement('div');
    const apps: FakeApplication[] = [];
    const ready = vi.fn();
    const renderer = await createNimi2DPixiRenderer({
      host,
      renderPlan: renderPlan(),
      initialSnapshot: snapshot(),
      width: 320,
      height: 480,
      pixi: fakePixi(apps),
      onReady: ready,
    });

    expect(renderer.layerRefs).toEqual(['layer_body', 'layer_mouth', 'layer_outfit']);
    expect(host.querySelector('[data-testid="avatar-nimi2d-pixi-canvas"]')).toBeTruthy();
    expect(ready).toHaveBeenCalledWith(expect.objectContaining({
      renderer: 'pixi.js',
      layerRefs: ['layer_body', 'layer_mouth', 'layer_outfit'],
    }));

    const app = apps[0];
    expect(app).toBeDefined();
    if (!app) throw new Error('fake Pixi app was not created');
    const root = app.stage.children[0] as unknown as FakeContainer;
    const sprites = root.children as FakeSprite[];
    expect(root.sortableChildren).toBe(true);
    expect(sprites.map((sprite) => sprite.label)).toEqual(['layer_body', 'layer_mouth', 'layer_outfit']);
    expect(sprites.map((sprite) => sprite.zIndex)).toEqual([0, 1, 2]);
    expect(sprites.map((sprite) => (sprite.options.texture as FakeTexture).frame)).toEqual([
      expect.objectContaining({ x: 12, y: 8, width: 420, height: 460 }),
      expect.objectContaining({ x: 24, y: 16, width: 72, height: 36 }),
      expect.objectContaining({ x: 4, y: 10, width: 384, height: 300 }),
    ]);
    expect(sprites.map((sprite) => (sprite.options.texture as FakeTexture).orig)).toEqual([
      expect.objectContaining({ x: 0, y: 0, width: 420, height: 460 }),
      expect.objectContaining({ x: 0, y: 0, width: 72, height: 36 }),
      expect.objectContaining({ x: 0, y: 0, width: 384, height: 300 }),
    ]);

    const body = sprites[0];
    const mouth = sprites[1];
    expect(body).toBeDefined();
    expect(mouth).toBeDefined();
    if (!body || !mouth) throw new Error('fake Pixi sprites were not created');
    expect(body.anchor.x).toBe(0);
    expect(body.anchor.y).toBe(0);
    expect(body.x).toBeCloseTo(25);
    expect(body.y).toBeCloseTo(18.75 - 0.35);
    expect(body.width).toBeCloseTo(262.5);
    expect(body.height).toBeCloseTo(431.25);
    expect(mouth.x).toBeCloseTo(137.5);
    expect(mouth.y).toBeCloseTo(229.6875);
    const bodyYBefore = body.y;
    const bodyScaleXBefore = body.scale.x;
    const mouthScaleBefore = mouth.scale.y;
    renderer.updateSnapshot({
      activity: 'idle',
      activityIntensity: null,
      activityWeight: 1,
      emotion: 'curious',
      expression: 'curious',
      expressionWeight: 1,
      motion: 'lean_in',
      motionWeight: 1,
      motionQueueLength: 0,
      motionCompletedCount: 0,
      motionInterruptedCount: 0,
      mouthOpen: 1,
      schedulerTimeMs: 250,
      sequence: 1,
    });

    expect(body.y).toBeLessThan(bodyYBefore);
    expect(body.scale.x).toBeGreaterThan(bodyScaleXBefore);
    expect(mouth.scale.y).toBeGreaterThan(mouthScaleBefore);
    expect(mouth.alpha).toBe(1);
    expect(app.render).toHaveBeenCalled();

    renderer.resize(640, 360);
    expect(app.renderer.resize).toHaveBeenCalledWith(640, 360);

    renderer.destroy();
    expect(app.destroy).toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
  });

  it('rejects package texture bounds outside the loaded texture', async () => {
    const host = document.createElement('div');
    const apps: FakeApplication[] = [];
    const invalidPlan = renderPlan();
    const [body] = invalidPlan.renderLayers;
    if (!body) throw new Error('body layer missing from render plan');
    body.textureBoundsPx = { x: 480, y: 8, width: 420, height: 460 };

    await expect(createNimi2DPixiRenderer({
      host,
      renderPlan: invalidPlan,
      initialSnapshot: snapshot(),
      width: 320,
      height: 480,
      pixi: fakePixi(apps),
    })).rejects.toThrow('nimi2d_texture_bounds_out_of_range:layer_body');
  });

  it('binds package alpha mask assets to the matching layer sprite', async () => {
    const host = document.createElement('div');
    const apps: FakeApplication[] = [];
    const maskedPlan = renderPlan();
    const [body] = maskedPlan.renderLayers;
    if (!body) throw new Error('body layer missing from render plan');
    body.mask = {
      maskKind: 'alpha_mask_asset',
      asset: {
        asset_id: 'asset_mask_layer_body',
        asset_kind: 'alpha_mask_layer',
        ref: 'body-mask.png',
        sha256: 'b'.repeat(64),
        format: 'png',
        width_px: 512,
        height_px: 512,
        byte_size: 1000,
        color_space: 'srgb',
        alpha_mode: 'straight',
        premultiplied_alpha: false,
      },
      src: '/runtime/body-mask.png',
      channel: 'alpha',
      textureBoundsPx: { x: 30, y: 40, width: 420, height: 460 },
    };

    const renderer = await createNimi2DPixiRenderer({
      host,
      renderPlan: maskedPlan,
      initialSnapshot: snapshot(),
      width: 512,
      height: 512,
      pixi: fakePixi(apps),
    });

    const app = apps[0];
    expect(app).toBeDefined();
    if (!app) throw new Error('fake Pixi app was not created');
    const root = app.stage.children[0] as unknown as FakeContainer;
    const sprites = root.children as FakeSprite[];
    expect(sprites.map((sprite) => sprite.label)).toEqual([
      'layer_body:mask',
      'layer_body',
      'layer_mouth',
      'layer_outfit',
    ]);
    const mask = sprites[0];
    const maskedBody = sprites[1];
    expect(maskedBody?.mask).toBe(mask);
    expect(mask?.renderable).toBe(false);
    expect((mask?.options.texture as FakeTexture).frame).toEqual(expect.objectContaining({
      x: 30,
      y: 40,
      width: 420,
      height: 460,
    }));

    renderer.updateSnapshot({
      ...snapshot(),
      activity: 'idle',
      activityWeight: 1,
      motion: 'lean_in',
      motionWeight: 1,
      schedulerTimeMs: 250,
      sequence: 1,
    });

    expect(mask?.x).toBeCloseTo(maskedBody?.x ?? 0);
    expect(mask?.y).toBeCloseTo(maskedBody?.y ?? 0);
    expect(mask?.scale.x).toBeCloseTo(maskedBody?.scale.x ?? 0);
    expect(mask?.scale.y).toBeCloseTo(maskedBody?.scale.y ?? 0);
  });
});
