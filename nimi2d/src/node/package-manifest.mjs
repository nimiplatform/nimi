import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { validateLayerInput } from './layer-input.mjs';
import {
  PACKAGE_MANIFEST_KIND,
  sha256,
  readManifest,
  issue,
  result,
  isObject,
} from './common.mjs';
import {
  solveProvenTier,
  tier1ChannelEvidence,
} from './package-capability.mjs';
import {
  buildWardrobeAssets,
  layerAssetKind,
  layerRefsWithSemantic,
} from './package-wardrobe.mjs';
import { validatePackageObject } from './package-validator.mjs';

export async function validatePackageManifest(manifestPath) {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDir = path.dirname(absoluteManifest);
  const { value, parseError } = await readManifest(absoluteManifest);
  if (parseError || !isObject(value)) {
    const issues = [];
    issues.push(issue('NIMI2D_PACKAGE_MANIFEST_INVALID', '$', 'Package manifest cannot parse as an object.'));
    return result('package_manifest', absoluteManifest, issues);
  }
  return await validatePackageObject(value, { manifestPath: absoluteManifest, manifestDir });
}

function baseLayerRefs(input) {
  return input.layers
    .filter((layer) => !layer.semantic_labels.some((label) => ['outfit', 'accessory', 'prop', 'scene'].includes(label)))
    .map((layer) => layer.layer_id);
}

function tier0ChannelEvidence(input) {
  return {
    layer_input_lineage: { status: 'proven', ref: input.input_id },
    base_body_topology: { status: 'proven', ref: `n2d_base_body_${input.input_id}` },
    default_outfit_binding: { status: 'proven', ref: `n2d_default_outfit_${input.input_id}` },
    static_draw_order: { status: 'proven', ref: input.input_id },
  };
}

function capabilityEvidence(input, provenTier) {
  const tier0Evidence = tier0ChannelEvidence(input);
  return provenTier === 'tier-1_agent_basic'
    ? { ...tier0Evidence, ...tier1ChannelEvidence(input) }
    : tier0Evidence;
}

function packageDigest(input, requestedTier, provenTier) {
  return sha256(JSON.stringify({
    input_id: input.input_id,
    layer_hashes: input.layers.map((layer) => [layer.layer_id, layer.asset.sha256]),
    requested_tier: requestedTier,
    proven_tier: provenTier,
  }));
}

function sourceEvidence(input, layerInputPath) {
  return {
    layer_input_ref: path.basename(layerInputPath),
    layer_generation_ref: input.source_evidence.layer_generation_ref,
    occlusion_completion_ref: input.source_evidence.occlusion_completion_ref ?? null,
    identity_preservation_ref: input.source_evidence.identity_preservation_ref,
    content_admission_ref: input.source_evidence.content_admission_ref,
    anchor_solving_evidence_ref: `n2d_solver_anchor_${input.input_id}`,
    slot_solving_evidence_ref: `n2d_solver_slot_${input.input_id}`,
    wardrobe_binding_evidence_ref: `n2d_solver_wardrobe_${input.input_id}`,
    validator_evidence_ref: `n2d_validator_${input.input_id}`,
  };
}

function baseBody(input, layerRefs) {
  return {
    base_body_id: `n2d_base_body_${input.input_id}`,
    topology_id: 'nimi.nimi2d.base-body.topology',
    topology_version: 1,
    slot_taxonomy_ref: '.nimi/spec/nimi2d/kernel/tables/slot-taxonomy.yaml',
    skeleton_id: `n2d_skeleton_${input.input_id}`,
    anchor_set_id: `n2d_anchor_set_${input.input_id}`,
    slot_set_id: `n2d_slot_set_${input.input_id}`,
    anchors: input.global_anchor_hints.map((anchor) => ({
      kind: anchor.kind,
      point_px: anchor.point_px,
    })),
    slots: input.global_slot_hints.map((slot) => ({
      kind: slot.kind,
      bounds_px: slot.bounds_px,
    })),
    morphology_profile_id: `n2d_morphology_${input.input_id}`,
    deformation_topology_id: `n2d_deformation_${input.input_id}`,
    action_topology_ref: `n2d_action_topology_${input.input_id}`,
    owns_main_rig: true,
    renderable: false,
    detail_neutral: true,
    layer_refs: layerRefs,
  };
}

function renderLayers(input) {
  return input.draw_order.map((layerRef, index) => {
    const layer = input.layers.find((item) => item.layer_id === layerRef);
    return {
      layer_ref: layer.layer_id,
      asset_id: `asset_${layer.layer_id}`,
      layer_kind: layerAssetKind(layer),
      draw_order_index: index,
      placement_px: layer.placement_px,
      texture_bounds_px: layer.texture_bounds_px,
      visible_bounds_px: layer.visible_bounds_px,
    };
  });
}

function packageAssets(input) {
  return input.layers.map((layer) => ({
    asset_id: `asset_${layer.layer_id}`,
    asset_kind: layerAssetKind(layer),
    ref: layer.asset.ref,
    sha256: layer.asset.sha256,
    format: layer.asset.format,
    width_px: layer.asset.width_px,
    height_px: layer.asset.height_px,
    byte_size: layer.asset.byte_size,
    color_space: layer.asset.color_space,
    alpha_mode: layer.asset.alpha_mode,
    premultiplied_alpha: layer.asset.premultiplied_alpha,
  }));
}

function buildPackageManifest(input, layerInputPath, options) {
  const packageId = options.packageId ?? `n2d_pkg_${input.input_id.replace(/^n2d_layer_input_/, '')}`;
  const requestedTier = options.requestedTier ?? 'tier-1_agent_basic';
  const provenTier = solveProvenTier(input, requestedTier);
  const outfitLayerRefs = layerRefsWithSemantic(input, 'outfit');
  const wardrobeAssets = buildWardrobeAssets(input, outfitLayerRefs);
  return {
    manifest_kind: PACKAGE_MANIFEST_KIND,
    schema_version: 1,
    package_id: packageId,
    package_version: '0.0.0',
    package_kind: 'character_package',
    canvas: {
      width_px: input.canvas.width_px,
      height_px: input.canvas.height_px,
    },
    source: sourceEvidence(input, layerInputPath),
    integrity: {
      package_digest_sha256: packageDigest(input, requestedTier, provenTier),
      asset_count: input.layers.length,
    },
    governance: {
      base_body_renderable: false,
      default_outfit_required: true,
      adult_capability: 'unavailable_v1',
      content_admission_ref: input.source_evidence.content_admission_ref,
      underage_body_content: 'rejected_or_not_present',
    },
    capability: {
      requested_tier: requestedTier,
      proven_tier: provenTier,
      channel_matrix_ref: '.nimi/spec/nimi2d/kernel/tables/capability-channel-matrix.yaml',
      channel_evidence: capabilityEvidence(input, provenTier),
    },
    base_body: baseBody(input, baseLayerRefs(input)),
    wardrobe: {
      default_outfit_ref: `n2d_default_outfit_${input.input_id}`,
      assets: wardrobeAssets,
    },
    render_layers: renderLayers(input),
    assets: packageAssets(input),
  };
}

export async function solvePackageFromLayerInput(layerInputPath, options = {}) {
  const layerResult = await validateLayerInput(layerInputPath);
  if (layerResult.status !== 'ok') {
    return { status: 'reject', kind: 'package_solve', issues: layerResult.issues, codes: layerResult.codes };
  }
  const input = layerResult.value;
  if (input.input_kind !== 'character_skin') {
    const issues = [issue('NIMI2D_SOLVE_UNSUPPORTED_INPUT_KIND', '$.input_kind', 'The deterministic package solver currently admits only character_skin input.')];
    return { status: 'reject', kind: 'package_solve', issues, codes: ['NIMI2D_SOLVE_UNSUPPORTED_INPUT_KIND'] };
  }
  const manifest = buildPackageManifest(input, layerInputPath, options);
  const packageResult = await validatePackageObject(manifest);
  return { status: packageResult.status, kind: 'package_solve', manifest, codes: packageResult.codes, issues: packageResult.issues };
}

export async function writeSolvedPackage(layerInputPath, outPath, options = {}) {
  const solved = await solvePackageFromLayerInput(layerInputPath, options);
  if (solved.status !== 'ok') return solved;
  const serialized = YAML.stringify(solved.manifest);
  await writeFile(outPath, serialized, 'utf8');
  return { ...solved, outPath: path.resolve(outPath) };
}
