import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { runGenerationBench } from '../generation-bench.mjs';
import { validateLayerInput } from '../layer-input.mjs';
import { solvePackageFromLayerInput } from '../package-manifest.mjs';
import { runRuntimeProofMatrix } from '../runtime-proof-matrix.mjs';
import { sha256 } from '../common-utils.mjs';
import { cutLayerAtlas } from './atlas-cutter.mjs';
import { validateAtlasSpec } from './atlas-spec.mjs';

function passFail(value) {
  return value ? 'pass' : 'fail';
}

function relativeReportPath(fromDir, targetPath) {
  const relative = path.relative(fromDir, path.resolve(targetPath)).replaceAll('\\', '/');
  return relative.length === 0 ? '.' : relative;
}

async function writeSingleCaseCorpus(input) {
  const corpus = {
    corpus_id: `n2d_generation_corpus_image_input_${input.atlasId.replaceAll('-', '_')}`,
    corpus_version: '0.0.0',
    corpus_digest_sha256: sha256(JSON.stringify({
      atlas_id: input.atlasId,
      layer_input_hash: input.contentHashSha256,
    })),
    frozen: true,
    created_at: '2026-06-17T00:00:00Z',
    case_splits: {
      certified_good_tier1: [input.caseId],
      invalid_contract: [],
    },
    cases: [
      {
        case_id: input.caseId,
        split: 'certified_good_tier1',
        layer_input_manifest_ref: 'layer-input/layer-input.yaml',
        content_hash_sha256: input.contentHashSha256,
        expected_outcome: 'admit',
        target_tier: 'tier-1_agent_basic',
        source_evidence: input.sourceEvidence,
        distribution_tags: ['image_input_workflow', 'atlas_cut'],
      },
    ],
  };
  const corpusPath = path.join(input.outputDir, 'corpus.yaml');
  await writeFile(corpusPath, YAML.stringify(corpus), 'utf8');
  return { corpus, corpusPath };
}

async function runImageInputWorkflowBench(atlasSpecPath, outputDir, options = {}) {
  const outputRoot = path.resolve(outputDir);
  if (options.clean !== false) {
    await rm(outputRoot, { recursive: true, force: true });
  }
  await mkdir(outputRoot, { recursive: true });

  const atlasResult = await validateAtlasSpec(atlasSpecPath);
  if (atlasResult.status !== 'ok') {
    return {
      status: 'reject',
      kind: 'image_input_workflow_bench',
      codes: atlasResult.codes,
      issues: atlasResult.issues,
    };
  }

  const layerInputDir = path.join(outputRoot, 'layer-input');
  const cut = await cutLayerAtlas(atlasSpecPath, layerInputDir, { clean: true });
  if (cut.status !== 'ok') {
    return {
      status: 'reject',
      kind: 'image_input_workflow_bench',
      cut,
      codes: cut.codes,
      issues: cut.issues,
    };
  }

  const layerValidation = await validateLayerInput(cut.layerInputManifestPath);
  const solved = layerValidation.status === 'ok'
    ? await solvePackageFromLayerInput(cut.layerInputManifestPath, {
      packageId: `n2d_pkg_image_input_${atlasResult.value.atlas_id.replaceAll('-', '_')}`,
      requestedTier: 'tier-1_agent_basic',
    })
    : null;
  const { corpusPath } = await writeSingleCaseCorpus({
    outputDir: outputRoot,
    atlasId: atlasResult.value.atlas_id,
    caseId: `n2d_case_image_input_${atlasResult.value.atlas_id.replaceAll('-', '_')}`,
    contentHashSha256: cut.contentHashSha256,
    sourceEvidence: atlasResult.value.source_evidence,
  });
  const generationBench = await runGenerationBench(corpusPath);
  const runtimeMatrix = await runRuntimeProofMatrix(corpusPath, { gridSize: options.gridSize });
  const hardGateResults = {
    atlas_spec_valid: passFail(atlasResult.status === 'ok'),
    atlas_cut_succeeded: passFail(cut.status === 'ok'),
    layer_input_valid: passFail(layerValidation.status === 'ok'),
    package_solve_succeeded: passFail(solved?.status === 'ok'),
    generation_bench_go: passFail(generationBench.decision?.verdict === 'go'),
    runtime_matrix_pass: passFail(runtimeMatrix.decision?.verdict === 'pass'),
  };
  const verdict = Object.values(hardGateResults).every((status) => status === 'pass') ? 'pass' : 'fail';
  const report = {
    run_id: `n2d_image_input_workflow_${atlasResult.value.atlas_id.replaceAll('-', '_')}`,
    atlas: {
      atlas_id: atlasResult.value.atlas_id,
      atlas_spec_path: relativeReportPath(outputRoot, atlasSpecPath),
      atlas_image_ref: atlasResult.value.atlas_image_ref,
    },
    outputs: {
      output_dir: '.',
      layer_input_manifest_path: relativeReportPath(outputRoot, cut.layerInputManifestPath),
      corpus_path: relativeReportPath(outputRoot, corpusPath),
    },
    hard_gate_results: hardGateResults,
    layer_validation: {
      status: layerValidation.status,
      codes: layerValidation.codes,
    },
    package_solve: {
      status: solved?.status ?? 'skipped',
      codes: solved?.codes ?? [],
      proven_tier: solved?.manifest?.capability?.proven_tier ?? 'none',
    },
    generation_bench: {
      status: generationBench.status,
      decision: generationBench.decision,
    },
    runtime_matrix: {
      status: runtimeMatrix.status,
      decision: runtimeMatrix.decision,
    },
    decision: {
      verdict,
      reason: verdict === 'pass'
        ? 'Image-input atlas workflow produced an admitted Nimi2D tier-1 package and passed runtime proof.'
        : 'One or more image-input workflow gates failed.',
    },
  };
  const reportPath = path.join(outputRoot, 'workflow-report.yaml');
  await writeFile(reportPath, YAML.stringify(report), 'utf8');
  return {
    status: 'ok',
    kind: 'image_input_workflow_bench',
    decision: report.decision,
    reportPath,
    result: report,
    codes: [],
    issues: [],
  };
}

export { runImageInputWorkflowBench };
