import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { decodePngRgba } from '../png-rgba.mjs';
import { encodePngRgba } from '../png-rgba-encode.mjs';
import { validateAtlasSpec } from './atlas-spec.mjs';
import { writeLayerInputFromAtlasCuts } from './layer-input-writer.mjs';

function atlasCellBounds(spec, layer) {
  const { cell } = spec;
  const x = cell.origin_px.x + (layer.cell.column * (cell.width_px + cell.gap_px.x));
  const y = cell.origin_px.y + (layer.cell.row * (cell.height_px + cell.gap_px.y));
  return {
    x,
    y,
    width: cell.width_px,
    height: cell.height_px,
  };
}

function assertAtlasContainsCell(atlas, bounds, layerId) {
  if (bounds.x < 0
    || bounds.y < 0
    || bounds.x + bounds.width > atlas.width
    || bounds.y + bounds.height > atlas.height) {
    throw new Error(`Nimi2D atlas layer ${layerId} cell is outside atlas image bounds.`);
  }
}

function chromaDistance(pixel, key) {
  return Math.max(
    Math.abs(pixel.red - key[0]),
    Math.abs(pixel.green - key[1]),
    Math.abs(pixel.blue - key[2]),
  );
}

function applyBackground(spec, rgba, pixelOffset) {
  const background = spec.background;
  if (background.kind !== 'chroma_key') return;
  const pixel = {
    red: rgba[pixelOffset],
    green: rgba[pixelOffset + 1],
    blue: rgba[pixelOffset + 2],
  };
  if (chromaDistance(pixel, background.chroma_key_rgb) <= background.tolerance) {
    rgba[pixelOffset] = 0;
    rgba[pixelOffset + 1] = 0;
    rgba[pixelOffset + 2] = 0;
    rgba[pixelOffset + 3] = 0;
  }
}

function cropLayer(spec, atlas, layer) {
  const bounds = atlasCellBounds(spec, layer);
  assertAtlasContainsCell(atlas, bounds, layer.layer_id);
  const rgba = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const sourceOffset = (((bounds.y + y) * atlas.width) + bounds.x + x) * 4;
      const targetOffset = ((y * bounds.width) + x) * 4;
      rgba[targetOffset] = atlas.rgba[sourceOffset];
      rgba[targetOffset + 1] = atlas.rgba[sourceOffset + 1];
      rgba[targetOffset + 2] = atlas.rgba[sourceOffset + 2];
      rgba[targetOffset + 3] = atlas.rgba[sourceOffset + 3];
      applyBackground(spec, rgba, targetOffset);
    }
  }
  return encodePngRgba({
    width: bounds.width,
    height: bounds.height,
    rgba,
  });
}

async function cutLayerAtlas(atlasSpecPath, outputDir, options = {}) {
  const specResult = await validateAtlasSpec(atlasSpecPath);
  if (specResult.status !== 'ok') {
    return {
      status: 'reject',
      kind: 'image_input_atlas_cut',
      codes: specResult.codes,
      issues: specResult.issues,
    };
  }
  const spec = specResult.value;
  const specDir = path.dirname(path.resolve(atlasSpecPath));
  const outputRoot = path.resolve(outputDir);
  if (options.clean === true) {
    await rm(outputRoot, { recursive: true, force: true });
  }
  await mkdir(outputRoot, { recursive: true });
  const atlasPath = path.resolve(specDir, spec.atlas_image_ref);
  const atlas = await decodePngRgba(atlasPath);
  const layerPngs = spec.draw_order.map((layerId) => {
    const layer = spec.layers.find((item) => item.layer_id === layerId);
    return {
      layer_id: layerId,
      png: cropLayer(spec, atlas, layer),
    };
  });
  const written = await writeLayerInputFromAtlasCuts({
    spec,
    layerPngs,
    outputDir: outputRoot,
  });
  return {
    status: 'ok',
    kind: 'image_input_atlas_cut',
    atlasSpecPath: path.resolve(atlasSpecPath),
    atlasPath,
    outputDir: outputRoot,
    layerInputManifestPath: written.manifestPath,
    layerAssetCount: layerPngs.length,
    contentHashSha256: written.contentHashSha256,
    codes: [],
    issues: [],
  };
}

export { cutLayerAtlas };
