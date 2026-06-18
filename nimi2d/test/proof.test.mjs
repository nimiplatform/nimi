import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureNimi2DMountedVisualFrame,
  createNimi2DAlphaHitProbe,
  Nimi2DMountedVisualFrameError,
  Nimi2DVisualProofError,
  probeNimi2DVisualFrame,
} from '../src/proof/index.mjs';

function rgba(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = color[3];
  }
  return data;
}

function image(color) {
  return {
    width: 8,
    height: 8,
    rgba: rgba(8, 8, color),
  };
}

function imageWithAlpha(color, alphaAt) {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const offset = ((y * 8) + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = alphaAt(x, y);
    }
  }
  return {
    width: 8,
    height: 8,
    rgba: data,
  };
}

function renderPlan(layerRefs) {
  return {
    manifest: {
      manifest_kind: 'nimi.nimi2d.package',
      schema_version: 1,
      package_id: 'n2d_agent_skin',
      package_kind: 'character_package',
      canvas: { width_px: 8, height_px: 8 },
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
        layer_refs: ['layer_body'],
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
    capabilityProfile: null,
    renderLayers: layerRefs.map((layerRef, index) => ({
      layerRef,
      asset: {
        asset_id: `asset_${layerRef}`,
        asset_kind: layerRef === 'layer_outfit' ? 'wardrobe_layer' : 'base_body_layer',
        ref: `${layerRef}.png`,
        sha256: 'a'.repeat(64),
        format: 'png',
        width_px: 8,
        height_px: 8,
        byte_size: 1000,
        color_space: 'srgb',
        alpha_mode: 'straight',
        premultiplied_alpha: false,
      },
      src: `${layerRef}.png`,
      drawOrderIndex: index,
      placementPx: { x: 0, y: 0 },
      textureBoundsPx: { x: 0, y: 0, width: 8, height: 8 },
      visibleBoundsPx: { x: 0, y: 0, width: 8, height: 8 },
      mask: null,
    })),
    sourceCanvas: { width: 8, height: 8 },
    canvas: { width: 8, height: 8 },
  };
}

function installScratchCanvas(data, width, height) {
  const originalDocument = globalThis.document;
  const context = {
    clearRect() {},
    drawImage() {},
    getImageData() {
      return { data };
    },
  };
  const scratch = {
    width,
    height,
    getContext() {
      return context;
    },
    toDataURL() {
      return 'data:image/png;base64,nimi2d';
    },
  };
  globalThis.document = {
    createElement(tagName) {
      if (tagName !== 'canvas') throw new Error(`unexpected element ${tagName}`);
      return scratch;
    },
  };
  return () => {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  };
}

test('visual proof passes when the rendered composite includes visible default outfit pixels', async () => {
  const stats = await probeNimi2DVisualFrame({
    renderPlan: renderPlan(['layer_body', 'layer_outfit']),
    gridSize: 4,
    decodeImage: async ({ layerRef }) => (
      layerRef === 'layer_outfit'
        ? image([20, 120, 220, 255])
        : image([220, 180, 160, 255])
    ),
  });

  assert.equal(stats.visiblePixels, 16);
  assert.equal(stats.defaultOutfitVisiblePixels, 16);
  assert.equal(stats.baseBodyOnlyFrame, false);
  assert.equal(stats.sampledPixelChecksum > 0, true);
});

test('visual proof fails closed when only base body pixels are visible', async () => {
  await assert.rejects(
    () => probeNimi2DVisualFrame({
      renderPlan: renderPlan(['layer_body', 'layer_outfit']),
      gridSize: 4,
      decodeImage: async ({ layerRef }) => (
        layerRef === 'layer_outfit'
          ? image([0, 0, 0, 0])
          : image([220, 180, 160, 255])
      ),
    }),
    Nimi2DVisualProofError,
  );
});

test('alpha hit probe uses composited package layer alpha', async () => {
  const probe = await createNimi2DAlphaHitProbe({
    renderPlan: renderPlan(['layer_body', 'layer_outfit']),
    viewport: { left: 10, top: 20, width: 80, height: 80 },
    decodeImage: async ({ layerRef }) => (
      layerRef === 'layer_outfit'
        ? imageWithAlpha([20, 120, 220], (x) => (x >= 4 ? 255 : 0))
        : image([220, 180, 160, 0])
    ),
  });

  assert.equal(probe.defaultOutfitLayerCount, 1);
  assert.equal(probe.isOpaqueAtClientPoint(70, 60), true);
  assert.equal(probe.isOpaqueAtClientPoint(30, 60), false);
  assert.equal(probe.isOpaqueAtClientPoint(95, 60), false);
});

test('visual proof and alpha hit probe apply package alpha mask assets', async () => {
  const maskedPlan = renderPlan(['layer_body', 'layer_outfit']);
  const outfit = maskedPlan.renderLayers.find((layer) => layer.layerRef === 'layer_outfit');
  outfit.mask = {
    maskKind: 'alpha_mask_asset',
    asset: {
      asset_id: 'asset_mask_layer_outfit',
      asset_kind: 'alpha_mask_layer',
      ref: 'layer_outfit-mask.png',
      sha256: 'b'.repeat(64),
      format: 'png',
      width_px: 8,
      height_px: 8,
      byte_size: 1000,
      color_space: 'srgb',
      alpha_mode: 'straight',
      premultiplied_alpha: false,
    },
    src: 'layer_outfit-mask.png',
    channel: 'alpha',
    textureBoundsPx: { x: 0, y: 0, width: 8, height: 8 },
  };
  const decodeImage = async ({ layerRef }) => {
    if (layerRef === 'layer_outfit:mask') {
      return imageWithAlpha([255, 255, 255], (x) => (x >= 4 ? 255 : 0));
    }
    return layerRef === 'layer_outfit'
      ? image([20, 120, 220, 255])
      : image([220, 180, 160, 0]);
  };

  const stats = await probeNimi2DVisualFrame({
    renderPlan: maskedPlan,
    gridSize: 4,
    decodeImage,
  });
  assert.equal(stats.visiblePixels, 8);
  assert.equal(stats.defaultOutfitVisiblePixels, 8);

  const probe = await createNimi2DAlphaHitProbe({
    renderPlan: maskedPlan,
    decodeImage,
  });
  assert.equal(probe.isOpaqueAtClientPoint(6, 4), true);
  assert.equal(probe.isOpaqueAtClientPoint(2, 4), false);
});

test('alpha hit probe fails closed to null when no default outfit layer is present', async () => {
  const probe = await createNimi2DAlphaHitProbe({
    renderPlan: renderPlan(['layer_body']),
    decodeImage: async () => image([220, 180, 160, 255]),
  });

  assert.equal(probe.defaultOutfitLayerCount, 0);
  assert.equal(probe.isOpaqueAtClientPoint(4, 4), null);
});

test('mounted canvas capture requires visible pixels', () => {
  const source = {
    width: 4,
    height: 4,
    clientWidth: 4,
    clientHeight: 4,
    getBoundingClientRect: () => ({ width: 4, height: 4 }),
  };
  let restore = installScratchCanvas(rgba(4, 4, [20, 120, 220, 255]), 4, 4);
  try {
    const capture = captureNimi2DMountedVisualFrame({ canvas: source, gridSize: 2 });
    assert.equal(capture.artifactId.includes('nimi2d-mounted-visible-frame-4x4'), true);
    assert.equal(capture.dataUrl, 'data:image/png;base64,nimi2d');
    assert.equal(capture.stats.visiblePixels, 4);
    assert.equal(capture.stats.sampledPixels, 4);
    assert.equal(capture.stats.sampledPixelChecksum > 0, true);
  } finally {
    restore();
  }

  restore = installScratchCanvas(rgba(4, 4, [0, 0, 0, 0]), 4, 4);
  try {
    assert.throws(
      () => captureNimi2DMountedVisualFrame({ canvas: source, gridSize: 2 }),
      Nimi2DMountedVisualFrameError,
    );
  } finally {
    restore();
  }
});
