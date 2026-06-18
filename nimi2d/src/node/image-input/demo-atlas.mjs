import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { sha256 } from '../common-utils.mjs';
import { encodePngRgba } from '../png-rgba-encode.mjs';
import { ATLAS_SPEC_KIND } from './atlas-spec.mjs';

const key = [0, 255, 0, 255];
const color = {
  skin: [240, 178, 143, 255],
  skinShadow: [214, 140, 112, 255],
  hair: [64, 44, 72, 255],
  eye: [35, 56, 82, 255],
  mouth: [158, 54, 82, 255],
  outfit: [54, 102, 185, 255],
};

function rect(x, y, width, height) {
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function setPixel(rgba, width, x, y, fill) {
  const offset = ((y * width) + x) * 4;
  rgba[offset] = fill[0];
  rgba[offset + 1] = fill[1];
  rgba[offset + 2] = fill[2];
  rgba[offset + 3] = fill[3];
}

function fillRect(rgba, width, height, area, fill) {
  const minX = Math.max(0, Math.floor(area.x));
  const minY = Math.max(0, Math.floor(area.y));
  const maxX = Math.min(width, Math.ceil(area.x + area.width));
  const maxY = Math.min(height, Math.ceil(area.y + area.height));
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      setPixel(rgba, width, x, y, fill);
    }
  }
}

function fillEllipse(rgba, width, height, center, radius, fill) {
  const minX = Math.max(0, Math.floor(center.x - radius.x));
  const minY = Math.max(0, Math.floor(center.y - radius.y));
  const maxX = Math.min(width - 1, Math.ceil(center.x + radius.x));
  const maxY = Math.min(height - 1, Math.ceil(center.y + radius.y));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = (x - center.x) / radius.x;
      const dy = (y - center.y) / radius.y;
      if ((dx * dx) + (dy * dy) <= 1) {
        setPixel(rgba, width, x, y, fill);
      }
    }
  }
}

function fillTriangle(rgba, width, height, points, fill) {
  const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...points.map((point) => point.x))));
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((point) => point.y))));
  const edge = (a, b, c) => ((c.x - a.x) * (b.y - a.y)) - ((c.y - a.y) * (b.x - a.x));
  const area = edge(points[0], points[1], points[2]);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const point = { x, y };
      const w0 = edge(points[1], points[2], point);
      const w1 = edge(points[2], points[0], point);
      const w2 = edge(points[0], points[1], point);
      if (area >= 0 ? (w0 >= 0 && w1 >= 0 && w2 >= 0) : (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
        setPixel(rgba, width, x, y, fill);
      }
    }
  }
}

function paintCell(atlas, atlasWidth, cell, paint) {
  const local = new Uint8ClampedArray(cell.width * cell.height * 4);
  for (let index = 0; index < local.length; index += 4) {
    local[index] = key[0];
    local[index + 1] = key[1];
    local[index + 2] = key[2];
    local[index + 3] = key[3];
  }
  paint(local, cell.width, cell.height);
  for (let y = 0; y < cell.height; y += 1) {
    for (let x = 0; x < cell.width; x += 1) {
      const sourceOffset = ((y * cell.width) + x) * 4;
      const targetOffset = (((cell.y + y) * atlasWidth) + cell.x + x) * 4;
      atlas[targetOffset] = local[sourceOffset];
      atlas[targetOffset + 1] = local[sourceOffset + 1];
      atlas[targetOffset + 2] = local[sourceOffset + 2];
      atlas[targetOffset + 3] = local[sourceOffset + 3];
    }
  }
}

function baseGeometry(width, height) {
  const head = rect(width * 0.28, height * 0.12, width * 0.44, height * 0.34);
  const face = rect(head.x + (head.width * 0.16), head.y + (head.height * 0.22), head.width * 0.68, head.height * 0.56);
  const mouth = rect(face.x + (face.width * 0.36), face.y + (face.height * 0.62), face.width * 0.28, Math.max(4, face.height * 0.09));
  const torso = rect(width * 0.25, height * 0.48, width * 0.5, height * 0.34);
  const outfit = rect(width * 0.22, height * 0.46, width * 0.56, height * 0.42);
  return { head, face, mouth, torso, outfit };
}

function anchors(width, height, geometry) {
  const { head, face, mouth } = geometry;
  return [
    ['body_root', { x: width / 2, y: height * 0.84 }],
    ['neck_base', { x: width / 2, y: head.y + (head.height * 0.82) }],
    ['head_center', { x: head.x + (head.width / 2), y: head.y + (head.height / 2) }],
    ['face_center', { x: face.x + (face.width / 2), y: face.y + (face.height / 2) }],
    ['left_eye_center', { x: face.x + (face.width * 0.34), y: face.y + (face.height * 0.38) }],
    ['right_eye_center', { x: face.x + (face.width * 0.66), y: face.y + (face.height * 0.38) }],
    ['mouth_center', { x: mouth.x + (mouth.width / 2), y: mouth.y + (mouth.height / 2) }],
  ].map(([kind, point]) => ({
    anchor_id: `anchor_${kind}`,
    kind,
    point_px: { x: Math.round(point.x), y: Math.round(point.y) },
    source: 'image_input_demo_atlas',
  }));
}

function slots(geometry) {
  const { torso, outfit } = geometry;
  return [
    ['torso', torso],
    ['hip', rect(torso.x + (torso.width * 0.18), torso.y + (torso.height * 0.58), torso.width * 0.64, torso.height * 0.34)],
    ['outfit_upper', rect(outfit.x, outfit.y, outfit.width, outfit.height * 0.58)],
    ['outfit_lower', rect(outfit.x + (outfit.width * 0.08), outfit.y + (outfit.height * 0.5), outfit.width * 0.84, outfit.height * 0.48)],
    ['outfit_full', outfit],
  ].map(([kind, bounds]) => ({
    slot_hint_id: `slot_${kind}`,
    kind,
    bounds_px: bounds,
    source: 'image_input_demo_atlas',
  }));
}

function layerDefinitions(width, height, geometry) {
  const { head, face, mouth, torso, outfit } = geometry;
  return [
    {
      layer_id: 'layer_body',
      cell: { column: 0, row: 0 },
      semantic_labels: ['body', 'torso'],
      paint(rgba) {
        fillEllipse(rgba, width, height, { x: torso.x + (torso.width / 2), y: torso.y + (torso.height * 0.48) }, { x: torso.width * 0.47, y: torso.height * 0.52 }, color.skinShadow);
        fillEllipse(rgba, width, height, { x: head.x + (head.width / 2), y: head.y + (head.height / 2) }, { x: head.width * 0.48, y: head.height * 0.52 }, color.skin);
      },
    },
    {
      layer_id: 'layer_head',
      cell: { column: 1, row: 0 },
      semantic_labels: ['head', 'face'],
      paint(rgba) {
        fillEllipse(rgba, width, height, { x: head.x + (head.width / 2), y: head.y + (head.height / 2) }, { x: head.width * 0.44, y: head.height * 0.48 }, color.skin);
      },
    },
    {
      layer_id: 'layer_hair',
      cell: { column: 2, row: 0 },
      semantic_labels: ['hair'],
      paint(rgba) {
        fillEllipse(rgba, width, height, { x: head.x + (head.width / 2), y: head.y + (head.height * 0.22) }, { x: head.width * 0.54, y: head.height * 0.26 }, color.hair);
        fillRect(rgba, width, height, rect(head.x - (head.width * 0.04), head.y + (head.height * 0.18), head.width * 0.18, head.height * 0.76), color.hair);
        fillRect(rgba, width, height, rect(head.x + (head.width * 0.86), head.y + (head.height * 0.18), head.width * 0.18, head.height * 0.76), color.hair);
      },
    },
    {
      layer_id: 'layer_eye',
      cell: { column: 0, row: 1 },
      semantic_labels: ['eye', 'brow'],
      paint(rgba) {
        fillEllipse(rgba, width, height, { x: face.x + (face.width * 0.34), y: face.y + (face.height * 0.38) }, { x: face.width * 0.07, y: face.height * 0.045 }, color.eye);
        fillEllipse(rgba, width, height, { x: face.x + (face.width * 0.66), y: face.y + (face.height * 0.38) }, { x: face.width * 0.07, y: face.height * 0.045 }, color.eye);
      },
    },
    {
      layer_id: 'layer_mouth',
      cell: { column: 1, row: 1 },
      semantic_labels: ['mouth'],
      paint(rgba) {
        fillEllipse(rgba, width, height, { x: mouth.x + (mouth.width / 2), y: mouth.y + (mouth.height / 2) }, { x: mouth.width * 0.52, y: Math.max(2, mouth.height * 0.72) }, color.mouth);
      },
    },
    {
      layer_id: 'layer_outfit',
      cell: { column: 2, row: 1 },
      semantic_labels: ['outfit'],
      paint(rgba) {
        fillTriangle(rgba, width, height, [
          { x: outfit.x + (outfit.width * 0.12), y: outfit.y },
          { x: outfit.x + (outfit.width * 0.88), y: outfit.y },
          { x: outfit.x + (outfit.width * 0.76), y: outfit.y + outfit.height },
        ], color.outfit);
        fillTriangle(rgba, width, height, [
          { x: outfit.x + (outfit.width * 0.12), y: outfit.y },
          { x: outfit.x + (outfit.width * 0.24), y: outfit.y + outfit.height },
          { x: outfit.x + (outfit.width * 0.76), y: outfit.y + outfit.height },
        ], color.outfit);
      },
    },
  ];
}

async function generateDemoAtlas(outputDir) {
  const outputRoot = path.resolve(outputDir);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const width = 128;
  const height = 128;
  const columns = 3;
  const rows = 2;
  const atlasWidth = width * columns;
  const atlasHeight = height * rows;
  const atlas = new Uint8ClampedArray(atlasWidth * atlasHeight * 4);
  for (let index = 0; index < atlas.length; index += 4) {
    atlas[index] = key[0];
    atlas[index + 1] = key[1];
    atlas[index + 2] = key[2];
    atlas[index + 3] = key[3];
  }
  const geometry = baseGeometry(width, height);
  const layers = layerDefinitions(width, height, geometry);
  for (const layer of layers) {
    paintCell(atlas, atlasWidth, {
      x: layer.cell.column * width,
      y: layer.cell.row * height,
      width,
      height,
    }, layer.paint);
  }
  const atlasPng = encodePngRgba({ width: atlasWidth, height: atlasHeight, rgba: atlas });
  const atlasPath = path.join(outputRoot, 'atlas.png');
  await writeFile(atlasPath, atlasPng);

  const layerContract = layers.map((layer) => ({
    layer_id: layer.layer_id,
    cell: layer.cell,
    semantic_labels: layer.semantic_labels,
    placement_px: { x: 0, y: 0 },
    texture_bounds_px: { x: 0, y: 0, width, height },
    visible_bounds_px: { x: 0, y: 0, width, height },
    occlusion_fill: 'not_applicable',
  }));
  const spec = {
    manifest_kind: ATLAS_SPEC_KIND,
    schema_version: 1,
    atlas_id: 'demo_codex_orchestrated_atlas',
    atlas_image_ref: 'atlas.png',
    input_id: 'n2d_layer_input_image_demo_codex_orchestrated_atlas',
    input_kind: 'character_skin',
    canvas: {
      width_px: width,
      height_px: height,
      background: 'transparent',
    },
    cell: {
      width_px: width,
      height_px: height,
      columns,
      rows,
      origin_px: { x: 0, y: 0 },
      gap_px: { x: 0, y: 0 },
    },
    background: {
      kind: 'chroma_key',
      chroma_key_rgb: key.slice(0, 3),
      tolerance: 0,
    },
    source_evidence: {
      layer_generation_ref: 'upstream.image2.demo_codex_orchestrated_atlas.layer_generation',
      identity_preservation_ref: 'upstream.image2.demo_codex_orchestrated_atlas.identity',
      content_admission_ref: 'upstream.image2.demo_codex_orchestrated_atlas.content',
    },
    layers: layerContract,
    draw_order: layerContract.map((layer) => layer.layer_id),
    global_anchor_hints: anchors(width, height, geometry),
    global_slot_hints: slots(geometry),
  };
  const specPath = path.join(outputRoot, 'atlas-spec.yaml');
  await writeFile(specPath, YAML.stringify(spec), 'utf8');
  return {
    status: 'ok',
    kind: 'demo_layer_atlas_generation',
    outputDir: outputRoot,
    atlasPath,
    atlasSpecPath: specPath,
    atlasSha256: sha256(atlasPng),
    layerCellCount: layers.length,
  };
}

export { generateDemoAtlas };
