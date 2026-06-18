import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { sha256 } from './common.mjs';
import { encodePngRgba } from './png-rgba-encode.mjs';

const color = {
  skin: [240, 178, 143, 255],
  skinShadow: [214, 140, 112, 255],
  hairDark: [58, 44, 68, 255],
  hairLight: [132, 82, 118, 255],
  eye: [35, 56, 82, 255],
  mouth: [158, 54, 82, 255],
  outfitBlue: [54, 102, 185, 255],
  outfitRed: [184, 76, 86, 255],
  outfitGreen: [64, 145, 116, 255],
  outfitGold: [220, 170, 70, 255],
  accessory: [240, 232, 210, 255],
  prop: [92, 75, 60, 255],
};

function createLayer(width, height) {
  return new Uint8ClampedArray(width * height * 4);
}

function setPixel(rgba, width, x, y, [red, green, blue, alpha]) {
  const offset = ((y * width) + x) * 4;
  rgba[offset] = red;
  rgba[offset + 1] = green;
  rgba[offset + 2] = blue;
  rgba[offset + 3] = alpha;
}

function fillRect(rgba, width, height, rect, fill) {
  const minX = Math.max(0, Math.floor(rect.x));
  const minY = Math.max(0, Math.floor(rect.y));
  const maxX = Math.min(width, Math.ceil(rect.x + rect.width));
  const maxY = Math.min(height, Math.ceil(rect.y + rect.height));
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

function edge(a, b, c) {
  return ((c.x - a.x) * (b.y - a.y)) - ((c.y - a.y) * (b.x - a.x));
}

function rect(x, y, width, height) {
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function anchors(profile) {
  const { width, height, head, face, mouth } = profile;
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
    source: 'generated_demo',
  }));
}

function slots(profile, extra = []) {
  const { torso, outfit } = profile;
  return [
    ['torso', torso],
    ['hip', rect(torso.x + (torso.width * 0.18), torso.y + (torso.height * 0.58), torso.width * 0.64, torso.height * 0.34)],
    ['outfit_upper', rect(outfit.x, outfit.y, outfit.width, outfit.height * 0.58)],
    ['outfit_lower', rect(outfit.x + (outfit.width * 0.08), outfit.y + (outfit.height * 0.5), outfit.width * 0.84, outfit.height * 0.48)],
    ['outfit_full', outfit],
    ...extra,
  ].map(([kind, bounds]) => ({
    slot_hint_id: `slot_${kind}`,
    kind,
    bounds_px: bounds,
    source: 'generated_demo',
  }));
}

function baseProfile(id, width, height, options = {}) {
  const head = rect(width * 0.28, height * 0.12, width * 0.44, height * 0.34);
  const face = rect(head.x + (head.width * 0.16), head.y + (head.height * 0.22), head.width * 0.68, head.height * 0.56);
  const mouth = rect(face.x + (face.width * 0.36), face.y + (face.height * 0.62), face.width * 0.28, Math.max(4, face.height * 0.09));
  const torso = rect(width * 0.25, height * 0.48, width * 0.5, height * 0.34);
  const outfit = rect(width * 0.22, height * 0.46, width * 0.56, height * 0.42);
  return { id, width, height, head, face, mouth, torso, outfit, options };
}

function drawStandardLayers(profile) {
  const layers = [];
  const { width, height, head, face, mouth, torso, outfit, options } = profile;

  layers.push(renderLayer(profile, 'layer_body', ['body', 'torso'], (rgba) => {
    fillEllipse(rgba, width, height, { x: torso.x + (torso.width / 2), y: torso.y + (torso.height * 0.48) }, { x: torso.width * 0.47, y: torso.height * 0.52 }, color.skinShadow);
    fillEllipse(rgba, width, height, { x: head.x + (head.width / 2), y: head.y + (head.height / 2) }, { x: head.width * 0.48, y: head.height * 0.52 }, color.skin);
  }, options.occlusion ? {
    occlusion_fill: 'filled_by_upstream',
    occlusion_evidence_ref: `upstream.generated.${profile.id}.body_fill`,
  } : null));

  layers.push(renderLayer(profile, 'layer_head', ['head', 'face'], (rgba) => {
    fillEllipse(rgba, width, height, { x: head.x + (head.width / 2), y: head.y + (head.height / 2) }, { x: head.width * 0.44, y: head.height * 0.48 }, color.skin);
  }));

  layers.push(renderLayer(profile, 'layer_hair', ['hair'], (rgba) => {
    const hairFill = options.lightHair ? color.hairLight : color.hairDark;
    fillEllipse(rgba, width, height, { x: head.x + (head.width / 2), y: head.y + (head.height * 0.24) }, { x: head.width * 0.52, y: head.height * 0.28 }, hairFill);
    if (options.longHair) {
      fillRect(rgba, width, height, rect(head.x - (head.width * 0.08), head.y + (head.height * 0.18), head.width * 0.22, head.height * 1.28), hairFill);
      fillRect(rgba, width, height, rect(head.x + (head.width * 0.86), head.y + (head.height * 0.18), head.width * 0.22, head.height * 1.28), hairFill);
    }
  }));

  layers.push(renderLayer(profile, 'layer_eye', ['eye', 'brow'], (rgba) => {
    fillEllipse(rgba, width, height, { x: face.x + (face.width * 0.34), y: face.y + (face.height * 0.38) }, { x: face.width * 0.07, y: face.height * 0.045 }, color.eye);
    fillEllipse(rgba, width, height, { x: face.x + (face.width * 0.66), y: face.y + (face.height * 0.38) }, { x: face.width * 0.07, y: face.height * 0.045 }, color.eye);
  }));

  layers.push(renderLayer(profile, 'layer_mouth', ['mouth'], (rgba) => {
    fillEllipse(rgba, width, height, { x: mouth.x + (mouth.width / 2), y: mouth.y + (mouth.height / 2) }, { x: mouth.width * 0.52, y: Math.max(2, mouth.height * 0.72) }, color.mouth);
  }));

  layers.push(renderLayer(profile, 'layer_outfit', ['outfit'], (rgba) => {
    const outfitFill = options.outfitColor ?? color.outfitBlue;
    fillTriangle(rgba, width, height, [
      { x: outfit.x + (outfit.width * 0.12), y: outfit.y },
      { x: outfit.x + (outfit.width * 0.88), y: outfit.y },
      { x: outfit.x + (outfit.width * 0.76), y: outfit.y + outfit.height },
    ], outfitFill);
    fillTriangle(rgba, width, height, [
      { x: outfit.x + (outfit.width * 0.12), y: outfit.y },
      { x: outfit.x + (outfit.width * 0.24), y: outfit.y + outfit.height },
      { x: outfit.x + (outfit.width * 0.76), y: outfit.y + outfit.height },
    ], outfitFill);
  }));

  if (options.accessory) {
    layers.push(renderLayer(profile, 'layer_accessory', ['accessory'], (rgba) => {
      if (options.accessory === 'head') {
        fillRect(rgba, width, height, rect(head.x + (head.width * 0.18), head.y + (head.height * 0.02), head.width * 0.64, head.height * 0.12), color.accessory);
        fillRect(rgba, width, height, rect(head.x + (head.width * 0.3), head.y - (head.height * 0.12), head.width * 0.4, head.height * 0.18), color.outfitGold);
        return;
      }
      const y = face.y + (face.height * 0.38);
      fillRect(rgba, width, height, rect(face.x + (face.width * 0.22), y - 2, face.width * 0.24, 4), color.accessory);
      fillRect(rgba, width, height, rect(face.x + (face.width * 0.54), y - 2, face.width * 0.24, 4), color.accessory);
      fillRect(rgba, width, height, rect(face.x + (face.width * 0.45), y - 1, face.width * 0.1, 2), color.accessory);
    }));
  }

  if (options.prop) {
    layers.push(renderLayer(profile, 'layer_prop', ['prop'], (rgba) => {
      fillRect(rgba, width, height, rect(torso.x + torso.width * 0.74, torso.y + torso.height * 0.18, width * 0.08, height * 0.22), color.prop);
      fillEllipse(rgba, width, height, { x: torso.x + torso.width * 0.78, y: torso.y + torso.height * 0.16 }, { x: width * 0.06, y: height * 0.025 }, color.outfitGold);
    }));
  }

  return layers;
}

function renderLayer(profile, layerId, semanticLabels, paint, options = null) {
  const rgba = createLayer(profile.width, profile.height);
  paint(rgba);
  return {
    layer_id: layerId,
    semantic_labels: semanticLabels,
    rgba,
    occlusion_fill: options?.occlusion_fill ?? 'not_applicable',
    occlusion_evidence_ref: options?.occlusion_evidence_ref ?? null,
  };
}

async function writeCase(rootDir, profile, mutate = null) {
  const caseDir = path.join(rootDir, profile.id);
  await mkdir(caseDir, { recursive: true });
  const layers = drawStandardLayers(profile);
  const manifestLayers = [];
  for (const layer of layers) {
    const fileName = `${layer.layer_id}.png`;
    const png = encodePngRgba({ width: profile.width, height: profile.height, rgba: layer.rgba });
    await writeFile(path.join(caseDir, fileName), png);
    const item = {
      layer_id: layer.layer_id,
      asset: {
        ref: fileName,
        sha256: sha256(png),
        format: 'png',
        width_px: profile.width,
        height_px: profile.height,
        byte_size: png.length,
        color_space: 'srgb',
        alpha_mode: 'straight',
        premultiplied_alpha: false,
      },
      placement_px: { x: 0, y: 0 },
      texture_bounds_px: { x: 0, y: 0, width: profile.width, height: profile.height },
      visible_bounds_px: { x: 0, y: 0, width: profile.width, height: profile.height },
      semantic_labels: layer.semantic_labels,
      occlusion_fill: layer.occlusion_fill,
    };
    if (layer.occlusion_evidence_ref) {
      item.occlusion_evidence_ref = layer.occlusion_evidence_ref;
    }
    manifestLayers.push(item);
  }

  const extraSlots = [];
  if (profile.options.accessory === 'head') {
    extraSlots.push(['accessory_head', rect(profile.head.x, Math.max(0, profile.head.y - profile.head.height * 0.14), profile.head.width, profile.head.height * 0.28)]);
  } else if (profile.options.accessory) {
    extraSlots.push(['accessory_face', rect(profile.face.x, profile.face.y, profile.face.width, profile.face.height * 0.52)]);
  }
  if (profile.options.prop) extraSlots.push(['prop_hand', rect(profile.torso.x + profile.torso.width * 0.68, profile.torso.y + profile.torso.height * 0.12, profile.width * 0.18, profile.height * 0.32)]);
  const sourceEvidence = {
    layer_generation_ref: `upstream.generated.${profile.id}.layer_generation`,
    identity_preservation_ref: `upstream.generated.${profile.id}.identity`,
    content_admission_ref: `upstream.generated.${profile.id}.content`,
  };
  if (profile.options.occlusion) {
    sourceEvidence.occlusion_completion_ref = `upstream.generated.${profile.id}.occlusion_completion`;
  }
  const manifest = {
    manifest_kind: 'nimi.nimi2d.layer-input',
    schema_version: 1,
    input_id: `n2d_layer_input_demo_${profile.id.replaceAll('-', '_')}`,
    input_kind: 'character_skin',
    canvas: {
      width_px: profile.width,
      height_px: profile.height,
      background: 'transparent',
    },
    coordinate_space: {
      origin: 'top_left',
      unit: 'px',
      axis: 'x_right_y_down',
      overflow_policy: 'reject',
    },
    source_evidence: sourceEvidence,
    layers: manifestLayers,
    draw_order: manifestLayers.map((layer) => layer.layer_id),
    global_anchor_hints: anchors(profile),
    global_slot_hints: slots(profile, extraSlots),
  };
  const finalManifest = mutate ? mutate(structuredClone(manifest)) : manifest;
  const serialized = YAML.stringify(finalManifest);
  await writeFile(path.join(caseDir, 'layer-input.yaml'), serialized, 'utf8');
  return {
    case_id: `n2d_case_demo_${profile.id.replaceAll('-', '_')}`,
    split: mutate ? 'invalid_contract' : 'certified_good_tier1',
    layer_input_manifest_ref: `${profile.id}/layer-input.yaml`,
    content_hash_sha256: sha256(serialized),
    expected_outcome: mutate ? 'reject' : 'admit',
    target_tier: 'tier-1_agent_basic',
    source_evidence: sourceEvidence,
    distribution_tags: profile.options.tags ?? [],
  };
}

function demoProfiles() {
  return [
    baseProfile('portrait-simple', 128, 128, { tags: ['portrait', 'simple_hair'] }),
    baseProfile('portrait-glasses', 128, 128, { accessory: 'face', tags: ['portrait', 'accessory_face'] }),
    baseProfile('long-hair-occlusion', 144, 160, { longHair: true, occlusion: true, outfitColor: color.outfitRed, tags: ['long_hair', 'upstream_occlusion_filled'] }),
    baseProfile('full-body-prop', 144, 192, { prop: true, outfitColor: color.outfitGreen, tags: ['full_body', 'held_prop'] }),
    baseProfile('large-canvas-hat', 192, 256, { accessory: 'head', lightHair: true, outfitColor: color.outfitGold, tags: ['large_canvas', 'accessory_head'] }),
    baseProfile('compact-agent', 96, 128, { outfitColor: color.outfitRed, tags: ['compact_canvas'] }),
    baseProfile('wide-shoulder-agent', 160, 144, { accessory: 'face', outfitColor: color.outfitGreen, tags: ['wide_canvas', 'accessory_face'] }),
    baseProfile('occluded-prop-agent', 160, 192, { longHair: true, occlusion: true, prop: true, tags: ['upstream_occlusion_filled', 'held_prop'] }),
  ];
}

function negativeMutations() {
  return [
    ['invalid-missing-outfit', (manifest) => ({
      ...manifest,
      layers: manifest.layers.filter((layer) => !layer.semantic_labels.includes('outfit')),
      draw_order: manifest.draw_order.filter((layerId) => layerId !== 'layer_outfit'),
    }), ['NIMI2D_LAYER_INPUT_REQUIRED_SEMANTIC_COVERAGE_MISSING']],
    ['invalid-missing-mouth-anchor', (manifest) => ({
      ...manifest,
      global_anchor_hints: manifest.global_anchor_hints.filter((anchor) => anchor.kind !== 'mouth_center'),
    }), ['NIMI2D_LAYER_INPUT_ANCHOR_HINT_MISSING']],
    ['invalid-draw-order', (manifest) => ({
      ...manifest,
      draw_order: manifest.draw_order.map((layerId, index) => (index === manifest.draw_order.length - 1 ? manifest.draw_order[index - 1] : layerId)),
    }), ['NIMI2D_LAYER_INPUT_DRAW_ORDER_INVALID']],
    ['invalid-raw-image-field', (manifest) => ({
      ...manifest,
      raw_image_ref: 'forbidden-source.png',
    }), ['NIMI2D_LAYER_INPUT_RAW_IMAGE_FORBIDDEN']],
    ['invalid-occlusion-evidence', (manifest) => {
      const next = structuredClone(manifest);
      next.layers[0].occlusion_fill = 'filled_by_upstream';
      delete next.layers[0].occlusion_evidence_ref;
      delete next.source_evidence.occlusion_completion_ref;
      return next;
    }, ['NIMI2D_LAYER_INPUT_OCCLUSION_EVIDENCE_MISSING']],
  ];
}

export async function generateDemoCorpus(outputDir) {
  const absolute = path.resolve(outputDir);
  await rm(absolute, { recursive: true, force: true });
  await mkdir(absolute, { recursive: true });

  const cases = [];
  for (const profile of demoProfiles()) {
    cases.push(await writeCase(absolute, profile));
  }
  for (const [id, mutate, expectedRejectCodes] of negativeMutations()) {
    const profile = baseProfile(id, 128, 128, { tags: ['generated_negative_boundary'] });
    const item = await writeCase(absolute, profile, mutate);
    item.expected_reject_codes = expectedRejectCodes;
    item.distribution_tags = ['generated_negative_boundary'];
    cases.push(item);
  }

  const positiveIds = cases.filter((item) => item.expected_outcome === 'admit').map((item) => item.case_id);
  const negativeIds = cases.filter((item) => item.expected_outcome === 'reject').map((item) => item.case_id);
  const corpusDigest = sha256(JSON.stringify(cases.map((item) => ({
    case_id: item.case_id,
    content_hash_sha256: item.content_hash_sha256,
    expected_outcome: item.expected_outcome,
    target_tier: item.target_tier,
  }))));
  const corpus = {
    corpus_id: 'n2d_generation_corpus_generated_demo_agents',
    corpus_version: '0.0.0',
    corpus_digest_sha256: corpusDigest,
    frozen: true,
    created_at: '2026-06-17T00:00:00Z',
    case_splits: {
      certified_good_tier1: positiveIds,
      invalid_contract: negativeIds,
    },
    cases,
  };
  const corpusPath = path.join(absolute, 'corpus.yaml');
  await writeFile(corpusPath, YAML.stringify(corpus), 'utf8');
  return {
    status: 'ok',
    kind: 'demo_corpus_generation',
    outputDir: absolute,
    corpusPath,
    positiveCaseCount: positiveIds.length,
    negativeCaseCount: negativeIds.length,
    corpusDigest,
  };
}
