import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import YAML from 'yaml';

import { auditReleaseCandidate } from '../src/index.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');

async function writeYaml(filePath, value) {
  await writeFile(filePath, YAML.stringify(value), 'utf8');
  return filePath;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

async function writeUtf16Json(filePath, value) {
  await writeFile(filePath, Buffer.from(`\ufeff${JSON.stringify(value, null, 2)}\n`, 'utf16le'));
  return filePath;
}

function passingGenerationBench() {
  return {
    decision: { verdict: 'go' },
    hard_gate_results: {
      valid_locked_fixtures_admit: 'pass',
      invalid_fixtures_typed_reject: 'pass',
      asset_integrity_validation: 'pass',
      no_outfit_no_render: 'pass',
      base_body_only_rejected: 'pass',
      adult_v1_unavailable: 'pass',
      upstream_content_evidence_required: 'pass',
      capability_overclaim_rejected: 'pass',
      deterministic_replay: 'pass',
    },
    quality_gate_results: {
      anchor_accuracy_overall: { status: 'pass' },
      slot_accuracy: { status: 'pass' },
      default_outfit_binding_success_rate: { status: 'pass' },
      expression_usability_rate: { status: 'pass' },
      jaw_amplitude_speech_mouth_usability_rate: { status: 'pass' },
      motion_primitive_binding_success_rate: { status: 'pass' },
      package_runtime_admission_readiness: { status: 'pass' },
    },
    tracking_metrics: {
      manual_correction_minutes_p50_p90: {
        p50: null,
        p90: null,
        status: 'not_measured',
      },
    },
  };
}

function passingRuntimeProof() {
  return {
    status: 'ok',
    decision: { verdict: 'pass' },
    result: {
      selected_cases: [
        'case-01',
        'case-02',
        'case-03',
        'case-04',
        'case-05',
      ],
      case_results: [
        'case-01',
        'case-02',
        'case-03',
        'case-04',
        'case-05',
      ].map((caseId) => ({
        case_id: caseId,
        status: 'passed',
        reference_action_verdict: 'pass_minimal_tier1',
        reference_action_stress_verdict: 'pass_stream_stress_tier1',
      })),
      hard_gate_results: {
        positive_cases_solved: 'pass',
        render_plan_built: 'pass',
        default_renderable_layers_covered: 'pass',
        visual_proof_passed: 'pass',
        reference_action_bench_passed: 'pass',
        reference_action_stress_passed: 'pass',
      },
    },
  };
}

function passingManualCorrectionReport() {
  return {
    manifest_kind: 'nimi.nimi2d.manual-correction-report',
    schema_version: 1,
    measurement_scope: 'release_candidate',
    case_results: [
      { case_id: 'case-01', correction_minutes: 0, prompt_repair_required: false },
      { case_id: 'case-02', correction_minutes: 3, prompt_repair_required: true },
      { case_id: 'case-03', correction_minutes: 5, prompt_repair_required: true },
      { case_id: 'case-04', correction_minutes: 2, prompt_repair_required: false },
      { case_id: 'case-05', correction_minutes: 4, prompt_repair_required: true },
    ],
    summary: {
      measured_case_count: 5,
      p50_minutes: 3,
      p90_minutes: 5,
      max_minutes: 5,
    },
    decision: {
      verdict: 'pass',
      reason: 'Manual correction metrics were measured for the release candidate.',
    },
  };
}

function passingProductReviewReport() {
  return {
    manifest_kind: 'nimi.nimi2d.product-review-report',
    schema_version: 1,
    review_scope: 'release_candidate',
    reviewer: {
      id: 'product-reviewer',
      role: 'product_owner',
    },
    reviewed_at: '2026-06-19T00:00:00Z',
    criteria: {
      identity_preservation: 'pass',
      layer_alignment: 'pass',
      expression_readability: 'pass',
      wardrobe_readiness: 'pass',
      product_fit: 'pass',
    },
    decision: {
      verdict: 'pass',
      reason: 'Release candidate product review passed.',
    },
  };
}

function failingProductReviewReport() {
  return {
    manifest_kind: 'nimi.nimi2d.product-review-report',
    schema_version: 1,
    review_scope: 'release_candidate',
    reviewer: {
      id: 'codex-visual-qa',
      role: 'qa_reviewer',
    },
    reviewed_at: '2026-06-19T04:30:00+08:00',
    criteria: {
      identity_preservation: 'pass',
      layer_alignment: 'fail',
      expression_readability: 'fail',
      wardrobe_readiness: 'pass',
      product_fit: 'fail',
    },
    decision: {
      verdict: 'fail',
      reason: 'Visual QA recorded release-candidate product defects.',
    },
  };
}

function passingDistributionReport(overrides = {}) {
  return {
    manifest_kind: 'nimi.nimi2d.codex-image2.distribution-report',
    gate_mode: 'source_to_layer_pipeline',
    filters: {
      source_surface: 'codex_cli',
    },
    require_layer_input_full_chain: true,
    summary: {
      run_count: 5,
      unique_source_sample_count: 5,
      unique_underlying_source_sample_count: 5,
      layer_input_full_chain_pass_count: 5,
      passing_run_count: 5,
    },
    decision: { verdict: 'pass' },
    ...overrides,
  };
}

test('release-candidate audit reports T1-T4 chain pass with product blockers visible', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-release-audit-'));
  const distributionPath = await writeYaml(path.join(tempDir, 'distribution.yaml'), passingDistributionReport());
  const corpusPath = await writeYaml(path.join(tempDir, 'certified-corpus-report.yaml'), {
    manifest_kind: 'nimi.nimi2d.certified-corpus-report',
    summary: {
      certified_good_tier1_count: 5,
      invalid_contract_count: 5,
      unique_certified_content_hash_count: 5,
      distribution_tags_seen: [
        'anchor_stress',
        'expression_stress',
        'realm_persona_representative',
        'wardrobe_stress',
      ],
    },
    decision: { verdict: 'pass' },
  });
  const generationPath = await writeYaml(path.join(tempDir, 'generation-bench.yaml'), passingGenerationBench());
  const runtimePath = await writeUtf16Json(path.join(tempDir, 'runtime-proof-matrix.json'), passingRuntimeProof());
  const outPath = path.join(tempDir, 'release-candidate-audit.yaml');

  const result = await auditReleaseCandidate({
    distributionReportPath: distributionPath,
    corpusCertificationReportPath: corpusPath,
    generationBenchResultPath: generationPath,
    runtimeProofMatrixPath: runtimePath,
    outPath,
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.decision.verdict, 'candidate_pass_product_blocked');
  assert.equal(result.report.tier_chain.t1_provider_distribution.status, 'pass');
  assert.equal(result.report.tier_chain.t2_corpus_certification.status, 'pass');
  assert.equal(result.report.tier_chain.t3_generation_bench.status, 'pass');
  assert.equal(result.report.tier_chain.t4_reference_response.status, 'pass');
  assert.equal(result.report.product_readiness.status, 'blocked');
  assert.deepEqual(result.codes.sort(), [
    'NIMI2D_RELEASE_MANUAL_CORRECTION_METRICS_NOT_MEASURED',
    'NIMI2D_RELEASE_PRODUCT_REVIEW_NOT_RECORDED',
  ]);
  const written = await readFile(outPath, 'utf8');
  assert.equal(written.includes('manifest_kind: nimi.nimi2d.release-candidate-audit'), true);

  const cliOutPath = path.join(tempDir, 'release-candidate-audit-cli.yaml');
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    'audit-release-candidate',
    '--distribution-report', distributionPath,
    '--certified-corpus-report', corpusPath,
    '--generation-bench-result', generationPath,
    '--runtime-proof-matrix', runtimePath,
    '--out', cliOutPath,
  ], { cwd: packageRoot });
  const cliResult = JSON.parse(stdout);
  assert.equal(cliResult.status, 'ok');
  assert.equal(cliResult.decision.verdict, 'candidate_pass_product_blocked');
});

test('release-candidate audit accepts measured correction and product review evidence', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-release-audit-ready-'));
  const distributionPath = await writeYaml(path.join(tempDir, 'distribution.yaml'), passingDistributionReport());
  const corpusPath = await writeYaml(path.join(tempDir, 'certified-corpus-report.yaml'), {
    summary: {
      certified_good_tier1_count: 5,
      invalid_contract_count: 5,
      unique_certified_content_hash_count: 5,
      distribution_tags_seen: [
        'anchor_stress',
        'expression_stress',
        'realm_persona_representative',
        'wardrobe_stress',
      ],
    },
    decision: { verdict: 'pass' },
  });
  const generationPath = await writeYaml(path.join(tempDir, 'generation-bench.yaml'), passingGenerationBench());
  const runtimePath = await writeJson(path.join(tempDir, 'runtime-proof-matrix.json'), passingRuntimeProof());
  const correctionPath = await writeYaml(path.join(tempDir, 'manual-correction.yaml'), passingManualCorrectionReport());
  const productReviewPath = await writeYaml(path.join(tempDir, 'product-review.yaml'), passingProductReviewReport());

  const result = await auditReleaseCandidate({
    distributionReportPath: distributionPath,
    corpusCertificationReportPath: corpusPath,
    generationBenchResultPath: generationPath,
    runtimeProofMatrixPath: runtimePath,
    manualCorrectionReportPath: correctionPath,
    productReviewReportPath: productReviewPath,
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.decision.verdict, 'release_candidate_pass');
  assert.equal(result.report.product_readiness.status, 'pass');
  assert.equal(result.report.product_readiness.manual_correction.status, 'pass');
  assert.equal(result.report.product_readiness.product_review.status, 'pass');
  assert.deepEqual(result.codes, []);
});

test('release-candidate audit rejects a technically passing candidate with recorded product review failures', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-release-audit-product-review-fail-'));
  const distributionPath = await writeYaml(path.join(tempDir, 'distribution.yaml'), passingDistributionReport());
  const corpusPath = await writeYaml(path.join(tempDir, 'certified-corpus-report.yaml'), {
    summary: {
      certified_good_tier1_count: 5,
      invalid_contract_count: 5,
      unique_certified_content_hash_count: 5,
      distribution_tags_seen: [
        'anchor_stress',
        'expression_stress',
        'realm_persona_representative',
        'wardrobe_stress',
      ],
    },
    decision: { verdict: 'pass' },
  });
  const generationPath = await writeYaml(path.join(tempDir, 'generation-bench.yaml'), passingGenerationBench());
  const runtimePath = await writeJson(path.join(tempDir, 'runtime-proof-matrix.json'), passingRuntimeProof());
  const correctionPath = await writeYaml(path.join(tempDir, 'manual-correction.yaml'), passingManualCorrectionReport());
  const productReviewPath = await writeYaml(path.join(tempDir, 'product-review.yaml'), failingProductReviewReport());

  const result = await auditReleaseCandidate({
    distributionReportPath: distributionPath,
    corpusCertificationReportPath: corpusPath,
    generationBenchResultPath: generationPath,
    runtimeProofMatrixPath: runtimePath,
    manualCorrectionReportPath: correctionPath,
    productReviewReportPath: productReviewPath,
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.decision.verdict, 'candidate_rejected_product_review');
  assert.equal(result.report.product_readiness.status, 'fail');
  assert.equal(result.report.product_readiness.product_review.status, 'fail');
  assert.deepEqual(result.codes, ['NIMI2D_RELEASE_PRODUCT_REVIEW_FAILED']);
});

test('release-candidate audit rejects invalid correction and product review evidence', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-release-audit-invalid-product-'));
  const distributionPath = await writeYaml(path.join(tempDir, 'distribution.yaml'), passingDistributionReport());
  const corpusPath = await writeYaml(path.join(tempDir, 'certified-corpus-report.yaml'), {
    summary: {
      certified_good_tier1_count: 5,
      invalid_contract_count: 5,
      unique_certified_content_hash_count: 5,
      distribution_tags_seen: [
        'anchor_stress',
        'expression_stress',
        'realm_persona_representative',
        'wardrobe_stress',
      ],
    },
    decision: { verdict: 'pass' },
  });
  const generationPath = await writeYaml(path.join(tempDir, 'generation-bench.yaml'), passingGenerationBench());
  const runtimePath = await writeJson(path.join(tempDir, 'runtime-proof-matrix.json'), passingRuntimeProof());
  const correctionPath = await writeYaml(path.join(tempDir, 'manual-correction.yaml'), {
    manifest_kind: 'nimi.nimi2d.manual-correction-report',
    case_results: [],
    summary: { measured_case_count: 0 },
    decision: { verdict: 'pass' },
  });
  const productReviewPath = await writeYaml(path.join(tempDir, 'product-review.yaml'), {
    manifest_kind: 'nimi.nimi2d.product-review-report',
    criteria: { identity_preservation: 'pass' },
    decision: { verdict: 'pass' },
  });

  const result = await auditReleaseCandidate({
    distributionReportPath: distributionPath,
    corpusCertificationReportPath: corpusPath,
    generationBenchResultPath: generationPath,
    runtimeProofMatrixPath: runtimePath,
    manualCorrectionReportPath: correctionPath,
    productReviewReportPath: productReviewPath,
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.decision.verdict, 'candidate_pass_product_blocked');
  assert.equal(result.codes.includes('NIMI2D_RELEASE_MANUAL_CORRECTION_REPORT_INVALID'), true);
  assert.equal(result.codes.includes('NIMI2D_RELEASE_PRODUCT_REVIEW_REPORT_INVALID'), true);
});

test('release-candidate audit fails closed when runtime proof is not passing', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-release-audit-fail-'));
  const distributionPath = await writeYaml(path.join(tempDir, 'distribution.yaml'), passingDistributionReport());
  const corpusPath = await writeYaml(path.join(tempDir, 'certified-corpus-report.yaml'), {
    summary: {
      certified_good_tier1_count: 5,
      invalid_contract_count: 5,
      unique_certified_content_hash_count: 5,
      distribution_tags_seen: [
        'anchor_stress',
        'expression_stress',
        'realm_persona_representative',
        'wardrobe_stress',
      ],
    },
    decision: { verdict: 'pass' },
  });
  const generationPath = await writeYaml(path.join(tempDir, 'generation-bench.yaml'), passingGenerationBench());
  const runtime = passingRuntimeProof();
  runtime.decision.verdict = 'fail';
  runtime.result.hard_gate_results.reference_action_stress_passed = 'fail';
  const runtimePath = await writeJson(path.join(tempDir, 'runtime-proof-matrix.json'), runtime);

  const result = await auditReleaseCandidate({
    distributionReportPath: distributionPath,
    corpusCertificationReportPath: corpusPath,
    generationBenchResultPath: generationPath,
    runtimeProofMatrixPath: runtimePath,
  });

  assert.equal(result.status, 'reject');
  assert.equal(result.decision.verdict, 'fail');
  assert.equal(result.report.tier_chain.t4_reference_response.status, 'fail');
  assert.equal(result.codes.includes('NIMI2D_RELEASE_T4_REFERENCE_RESPONSE_FAILED'), true);
});

test('release-candidate audit fails closed without live codex_cli distribution filter', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-release-audit-source-filter-'));
  const distribution = passingDistributionReport();
  delete distribution.filters;
  const distributionPath = await writeYaml(path.join(tempDir, 'distribution.yaml'), distribution);
  const corpusPath = await writeYaml(path.join(tempDir, 'certified-corpus-report.yaml'), {
    summary: {
      certified_good_tier1_count: 5,
      invalid_contract_count: 5,
      unique_certified_content_hash_count: 5,
      distribution_tags_seen: [
        'anchor_stress',
        'expression_stress',
        'realm_persona_representative',
        'wardrobe_stress',
      ],
    },
    decision: { verdict: 'pass' },
  });
  const generationPath = await writeYaml(path.join(tempDir, 'generation-bench.yaml'), passingGenerationBench());
  const runtimePath = await writeJson(path.join(tempDir, 'runtime-proof-matrix.json'), passingRuntimeProof());

  const result = await auditReleaseCandidate({
    distributionReportPath: distributionPath,
    corpusCertificationReportPath: corpusPath,
    generationBenchResultPath: generationPath,
    runtimeProofMatrixPath: runtimePath,
  });

  assert.equal(result.status, 'reject');
  assert.equal(result.report.tier_chain.t1_provider_distribution.status, 'fail');
  assert.equal(result.codes.includes('NIMI2D_RELEASE_T1_PROVIDER_DISTRIBUTION_FAILED'), true);
});

test('release-candidate audit fails closed when full layer-input chain is not required', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-release-audit-full-chain-'));
  const distributionPath = await writeYaml(path.join(tempDir, 'distribution.yaml'), passingDistributionReport({
    require_layer_input_full_chain: false,
  }));
  const corpusPath = await writeYaml(path.join(tempDir, 'certified-corpus-report.yaml'), {
    summary: {
      certified_good_tier1_count: 5,
      invalid_contract_count: 5,
      unique_certified_content_hash_count: 5,
      distribution_tags_seen: [
        'anchor_stress',
        'expression_stress',
        'realm_persona_representative',
        'wardrobe_stress',
      ],
    },
    decision: { verdict: 'pass' },
  });
  const generationPath = await writeYaml(path.join(tempDir, 'generation-bench.yaml'), passingGenerationBench());
  const runtimePath = await writeJson(path.join(tempDir, 'runtime-proof-matrix.json'), passingRuntimeProof());

  const result = await auditReleaseCandidate({
    distributionReportPath: distributionPath,
    corpusCertificationReportPath: corpusPath,
    generationBenchResultPath: generationPath,
    runtimeProofMatrixPath: runtimePath,
  });

  assert.equal(result.status, 'reject');
  assert.equal(result.report.tier_chain.t1_provider_distribution.status, 'fail');
  assert.equal(result.codes.includes('NIMI2D_RELEASE_T1_PROVIDER_DISTRIBUTION_FAILED'), true);
});
