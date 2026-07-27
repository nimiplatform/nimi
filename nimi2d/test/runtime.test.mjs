import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNimi2DComposer,
  createNimi2DRenderPlan,
} from '../src/runtime/index.mjs';
import {
  runNimi2DReferenceActionBench,
} from '../src/reference-player/index.mjs';

const PACKAGE_YAML = `
manifest_kind: nimi.nimi2d.package
schema_version: 1
package_id: n2d_agent_skin
package_kind: character_package
canvas:
  width_px: 512
  height_px: 512
source:
  validator_evidence_ref: "nimi2d.validator:agent-skin"
governance:
  base_body_renderable: false
  default_outfit_required: true
  adult_capability: unavailable_v1
  underage_body_content: rejected_or_not_present
capability:
  requested_tier: tier-1_agent_basic
  proven_tier: tier-1_agent_basic
base_body:
  renderable: false
  detail_neutral: true
  layer_refs:
    - layer_body
    - layer_mouth
wardrobe:
  default_outfit_ref: n2d_default_outfit_agent
  assets:
    - wardrobe_asset_id: n2d_default_outfit_agent
      wardrobe_kind: default_outfit
      layer_refs:
        - layer_outfit
render_layers:
  - layer_ref: layer_body
    asset_id: asset_layer_body
    layer_kind: base_body_layer
    draw_order_index: 0
    placement_px: { x: 40, y: 20 }
    texture_bounds_px: { x: 0, y: 0, width: 420, height: 460 }
    visible_bounds_px: { x: 0, y: 0, width: 420, height: 460 }
    mask:
      mask_kind: alpha_mask_asset
      asset_id: asset_mask_layer_body
      channel: alpha
      texture_bounds_px: { x: 0, y: 0, width: 420, height: 460 }
  - layer_ref: layer_mouth
    asset_id: asset_layer_mouth
    layer_kind: base_body_layer
    draw_order_index: 1
    placement_px: { x: 220, y: 245 }
    texture_bounds_px: { x: 0, y: 0, width: 72, height: 36 }
    visible_bounds_px: { x: 0, y: 0, width: 72, height: 36 }
  - layer_ref: layer_outfit
    asset_id: asset_layer_outfit
    layer_kind: wardrobe_layer
    draw_order_index: 2
    placement_px: { x: 64, y: 190 }
    texture_bounds_px: { x: 0, y: 0, width: 384, height: 300 }
    visible_bounds_px: { x: 0, y: 0, width: 384, height: 300 }
assets:
  - asset_id: asset_layer_body
    asset_kind: base_body_layer
    ref: body.png
    sha256: "${'a'.repeat(64)}"
    format: png
    width_px: 512
    height_px: 512
    byte_size: 1000
    color_space: srgb
    alpha_mode: straight
    premultiplied_alpha: false
  - asset_id: asset_layer_mouth
    asset_kind: base_body_layer
    ref: mouth.png
    sha256: "${'b'.repeat(64)}"
    format: png
    width_px: 128
    height_px: 64
    byte_size: 1000
    color_space: srgb
    alpha_mode: straight
    premultiplied_alpha: false
  - asset_id: asset_layer_outfit
    asset_kind: wardrobe_layer
    ref: outfit.png
    sha256: "${'c'.repeat(64)}"
    format: png
    width_px: 512
    height_px: 512
    byte_size: 1000
    color_space: srgb
    alpha_mode: straight
    premultiplied_alpha: false
  - asset_id: asset_mask_layer_body
    asset_kind: alpha_mask_layer
    ref: body-mask.png
    sha256: "${'d'.repeat(64)}"
    format: png
    width_px: 512
    height_px: 512
    byte_size: 1000
    color_space: srgb
    alpha_mode: straight
    premultiplied_alpha: false
`;

const PROFILE_YAML = `
profile_id: avatar.nimi2d.capability-profile:agent_skin
backend_kind: nimi2d
renderer:
  canvas:
    width_px: 512
    height_px: 512
  bindings:
    speech_mouth:
      layer_refs:
        - layer_mouth
      scale_y_range:
        - 1
        - 1.4
    motion_routes:
      lean_in:
        layer_refs:
          - layer_body
          - layer_mouth
          - layer_outfit
        translate_y_range_px:
          - 0
          - -12
        scale_x_range:
          - 1
          - 1.02
`;

test('runtime render plan validates package/profile and resolves default outfit layers', () => {
  const plan = createNimi2DRenderPlan({
    packageManifestRaw: PACKAGE_YAML,
    capabilityProfileRaw: PROFILE_YAML,
    packageManifestRef: '/avatar/nimi2d/package.yaml',
  });

  assert.equal(plan.manifest.package_id, 'n2d_agent_skin');
  assert.equal(plan.canvas.width, 512);
  assert.deepEqual(plan.renderLayers.map((layer) => layer.layerRef), [
    'layer_body',
    'layer_mouth',
    'layer_outfit',
  ]);
  assert.deepEqual(plan.renderLayers.map((layer) => layer.drawOrderIndex), [0, 1, 2]);
  assert.deepEqual(plan.renderLayers[0].placementPx, { x: 40, y: 20 });
  assert.equal(plan.sourceCanvas.width, 512);
  assert.equal(plan.renderLayers[0].mask?.maskKind, 'alpha_mask_asset');
  assert.equal(plan.renderLayers[0].mask?.src, '/avatar/nimi2d/body-mask.png');
  assert.equal(plan.renderLayers[2].src, '/avatar/nimi2d/outfit.png');
  assert.deepEqual(
    plan.capabilityProfile.renderer.bindings.motion_routes.lean_in.layer_refs,
    ['layer_body', 'layer_mouth', 'layer_outfit'],
  );
});

test('runtime composer exposes backend-agnostic state transitions', () => {
  const composer = createNimi2DComposer();
  composer.applyActivity({ name: 'listen', intensity: 0.8 });
  composer.applyExpression({ name: 'curious', weight: 0.7 });
  composer.applyMotion({ routeId: 'lean_in' });
  composer.setMouthOpen(0.6);

  assert.equal(composer.snapshot().activity, 'listen');
  assert.equal(composer.snapshot().activityWeight, 0.8);
  assert.equal(composer.snapshot().expression, 'curious');
  assert.equal(composer.snapshot().motion, 'lean_in');
  assert.equal(composer.snapshot().mouthOpen, 0.6);

  composer.reset();
  assert.equal(composer.snapshot().activity, 'idle');
  assert.equal(composer.snapshot().expression, 'neutral');
  assert.equal(composer.snapshot().mouthOpen, 0);
});

test('runtime composer advances expression and motion on a renderer-agnostic scheduler', () => {
  const composer = createNimi2DComposer();
  composer.applyExpression({ name: 'curious', weight: 0.8, fade: 0.2 });

  assert.equal(composer.snapshot().expression, 'curious');
  assert.equal(composer.snapshot().expressionWeight, 0);

  const midExpression = composer.advanceFrame(100);
  assert.ok(midExpression.expressionWeight > 0);
  assert.ok(midExpression.expressionWeight < 0.8);
  assert.equal(midExpression.schedulerTimeMs, 100);

  const finalExpression = composer.advanceFrame(160);
  assert.equal(finalExpression.expressionWeight, 0.8);
  assert.equal(finalExpression.schedulerTimeMs, 260);

  composer.applyMotion({ routeId: 'lean_in', fade: 0.1, durationMs: 300 });
  const midMotion = composer.advanceFrame(60);
  assert.equal(midMotion.motion, 'lean_in');
  assert.ok(midMotion.motionWeight > 0);
  assert.ok(midMotion.motionWeight < 1);

  const recovered = composer.advanceFrame(400);
  assert.equal(recovered.motion, 'idle');
  assert.equal(recovered.motionWeight, 0);

  composer.applyMotion({ routeId: 'wave', loop: true, fade: 0.05 });
  assert.equal(composer.advanceFrame(100).motionWeight, 1);
  composer.reset();
  assert.equal(composer.snapshot().motion, 'idle');
  assert.equal(composer.snapshot().motionWeight, 0);
});

test('runtime composer arbitrates queued and interrupted motion lanes', () => {
  const composer = createNimi2DComposer();
  composer.applyMotion({ routeId: 'wave', fade: 0.02, durationMs: 100 });
  composer.applyMotion({ routeId: 'nod', fade: 0.02, durationMs: 100, queue: true });

  assert.equal(composer.snapshot().motion, 'wave');
  assert.equal(composer.snapshot().motionQueueLength, 1);
  assert.equal(composer.snapshot().motionCompletedCount, 0);
  assert.equal(composer.snapshot().motionInterruptedCount, 0);

  const queued = composer.advanceFrame(120);
  assert.equal(queued.motion, 'nod');
  assert.equal(queued.motionQueueLength, 0);
  assert.equal(queued.motionCompletedCount, 1);
  assert.equal(queued.motionInterruptedCount, 0);

  composer.applyMotion({ routeId: 'spin', fade: 0.02, durationMs: 100, interrupt: true });
  const interrupted = composer.snapshot();
  assert.equal(interrupted.motion, 'spin');
  assert.equal(interrupted.motionQueueLength, 0);
  assert.equal(interrupted.motionCompletedCount, 1);
  assert.equal(interrupted.motionInterruptedCount, 1);

  composer.applyMotion({ routeId: 'idle' });
  assert.equal(composer.snapshot().motion, 'idle');
  assert.equal(composer.snapshot().motionQueueLength, 0);
});

test('reference action bench is generic and does not require host app types', async () => {
  const composer = createNimi2DComposer();
  let now = 0;
  let amplitude = 0;
  const result = await runNimi2DReferenceActionBench({
    backendKind: 'nimi2d',
    defaultOutfitLayerRefs: ['layer_outfit'],
    projection: composer,
    nowMs: () => now,
    async flush() {
      now += 16;
      composer.setMouthOpen(amplitude);
      composer.advanceFrame(16);
    },
    mouth: {
      setAmplitude(value) {
        amplitude = value;
      },
      async attach() {},
      silent() {
        amplitude = 0;
        composer.setMouthOpen(0);
      },
    },
    captureFrame() {
      const snapshot = composer.snapshot();
      return {
        timestampMs: now,
        layerRefs: ['layer_body', 'layer_mouth', 'layer_outfit'],
        activity: snapshot.activity,
        expression: snapshot.expression,
        motion: snapshot.motion,
        mouthOpen: snapshot.mouthOpen,
      };
    },
  });

  assert.equal(result.verdict, 'pass_minimal_tier1');
  assert.equal(result.scope, 'pixi_renderer_foundation');
  assert.equal(result.metrics.gazeBehavior, 'unsupported_v1');
});
