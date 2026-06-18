import path from 'node:path';
import YAML from 'yaml';

import { probeNimi2DVisualFrame } from '../proof/index.mjs';
import {
  createNimi2DAmplitudeMouthLane,
  createNimi2DComposer,
  createNimi2DRenderPlan,
} from '../runtime/index.mjs';
import {
  runNimi2DReferenceActionBench,
  runNimi2DReferenceActionStress,
} from '../reference-player/index.mjs';
import { validateBenchCorpus } from './generation-bench.mjs';
import { decodePngRgba } from './png-rgba.mjs';
import { solvePackageFromLayerInput } from './package-manifest.mjs';

function passFail(value) {
  return value ? 'pass' : 'fail';
}

function defaultOutfitLayerRefs(renderPlan) {
  const defaultOutfit = renderPlan.manifest.wardrobe.assets.find(
    (asset) => asset.wardrobe_asset_id === renderPlan.manifest.wardrobe.default_outfit_ref,
  );
  return defaultOutfit?.layer_refs ?? [];
}

async function runReferenceActionBenchForPlan(renderPlan) {
  const composer = createNimi2DComposer();
  const mouthLane = createNimi2DAmplitudeMouthLane({ composer });
  let now = 0;
  return await runNimi2DReferenceActionBench({
    backendKind: 'nimi2d',
    defaultOutfitLayerRefs: defaultOutfitLayerRefs(renderPlan),
    projection: composer,
    nowMs: () => now,
    async flush() {
      now += 16;
      composer.advanceFrame(16);
    },
    mouth: {
      setAmplitude(value) {
        mouthLane.setAmplitude(value);
      },
      async attach() {},
      silent() {
        mouthLane.silent();
      },
    },
    captureFrame() {
      const snapshot = composer.snapshot();
      return {
        timestampMs: now,
        layerRefs: renderPlan.renderLayers.map((layer) => layer.layerRef),
        activity: snapshot.activity,
        expression: snapshot.expression,
        motion: snapshot.motion,
        mouthOpen: snapshot.mouthOpen,
      };
    },
  });
}

function expectedDefaultRenderableLayerRefs(manifest) {
  const defaultOutfit = manifest.wardrobe.assets.find(
    (asset) => asset.wardrobe_asset_id === manifest.wardrobe.default_outfit_ref,
  );
  const selectedWardrobeAssets = manifest.wardrobe.assets.filter((asset) => (
    asset.wardrobe_asset_id === defaultOutfit?.wardrobe_asset_id
    || ['accessory', 'hair_variant', 'held_prop', 'scene_layer'].includes(asset.wardrobe_kind)
  ));
  return new Set([
    ...manifest.base_body.layer_refs,
    ...selectedWardrobeAssets.flatMap((asset) => asset.layer_refs),
  ]);
}

async function runMatrixCase(item, corpusDir, options) {
  const layerInputPath = path.resolve(corpusDir, item.layer_input_manifest_ref);
  const solved = await solvePackageFromLayerInput(layerInputPath, {
    packageId: `n2d_pkg_matrix_${item.case_id.replace(/^n2d_case_/, '')}`,
    requestedTier: item.target_tier,
  });
  if (solved.status !== 'ok') {
    return {
      case_id: item.case_id,
      status: 'failed_package_solve',
      target_tier: item.target_tier,
      proven_tier: 'none',
      render_layer_refs: [],
      visual_stats: null,
      reference_action_verdict: null,
      failures: solved.codes,
    };
  }

  const packageManifestRaw = YAML.stringify(solved.manifest);
  const packageManifestRef = path.resolve(path.dirname(layerInputPath), `${solved.manifest.package_id}.yaml`);
  let renderPlan;
  try {
    renderPlan = createNimi2DRenderPlan({ packageManifestRaw, packageManifestRef });
  } catch (error) {
    return {
      case_id: item.case_id,
      status: 'failed_render_plan',
      target_tier: item.target_tier,
      proven_tier: solved.manifest.capability.proven_tier,
      render_layer_refs: [],
      visual_stats: null,
      reference_action_verdict: null,
      failures: [error instanceof Error ? error.message : String(error)],
    };
  }

  const expectedRefs = expectedDefaultRenderableLayerRefs(solved.manifest);
  const renderRefs = new Set(renderPlan.renderLayers.map((layer) => layer.layerRef));
  const missingRenderableRefs = [...expectedRefs].filter((layerRef) => !renderRefs.has(layerRef));
  let visualStats = null;
  const failures = [];
  if (missingRenderableRefs.length > 0) {
    failures.push('default_renderable_layers_missing');
  }

  try {
    visualStats = await probeNimi2DVisualFrame({
      renderPlan,
      gridSize: options.gridSize,
      decodeImage: async ({ src }) => decodePngRgba(path.resolve(corpusDir, src)),
    });
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  const referenceActionResult = await runReferenceActionBenchForPlan(renderPlan);
  if (referenceActionResult.verdict === 'fail') {
    failures.push(...referenceActionResult.failures);
  }
  const referenceActionStressResult = await runNimi2DReferenceActionStress({
    backendKind: 'nimi2d',
    layerRefs: renderPlan.renderLayers.map((layer) => layer.layerRef),
    defaultOutfitLayerRefs: defaultOutfitLayerRefs(renderPlan),
  });
  if (referenceActionStressResult.verdict === 'fail') {
    failures.push(...referenceActionStressResult.failures);
  }

  return {
    case_id: item.case_id,
    status: failures.length === 0 ? 'passed' : 'failed',
    target_tier: item.target_tier,
    proven_tier: solved.manifest.capability.proven_tier,
    render_layer_refs: renderPlan.renderLayers.map((layer) => layer.layerRef),
    expected_default_renderable_layer_refs: [...expectedRefs],
    visual_stats: visualStats,
    reference_action_verdict: referenceActionResult.verdict,
    reference_action_stress_verdict: referenceActionStressResult.verdict,
    failures,
  };
}

export async function runRuntimeProofMatrix(corpusPath, options = {}) {
  const corpusResult = await validateBenchCorpus(corpusPath);
  if (corpusResult.status !== 'ok') {
    return { status: 'reject', kind: 'runtime_proof_matrix_run', codes: corpusResult.codes, issues: corpusResult.issues };
  }
  const corpus = corpusResult.value;
  const corpusDir = path.dirname(path.resolve(corpusPath));
  const selectedCases = corpus.case_splits.certified_good_tier1 ?? [];
  const selectedSet = new Set(selectedCases);
  const selectedItems = corpus.cases.filter((item) => selectedSet.has(item.case_id));
  const caseResults = [];
  for (const item of selectedItems) {
    caseResults.push(await runMatrixCase(item, corpusDir, options));
  }
  const allPassed = caseResults.every((item) => item.status === 'passed');
  const hardGateResults = {
    positive_cases_solved: passFail(caseResults.every((item) => item.proven_tier === 'tier-1_agent_basic')),
    render_plan_built: passFail(caseResults.every((item) => item.render_layer_refs.length > 0)),
    default_renderable_layers_covered: passFail(caseResults.every((item) => item.failures.includes('default_renderable_layers_missing') === false)),
    visual_proof_passed: passFail(caseResults.every((item) => item.visual_stats?.defaultOutfitVisiblePixels > 0)),
    reference_action_bench_passed: passFail(caseResults.every((item) => item.reference_action_verdict === 'pass_minimal_tier1')),
    reference_action_stress_passed: passFail(caseResults.every((item) => item.reference_action_stress_verdict === 'pass_stream_stress_tier1')),
  };
  const resultValue = {
    run_id: `n2d_runtime_proof_matrix_${corpus.corpus_id.replace(/^n2d_generation_corpus_/, '')}`,
    corpus: {
      corpus_id: corpus.corpus_id,
      corpus_version: corpus.corpus_version,
      corpus_digest_sha256: corpus.corpus_digest_sha256,
    },
    selected_cases: selectedCases,
    case_results: caseResults,
    hard_gate_results: hardGateResults,
    decision: {
      verdict: allPassed && Object.values(hardGateResults).every((status) => status === 'pass') ? 'pass' : 'fail',
      reason: allPassed ? 'All runtime/render/proof matrix gates passed.' : 'One or more runtime/render/proof matrix gates failed.',
    },
  };
  return {
    status: 'ok',
    kind: 'runtime_proof_matrix_run',
    decision: resultValue.decision,
    result: resultValue,
    codes: [],
    issues: [],
  };
}
