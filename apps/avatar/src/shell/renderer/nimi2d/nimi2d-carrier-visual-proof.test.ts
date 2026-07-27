import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Nimi2DRenderPlan } from '@nimiplatform/nimi2d/runtime';
import {
  createNimi2DAlphaHitProbe,
  Nimi2DCarrierVisualProofError,
  probeNimi2DCarrierVisualFrame,
  type Nimi2DDecodedImage,
} from './nimi2d-carrier-visual-proof.js';

function rgba(width: number, height: number, color: [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = color[3];
  }
  return data;
}

function image(color: [number, number, number, number]): Nimi2DDecodedImage {
  return {
    width: 8,
    height: 8,
    rgba: rgba(8, 8, color),
  };
}

function imageWithAlpha(
  color: [number, number, number],
  alphaAt: (x: number, y: number) => number,
): Nimi2DDecodedImage {
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

function renderPlan(layerRefs: string[]): Nimi2DRenderPlan {
  return {
    manifest: {
      manifest_kind: 'nimi.nimi2d.package',
      schema_version: 1,
      package_id: 'n2d_agent_skin',
      package_kind: 'character_package',
      canvas: {
        width_px: 8,
        height_px: 8,
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
    sourceCanvas: {
      width: 8,
      height: 8,
    },
    canvas: {
      width: 8,
      height: 8,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('probeNimi2DCarrierVisualFrame', () => {
  it('passes when the rendered composite includes visible default outfit pixels', async () => {
    const stats = await probeNimi2DCarrierVisualFrame({
      renderPlan: renderPlan(['layer_body', 'layer_outfit']),
      gridSize: 4,
      decodeImage: async ({ layerRef }) => (
        layerRef === 'layer_outfit'
          ? image([20, 120, 220, 255])
          : image([220, 180, 160, 255])
      ),
    });

    expect(stats.visiblePixels).toBe(16);
    expect(stats.defaultOutfitVisiblePixels).toBe(16);
    expect(stats.baseBodyOnlyFrame).toBe(false);
    expect(stats.sampledPixelChecksum).toBeGreaterThan(0);
  });

  it('fails closed when only base body pixels are visible', async () => {
    await expect(probeNimi2DCarrierVisualFrame({
      renderPlan: renderPlan(['layer_body', 'layer_outfit']),
      gridSize: 4,
      decodeImage: async ({ layerRef }) => (
        layerRef === 'layer_outfit'
          ? image([0, 0, 0, 0])
          : image([220, 180, 160, 255])
      ),
    })).rejects.toBeInstanceOf(Nimi2DCarrierVisualProofError);
  });

  it('builds an alpha hit probe from composited Nimi2D package layer alpha', async () => {
    const probe = await createNimi2DAlphaHitProbe({
      renderPlan: renderPlan(['layer_body', 'layer_outfit']),
      viewport: { left: 10, top: 20, width: 80, height: 80 },
      decodeImage: async ({ layerRef }) => (
        layerRef === 'layer_outfit'
          ? imageWithAlpha([20, 120, 220], (x) => (x >= 4 ? 255 : 0))
          : image([220, 180, 160, 0])
      ),
    });

    expect(probe.defaultOutfitLayerCount).toBe(1);
    expect(probe.isOpaqueAtClientPoint(70, 60)).toBe(true);
    expect(probe.isOpaqueAtClientPoint(30, 60)).toBe(false);
    expect(probe.isOpaqueAtClientPoint(95, 60)).toBe(false);
  });

  it('applies package alpha mask assets to visual proof and hit probing', async () => {
    const maskedPlan = renderPlan(['layer_body', 'layer_outfit']);
    const outfit = maskedPlan.renderLayers.find((layer) => layer.layerRef === 'layer_outfit');
    if (!outfit) throw new Error('outfit layer missing from render plan');
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
    const decodeImage = async ({ layerRef }: { layerRef: string }): Promise<Nimi2DDecodedImage> => {
      if (layerRef === 'layer_outfit:mask') {
        return imageWithAlpha([255, 255, 255], (x) => (x >= 4 ? 255 : 0));
      }
      return layerRef === 'layer_outfit'
        ? image([20, 120, 220, 255])
        : image([220, 180, 160, 0]);
    };

    const stats = await probeNimi2DCarrierVisualFrame({
      renderPlan: maskedPlan,
      gridSize: 4,
      decodeImage,
    });
    expect(stats.visiblePixels).toBe(8);
    expect(stats.defaultOutfitVisiblePixels).toBe(8);

    const probe = await createNimi2DAlphaHitProbe({
      renderPlan: maskedPlan,
      decodeImage,
    });
    expect(probe.isOpaqueAtClientPoint(6, 4)).toBe(true);
    expect(probe.isOpaqueAtClientPoint(2, 4)).toBe(false);
  });

  it('fails closed to null when no default outfit layer is present in the hit probe', async () => {
    const probe = await createNimi2DAlphaHitProbe({
      renderPlan: renderPlan(['layer_body']),
      decodeImage: async () => image([220, 180, 160, 255]),
    });

    expect(probe.defaultOutfitLayerCount).toBe(0);
    expect(probe.isOpaqueAtClientPoint(4, 4)).toBeNull();
  });
});
