import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');
const fixtureDir = path.join(packageRoot, 'fixtures/basic-character');
const layerInputPath = path.join(fixtureDir, 'layer-input.yaml');
const corpusPath = path.join(fixtureDir, 'corpus.yaml');

async function runCli(args) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
  });
  return JSON.parse(stdout);
}

test('CLI runs standalone fixture validate, solve, render-plan, proof, and benches', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-cli-'));
  const packagePath = path.join(tempDir, 'package.yaml');
  const inspectionPath = path.join(tempDir, 'package-inspection.yaml');
  const layerInspectionDir = path.join(tempDir, 'layer-inspection');
  const benchResultPath = path.join(tempDir, 'generation-bench-result.yaml');
  await copyFile(path.join(fixtureDir, 'pixel.png'), path.join(tempDir, 'pixel.png'));

  const layerValidation = await runCli(['validate-layer-input', layerInputPath]);
  assert.equal(layerValidation.status, 'ok');

  const solved = await runCli(['solve-package', layerInputPath, '--out', packagePath]);
  assert.equal(solved.status, 'ok');
  assert.equal(solved.outPath, packagePath);

  const packageValidation = await runCli(['validate-package', packagePath]);
  assert.equal(packageValidation.status, 'ok');

  const renderPlan = await runCli(['render-plan', packagePath]);
  assert.equal(renderPlan.status, 'ok');
  assert.deepEqual(renderPlan.renderPlan.renderLayers.map((layer) => layer.layerRef), [
    'layer_body',
    'layer_head',
    'layer_eye',
    'layer_mouth',
    'layer_outfit',
  ]);

  const visualProof = await runCli(['prove-visual-frame', packagePath, '--grid-size', '2']);
  assert.equal(visualProof.status, 'ok');
  assert.equal(visualProof.stats.visiblePixels, 4);
  assert.equal(visualProof.stats.defaultOutfitVisiblePixels, 4);

  const inspection = await runCli(['inspect-package', packagePath, '--grid-size', '2', '--out', inspectionPath]);
  assert.equal(inspection.status, 'ok');
  assert.equal(inspection.decision.verdict, 'pass');
  assert.equal(inspection.report.validation.status, 'ok');
  assert.equal(inspection.report.render_plan.status, 'pass');
  assert.equal(inspection.report.visual_proof.status, 'pass');
  assert.equal(inspection.report.reference_action.status, 'pass');
  assert.equal(inspection.report.reference_action.closes_production_avatar_readiness, false);
  assert.equal(inspection.report.gates.tier1_proven, 'pass');
  const writtenInspection = await readFile(inspectionPath, 'utf8');
  assert.equal(writtenInspection.includes('manifest_kind: nimi.nimi2d.package-inspection-report'), true);

  const layerInspection = await runCli([
    'inspect-layer-input',
    layerInputPath,
    '--out-dir', layerInspectionDir,
    '--grid-size', '2',
  ]);
  assert.equal(layerInspection.status, 'ok');
  assert.equal(layerInspection.kind, 'layer_input_full_chain_inspection');
  assert.equal(layerInspection.decision.verdict, 'pass');
  assert.equal(layerInspection.outPath, path.join(layerInspectionDir, 'layer-input-full-chain-report.yaml'));
  assert.equal(layerInspection.report.gates.layer_input_valid, 'pass');
  assert.equal(layerInspection.report.gates.package_solved, 'pass');
  assert.equal(layerInspection.report.gates.package_valid, 'pass');
  assert.equal(layerInspection.report.gates.visual_proof_passed, 'pass');
  assert.equal(layerInspection.report.gates.reference_action_passed, 'pass');
  assert.equal(layerInspection.report.boundary.closes_production_avatar_readiness, false);
  assert.equal(layerInspection.report.outputs.package_manifest_path, 'package.yaml');
  assert.equal(layerInspection.report.outputs.package_inspection_report_path, 'package-inspection.yaml');
  const writtenLayerInspection = await readFile(layerInspection.outPath, 'utf8');
  assert.equal(writtenLayerInspection.includes('manifest_kind: nimi.nimi2d.layer-input-full-chain-report'), true);

  const referenceBench = await runCli(['run-reference-action-bench', packagePath]);
  assert.equal(referenceBench.status, 'ok');
  assert.equal(referenceBench.kind, 'reference_action_bench_run');
  assert.equal(referenceBench.result.verdict, 'pass_minimal_tier1');
  assert.equal(referenceBench.result.closesGenerationBench, false);
  assert.equal(referenceBench.result.closesMountedVisualProof, false);

  const referenceStress = await runCli(['run-reference-action-stress', packagePath]);
  assert.equal(referenceStress.status, 'ok');
  assert.equal(referenceStress.kind, 'reference_action_stress_run');
  assert.equal(referenceStress.result.verdict, 'pass_stream_stress_tier1');
  assert.equal(referenceStress.result.metrics.rejectedInvalidEventCount, 1);

  const benchCorpus = await runCli(['validate-bench-corpus', corpusPath]);
  assert.equal(benchCorpus.status, 'ok');

  const generationBench = await runCli(['run-generation-bench', corpusPath, '--out', benchResultPath]);
  assert.equal(generationBench.status, 'ok');
  assert.equal(generationBench.decision.verdict, 'go');
  assert.equal(generationBench.result.selected_cases.length, 8);
  assert.equal(generationBench.result.case_results.filter((item) => item.status === 'admitted').length, 3);
  assert.equal(generationBench.result.case_results.filter((item) => item.status === 'rejected').length, 5);
  assert.equal(generationBench.result.hard_gate_results.invalid_fixtures_typed_reject, 'pass');
  assert.equal(generationBench.result.tracking_metrics.upstream_occlusion_pass_rate.status, 'upstream_only_not_measured');
  const writtenBench = await readFile(benchResultPath, 'utf8');
  assert.equal(writtenBench.includes('run_id: n2d_generation_bench_run_basic_character'), true);

  const runtimeMatrix = await runCli(['run-runtime-proof-matrix', corpusPath, '--grid-size', '4']);
  assert.equal(runtimeMatrix.status, 'ok');
  assert.equal(runtimeMatrix.decision.verdict, 'pass');
  assert.equal(runtimeMatrix.result.selected_cases.length, 3);
  assert.equal(runtimeMatrix.result.case_results.every((item) => item.status === 'passed'), true);
  assert.equal(runtimeMatrix.result.hard_gate_results.default_renderable_layers_covered, 'pass');
  assert.equal(runtimeMatrix.result.hard_gate_results.visual_proof_passed, 'pass');
  assert.equal(runtimeMatrix.result.hard_gate_results.reference_action_bench_passed, 'pass');
  assert.equal(runtimeMatrix.result.hard_gate_results.reference_action_stress_passed, 'pass');
});

test('CLI generates representative demo layer-input corpus and admits it through package gates', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-demo-corpus-'));
  const generated = await runCli(['generate-demo-corpus', tempDir]);
  assert.equal(generated.status, 'ok');
  assert.equal(generated.kind, 'demo_corpus_generation');
  assert.equal(generated.outputDir, tempDir);
  assert.equal(generated.positiveCaseCount, 8);
  assert.equal(generated.negativeCaseCount, 5);

  const generatedCorpusPath = path.join(tempDir, 'corpus.yaml');
  const benchCorpus = await runCli(['validate-bench-corpus', generatedCorpusPath]);
  assert.equal(benchCorpus.status, 'ok');
  assert.equal(benchCorpus.value.case_splits.certified_good_tier1.length, 8);
  assert.equal(benchCorpus.value.case_splits.invalid_contract.length, 5);

  const sampleLayer = await runCli(['validate-layer-input', path.join(tempDir, 'long-hair-occlusion/layer-input.yaml')]);
  assert.equal(sampleLayer.status, 'ok');
  assert.equal(sampleLayer.value.source_evidence.occlusion_completion_ref.includes('upstream.generated.long-hair-occlusion'), true);

  const generationBench = await runCli(['run-generation-bench', generatedCorpusPath]);
  assert.equal(generationBench.status, 'ok');
  assert.equal(generationBench.decision.verdict, 'go');
  assert.equal(generationBench.result.selected_cases.length, 13);
  assert.equal(generationBench.result.case_results.filter((item) => item.status === 'admitted').length, 8);
  assert.equal(generationBench.result.case_results.filter((item) => item.status === 'rejected').length, 5);
  assert.equal(generationBench.result.hard_gate_results.invalid_fixtures_typed_reject, 'pass');
  assert.equal(generationBench.result.tracking_metrics.upstream_occlusion_pass_rate.status, 'upstream_only_not_measured');

  const runtimeMatrix = await runCli(['run-runtime-proof-matrix', generatedCorpusPath, '--grid-size', '4']);
  assert.equal(runtimeMatrix.status, 'ok');
  assert.equal(runtimeMatrix.decision.verdict, 'pass');
  assert.equal(runtimeMatrix.result.selected_cases.length, 8);
  assert.equal(runtimeMatrix.result.case_results.every((item) => item.status === 'passed'), true);
  assert.equal(runtimeMatrix.result.hard_gate_results.visual_proof_passed, 'pass');
  assert.equal(runtimeMatrix.result.hard_gate_results.reference_action_stress_passed, 'pass');
});

test('CLI cuts image-input atlas into layer input and runs workflow bench', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image-input-'));
  const atlasDir = path.join(tempDir, 'atlas');
  const cutDir = path.join(tempDir, 'cut');
  const workflowDir = path.join(tempDir, 'workflow');

  const atlas = await runCli(['generate-demo-atlas', atlasDir]);
  assert.equal(atlas.status, 'ok');
  assert.equal(atlas.kind, 'demo_layer_atlas_generation');
  assert.equal(atlas.layerCellCount, 6);

  const atlasSpecPath = path.join(atlasDir, 'atlas-spec.yaml');
  const atlasSpec = await runCli(['validate-atlas-spec', atlasSpecPath]);
  assert.equal(atlasSpec.status, 'ok');
  assert.equal(atlasSpec.value.background.kind, 'chroma_key');

  const cut = await runCli(['cut-layer-atlas', atlasSpecPath, '--out', cutDir]);
  assert.equal(cut.status, 'ok');
  assert.equal(cut.layerAssetCount, 6);

  const layerValidation = await runCli(['validate-layer-input', path.join(cutDir, 'layer-input.yaml')]);
  assert.equal(layerValidation.status, 'ok');
  assert.equal(layerValidation.value.layers.every((layer) => layer.asset.ref.startsWith('layers/')), true);

  const workflow = await runCli(['run-image-input-workflow-bench', atlasSpecPath, '--out', workflowDir, '--grid-size', '4']);
  assert.equal(workflow.status, 'ok');
  assert.equal(workflow.decision.verdict, 'pass');
  assert.equal(workflow.result.hard_gate_results.atlas_spec_valid, 'pass');
  assert.equal(workflow.result.hard_gate_results.layer_input_valid, 'pass');
  assert.equal(workflow.result.hard_gate_results.generation_bench_go, 'pass');
  assert.equal(workflow.result.hard_gate_results.runtime_matrix_pass, 'pass');

  const quality = await runCli(['run-atlas-quality-gate', atlasSpecPath, '--out', path.join(tempDir, 'quality-report.yaml')]);
  assert.equal(quality.status, 'ok');
  assert.equal(quality.kind, 'atlas_quality_gate');
  assert.ok(['pass', 'fail'].includes(quality.decision.verdict));
});
