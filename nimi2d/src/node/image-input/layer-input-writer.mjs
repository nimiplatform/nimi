import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { LAYER_MANIFEST_KIND } from '../common-constants.mjs';
import { sha256 } from '../common-utils.mjs';

function assetManifest(ref, png, canvas) {
  return {
    ref,
    sha256: sha256(png),
    format: 'png',
    width_px: canvas.width_px,
    height_px: canvas.height_px,
    byte_size: png.length,
    color_space: 'srgb',
    alpha_mode: 'straight',
    premultiplied_alpha: false,
  };
}

function layerManifestItem(layer, asset) {
  const item = {
    layer_id: layer.layer_id,
    asset,
    placement_px: layer.placement_px,
    texture_bounds_px: layer.texture_bounds_px,
    visible_bounds_px: layer.visible_bounds_px,
    semantic_labels: layer.semantic_labels,
    occlusion_fill: layer.occlusion_fill,
  };
  if (layer.occlusion_evidence_ref) {
    item.occlusion_evidence_ref = layer.occlusion_evidence_ref;
  }
  return item;
}

async function writeLayerInputFromAtlasCuts(input) {
  const outputDir = path.resolve(input.outputDir);
  const layersDir = path.join(outputDir, 'layers');
  await mkdir(layersDir, { recursive: true });

  const layerById = new Map(input.spec.layers.map((layer) => [layer.layer_id, layer]));
  const manifestLayers = [];
  for (const item of input.layerPngs) {
    const layer = layerById.get(item.layer_id);
    if (!layer) {
      throw new Error(`Nimi2D atlas cutter produced unknown layer ${item.layer_id}`);
    }
    const ref = `layers/${item.layer_id}.png`;
    await writeFile(path.join(outputDir, ref), item.png);
    manifestLayers.push(layerManifestItem(layer, assetManifest(ref, item.png, input.spec.canvas)));
  }

  const manifest = {
    manifest_kind: LAYER_MANIFEST_KIND,
    schema_version: 1,
    input_id: input.spec.input_id,
    input_kind: input.spec.input_kind,
    canvas: input.spec.canvas,
    coordinate_space: {
      origin: 'top_left',
      unit: 'px',
      axis: 'x_right_y_down',
      overflow_policy: 'reject',
    },
    source_evidence: input.spec.source_evidence,
    layers: input.spec.draw_order.map((layerId) => {
      const item = manifestLayers.find((layer) => layer.layer_id === layerId);
      if (!item) throw new Error(`Nimi2D atlas cutter missing draw-order layer ${layerId}`);
      return item;
    }),
    draw_order: input.spec.draw_order,
    global_anchor_hints: input.spec.global_anchor_hints,
    global_slot_hints: input.spec.global_slot_hints,
  };
  const serialized = YAML.stringify(manifest);
  const manifestPath = path.join(outputDir, 'layer-input.yaml');
  await writeFile(manifestPath, serialized, 'utf8');
  return {
    manifest,
    manifestPath,
    contentHashSha256: sha256(serialized),
  };
}

export { writeLayerInputFromAtlasCuts };
