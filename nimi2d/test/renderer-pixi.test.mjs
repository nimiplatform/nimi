import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimi2DPixiRenderer } from '../src/renderer/pixi/index.mjs';

function renderPlan() {
  return {
    manifest: {
      manifest_kind: 'nimi.nimi2d.package',
      schema_version: 1,
      package_id: 'n2d_agent_skin',
      package_kind: 'character_package',
      canvas: { width_px: 512, height_px: 512 },
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
      profile_id: 'nimi2d.capability-profile:agent_skin',
      backend_kind: 'nimi2d',
      renderer: {
        canvas: { width_px: 512, height_px: 512 },
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
    sourceCanvas: { width: 512, height: 512 },
    canvas: { width: 512, height: 512 },
  };
}

class FakeCanvas {
  constructor() {
    this.width = 1;
    this.height = 1;
    this.style = {};
    this.attributes = new Map();
    this.removed = false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  remove() {
    this.removed = true;
  }
}

class FakeHost {
  constructor() {
    this.children = [];
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

class FakeRectangle {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
}

class FakeTexture {
  constructor(options = {}) {
    this.source = options.source ?? { fakeSource: true };
    this.frame = options.frame;
    this.orig = options.orig;
    this.label = options.label;
    this.width = options.orig?.width ?? options.frame?.width ?? options.width ?? 512;
    this.height = options.orig?.height ?? options.frame?.height ?? options.height ?? 512;
  }
}

class FakeContainer {
  constructor() {
    this.sortableChildren = false;
    this.children = [];
  }

  addChild(child) {
    if (child instanceof FakeSprite) {
      child.parent = this;
    }
    this.children.push(child);
    return child;
  }
}

class FakeSprite {
  constructor(options) {
    this.options = options;
    this.parent = null;
    this.alpha = 1;
    this.x = 0;
    this.y = 0;
    this.zIndex = 0;
    this.eventMode = 'auto';
    this.label = '';
    this.mask = null;
    this.renderable = true;
    this.scale = { x: 1, y: 1 };
    this.anchor = {
      x: 0,
      y: 0,
      set: (x, y) => {
        this.anchor.x = x;
        this.anchor.y = y;
      },
    };
    this.widthValue = 0;
    this.heightValue = 0;
  }

  set width(value) {
    this.widthValue = value;
    this.scale.x = value / this.options.texture.width;
  }

  get width() {
    return this.widthValue;
  }

  set height(value) {
    this.heightValue = value;
    this.scale.y = value / this.options.texture.height;
  }

  get height() {
    return this.heightValue;
  }
}

class FakeApplication {
  constructor() {
    this.stage = new FakeContainer();
    this.canvas = new FakeCanvas();
    this.renderCalls = 0;
    this.destroyCalls = [];
    this.renderer = {
      resize: (width, height) => {
        this.lastResize = [width, height];
        this.canvas.width = width;
        this.canvas.height = height;
      },
    };
  }

  async init(options) {
    this.canvas.width = options.width ?? 1;
    this.canvas.height = options.height ?? 1;
  }

  render() {
    this.renderCalls += 1;
  }

  destroy(...args) {
    this.destroyCalls.push(args);
    this.canvas.remove();
  }
}

function fakePixi(apps) {
  return {
    Application: class extends FakeApplication {
      constructor() {
        super();
        apps.push(this);
      }
    },
    Container: FakeContainer,
    Sprite: FakeSprite,
    Texture: FakeTexture,
    Rectangle: FakeRectangle,
    Assets: {
      async load() {
        return new FakeTexture({ width: 512, height: 512 });
      },
    },
  };
}

function snapshot() {
  return {
    activity: 'listen',
    activityIntensity: 0.7,
    activityWeight: 0.7,
    emotion: 'neutral',
    expression: 'neutral',
    expressionWeight: 0,
    motion: 'idle',
    motionWeight: 0,
    motionQueueLength: 0,
    motionCompletedCount: 0,
    motionInterruptedCount: 0,
    mouthOpen: 0,
    schedulerTimeMs: 0,
    sequence: 0,
  };
}

test('pixi renderer creates canvas, draws package layers in order, and applies tier-1 transforms', async () => {
  const host = new FakeHost();
  const apps = [];
  let ready = null;
  const renderer = await createNimi2DPixiRenderer({
    host,
    renderPlan: renderPlan(),
    initialSnapshot: snapshot(),
    width: 320,
    height: 480,
    pixi: fakePixi(apps),
    onReady(value) {
      ready = value;
    },
  });

  assert.deepEqual(renderer.layerRefs, ['layer_body', 'layer_mouth', 'layer_outfit']);
  assert.equal(host.children[0].getAttribute('data-testid'), 'nimi2d-pixi-canvas');
  assert.equal(ready.renderer, 'pixi.js');
  assert.deepEqual(ready.layerRefs, ['layer_body', 'layer_mouth', 'layer_outfit']);

  const app = apps[0];
  const root = app.stage.children[0];
  const sprites = root.children;
  assert.equal(root.sortableChildren, true);
  assert.deepEqual(sprites.map((sprite) => sprite.label), ['layer_body', 'layer_mouth', 'layer_outfit']);
  assert.deepEqual(sprites.map((sprite) => sprite.zIndex), [0, 1, 2]);
  assert.deepEqual(sprites.map((sprite) => sprite.options.texture.frame), [
    new FakeRectangle(12, 8, 420, 460),
    new FakeRectangle(24, 16, 72, 36),
    new FakeRectangle(4, 10, 384, 300),
  ]);

  const body = sprites[0];
  const mouth = sprites[1];
  assert.equal(body.anchor.x, 0);
  assert.equal(body.anchor.y, 0);
  assert.equal(Math.round(body.x * 100) / 100, 25);
  assert.equal(Math.round(body.y * 100) / 100, 18.4);
  assert.equal(Math.round(body.width * 100) / 100, 262.5);
  assert.equal(Math.round(mouth.x * 100) / 100, 137.5);
  const bodyYBefore = body.y;
  const bodyScaleXBefore = body.scale.x;
  const mouthScaleBefore = mouth.scale.y;

  renderer.updateSnapshot({
    ...snapshot(),
    activity: 'idle',
    activityIntensity: null,
    activityWeight: 1,
    emotion: 'curious',
    expression: 'curious',
    expressionWeight: 1,
    motion: 'lean_in',
    motionWeight: 1,
    mouthOpen: 1,
    schedulerTimeMs: 250,
    sequence: 1,
  });

  assert.equal(body.y < bodyYBefore, true);
  assert.equal(body.scale.x > bodyScaleXBefore, true);
  assert.equal(mouth.scale.y > mouthScaleBefore, true);
  assert.equal(mouth.alpha, 1);
  assert.equal(app.renderCalls > 0, true);

  renderer.resize(640, 360);
  assert.deepEqual(app.lastResize, [640, 360]);

  renderer.destroy();
  assert.equal(app.destroyCalls.length, 1);
  assert.equal(host.children.length, 0);
});

test('pixi renderer rejects package texture bounds outside the loaded texture', async () => {
  const invalidPlan = renderPlan();
  invalidPlan.renderLayers[0].textureBoundsPx = { x: 480, y: 8, width: 420, height: 460 };

  await assert.rejects(
    () => createNimi2DPixiRenderer({
      host: new FakeHost(),
      renderPlan: invalidPlan,
      initialSnapshot: snapshot(),
      width: 320,
      height: 480,
      pixi: fakePixi([]),
    }),
    /nimi2d_texture_bounds_out_of_range:layer_body/,
  );
});

test('pixi renderer binds package alpha mask assets to the matching layer sprite', async () => {
  const maskedPlan = renderPlan();
  maskedPlan.renderLayers[0].mask = {
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

  const apps = [];
  const renderer = await createNimi2DPixiRenderer({
    host: new FakeHost(),
    renderPlan: maskedPlan,
    initialSnapshot: snapshot(),
    width: 512,
    height: 512,
    pixi: fakePixi(apps),
  });

  const root = apps[0].stage.children[0];
  const sprites = root.children;
  assert.deepEqual(sprites.map((sprite) => sprite.label), [
    'layer_body:mask',
    'layer_body',
    'layer_mouth',
    'layer_outfit',
  ]);
  const mask = sprites[0];
  const maskedBody = sprites[1];
  assert.equal(maskedBody.mask, mask);
  assert.equal(mask.renderable, false);
  assert.deepEqual(mask.options.texture.frame, new FakeRectangle(30, 40, 420, 460));

  renderer.updateSnapshot({
    ...snapshot(),
    activity: 'idle',
    activityWeight: 1,
    motion: 'lean_in',
    motionWeight: 1,
    schedulerTimeMs: 250,
    sequence: 1,
  });

  assert.equal(Math.round(mask.x * 100), Math.round(maskedBody.x * 100));
  assert.equal(Math.round(mask.y * 100), Math.round(maskedBody.y * 100));
  assert.equal(Math.round(mask.scale.x * 100), Math.round(maskedBody.scale.x * 100));
  assert.equal(Math.round(mask.scale.y * 100), Math.round(maskedBody.scale.y * 100));
});
