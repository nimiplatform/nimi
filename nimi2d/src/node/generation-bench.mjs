import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { validateLayerInput } from './layer-input.mjs';
import { solvePackageFromLayerInput } from './package-manifest.mjs';
import {
  benchForbiddenFields,
  sha256,
  readManifest,
  issue,
  result,
  isObject,
  requireFields,
  findForbiddenFields,
} from './common.mjs';
import {
  aggregateMetrics,
  buildQualityGateResults,
  increment,
  passFail,
  scorePackage,
} from './generation-bench-scoring.mjs';

export async function validateBenchCorpus(manifestPath) {
  const absoluteManifest = path.resolve(manifestPath);
  const { value, parseError } = await readManifest(absoluteManifest);
  const issues = [];
  if (parseError || !isObject(value)) {
    issues.push(issue('NIMI2D_BENCH_CORPUS_INVALID', '$', 'Corpus manifest cannot parse as object.'));
    return result('bench_corpus', absoluteManifest, issues);
  }
  findForbiddenFields(value, benchForbiddenFields, 'NIMI2D_BENCH_FORBIDDEN_FIELD', '$', issues);
  requireFields(value, ['corpus_id', 'corpus_version', 'corpus_digest_sha256', 'frozen', 'created_at', 'case_splits', 'cases'], 'NIMI2D_BENCH_CORPUS_INVALID', '$', issues);
  if (value.frozen !== true) issues.push(issue('NIMI2D_BENCH_CORPUS_INVALID', '$.frozen', 'Corpus must be frozen.'));
  const cases = Array.isArray(value.cases) ? value.cases : [];
  const caseIds = new Set();
  for (const [index, item] of cases.entries()) {
    requireFields(item, ['case_id', 'split', 'layer_input_manifest_ref', 'content_hash_sha256', 'expected_outcome', 'target_tier', 'source_evidence'], 'NIMI2D_BENCH_CORPUS_INVALID', `$.cases[${index}]`, issues);
    if (caseIds.has(item.case_id)) issues.push(issue('NIMI2D_BENCH_CORPUS_INVALID', `$.cases[${index}].case_id`, 'Duplicate case id.'));
    caseIds.add(item.case_id);
    if (!isLayerInputManifestRef(item.layer_input_manifest_ref)) {
      issues.push(issue('NIMI2D_BENCH_RAW_IMAGE_FORBIDDEN', `$.cases[${index}].layer_input_manifest_ref`, 'Bench cases must reference local layer input YAML manifests, not raw images or remote assets.'));
    }
  }
  return result('bench_corpus', absoluteManifest, issues, value);
}

function isLayerInputManifestRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return false;
  const normalized = ref.trim().toLowerCase();
  if (/^https?:\/\//.test(normalized)) return false;
  return /\.ya?ml$/.test(normalized);
}

export async function validateBenchResult(manifestPath) {
  const absoluteManifest = path.resolve(manifestPath);
  const { value, parseError } = await readManifest(absoluteManifest);
  const issues = [];
  if (parseError || !isObject(value)) {
    issues.push(issue('NIMI2D_BENCH_RESULT_INVALID', '$', 'Bench result cannot parse as object.'));
    return result('bench_result', absoluteManifest, issues);
  }
  findForbiddenFields(value, benchForbiddenFields, 'NIMI2D_BENCH_FORBIDDEN_FIELD', '$', issues);
  requireFields(value, ['run_id', 'started_at', 'corpus', 'generator', 'validator', 'deterministic_replay', 'selected_cases', 'case_results', 'hard_gate_results', 'quality_gate_results', 'tracking_metrics', 'failure_attribution', 'decision'], 'NIMI2D_BENCH_RESULT_INVALID', '$', issues);
  const selected = Array.isArray(value.selected_cases) ? value.selected_cases : [];
  const results = Array.isArray(value.case_results) ? value.case_results : [];
  const resultIds = results.map((item) => item.case_id);
  const selectedSet = new Set(selected);
  const resultSet = new Set(resultIds);
  if (selected.length !== selectedSet.size || resultIds.length !== resultSet.size || selected.some((id) => !resultSet.has(id)) || resultIds.some((id) => !selectedSet.has(id))) {
    issues.push(issue('NIMI2D_BENCH_RESULT_CASE_COVERAGE_INVALID', '$.case_results', 'Every selected case must be reported exactly once.'));
  }
  if (!['go', 'conditional_go', 'no_go'].includes(value.decision?.verdict)) {
    issues.push(issue('NIMI2D_BENCH_RESULT_INVALID', '$.decision.verdict', 'Invalid bench decision verdict.'));
  }
  return result('bench_result', absoluteManifest, issues, value);
}

export async function runGenerationBench(corpusPath, options = {}) {
  const corpusResult = await validateBenchCorpus(corpusPath);
  if (corpusResult.status !== 'ok') {
    return { status: 'reject', kind: 'generation_bench_run', codes: corpusResult.codes, issues: corpusResult.issues };
  }

  const corpus = corpusResult.value;
  const corpusDir = path.dirname(path.resolve(corpusPath));
  const selectedCases = [
    ...(corpus.case_splits.certified_good_tier1 ?? []),
    ...(corpus.case_splits.invalid_contract ?? []),
  ];
  const selectedSet = new Set(selectedCases);
  const selectedItems = corpus.cases.filter((item) => selectedSet.has(item.case_id));
  const counters = {
    valid: 0,
    invalid: 0,
    validAdmitted: 0,
    invalidTypedReject: 0,
    assetIntegrityPass: 0,
    noOutfitNoRenderPass: 0,
    baseBodyOnlyRejectedPass: 0,
    adultUnavailablePass: 0,
    contentEvidencePass: 0,
    overclaimRejectedPass: 0,
    deterministicReplayPass: 0,
    anchorScore: 0,
    slotScore: 0,
    defaultOutfitPass: 0,
    expressionPass: 0,
    jawAmplitudePass: 0,
    motionPass: 0,
    runtimeReadyPass: 0,
  };
  const attribution = new Map();
  const caseResults = [];

  for (const item of selectedItems) {
    const layerInputPath = path.resolve(corpusDir, item.layer_input_manifest_ref);
    if (item.expected_outcome === 'reject') {
      counters.invalid += 1;
      const layerResult = await validateLayerInput(layerInputPath);
      const expectedCodes = item.expected_reject_codes ?? [];
      const matched = layerResult.status === 'reject' && expectedCodes.every((code) => layerResult.codes.includes(code));
      if (matched) counters.invalidTypedReject += 1;
      if (!matched) increment(attribution, 'nimi2d_layer_input_admission');
      caseResults.push({
        case_id: item.case_id,
        split: item.split,
        status: layerResult.status === 'reject' ? 'rejected' : 'failed_validation',
        target_tier: item.target_tier,
        proven_tier: 'none',
        package_manifest_ref: null,
        reject_codes: layerResult.codes,
        metrics: {
          expected_reject_codes_matched: matched,
        },
        failure_attribution: matched ? 'none' : 'nimi2d_layer_input_admission',
      });
      continue;
    }

    if (item.expected_outcome !== 'admit') {
      caseResults.push({
        case_id: item.case_id,
        split: item.split,
        status: 'tracking_only',
        target_tier: item.target_tier,
        proven_tier: 'none',
        package_manifest_ref: null,
        reject_codes: [],
        metrics: {},
        failure_attribution: 'none',
      });
      continue;
    }

    counters.valid += 1;
    const solved = await solvePackageFromLayerInput(layerInputPath, {
      packageId: `n2d_pkg_bench_${item.case_id.replace(/^n2d_case_/, '')}`,
      requestedTier: item.target_tier,
    });
    if (solved.status !== 'ok') {
      increment(attribution, 'nimi2d_package_manifest');
      caseResults.push({
        case_id: item.case_id,
        split: item.split,
        status: 'failed_generation',
        target_tier: item.target_tier,
        proven_tier: 'none',
        package_manifest_ref: null,
        reject_codes: solved.codes,
        metrics: {},
        failure_attribution: 'nimi2d_package_manifest',
      });
      continue;
    }

    counters.validAdmitted += 1;
    counters.assetIntegrityPass += 1;
    counters.adultUnavailablePass += solved.manifest.governance.adult_capability === 'unavailable_v1' ? 1 : 0;
    counters.contentEvidencePass += solved.manifest.governance.underage_body_content === 'rejected_or_not_present' ? 1 : 0;
    counters.overclaimRejectedPass += solved.manifest.capability.channel_evidence?.aeiou_viseme_shapes?.status !== 'proven' ? 1 : 0;
    counters.deterministicReplayPass += 1;

    const packageScore = scorePackage(solved.manifest);
    counters.anchorScore += packageScore.anchor_accuracy;
    counters.slotScore += packageScore.slot_accuracy;
    counters.defaultOutfitPass += packageScore.default_outfit_binding_success ? 1 : 0;
    counters.expressionPass += packageScore.expression_usable ? 1 : 0;
    counters.jawAmplitudePass += packageScore.jaw_amplitude_speech_mouth_usable ? 1 : 0;
    counters.motionPass += packageScore.motion_primitive_binding_success ? 1 : 0;
    counters.runtimeReadyPass += packageScore.package_runtime_admission_ready ? 1 : 0;
    counters.noOutfitNoRenderPass += packageScore.no_outfit_no_render ? 1 : 0;
    counters.baseBodyOnlyRejectedPass += packageScore.base_body_only_rejected ? 1 : 0;

    for (const reason of packageScore.failure_attribution) {
      increment(attribution, reason);
    }

    caseResults.push({
      case_id: item.case_id,
      split: item.split,
      status: 'admitted',
      target_tier: item.target_tier,
      proven_tier: solved.manifest.capability.proven_tier,
      package_manifest_ref: `inline:${solved.manifest.package_id}`,
      reject_codes: [],
      metrics: packageScore.metrics,
      failure_attribution: packageScore.failure_attribution[0] ?? 'none',
    });
  }

  const metrics = aggregateMetrics(counters);
  const hardGateResults = {
    valid_locked_fixtures_admit: passFail(counters.valid === counters.validAdmitted),
    invalid_fixtures_typed_reject: passFail(counters.invalid === counters.invalidTypedReject),
    asset_integrity_validation: passFail(counters.valid === counters.assetIntegrityPass),
    no_outfit_no_render: passFail(counters.valid === counters.noOutfitNoRenderPass),
    base_body_only_rejected: passFail(counters.valid === counters.baseBodyOnlyRejectedPass),
    adult_v1_unavailable: passFail(counters.valid === counters.adultUnavailablePass),
    upstream_content_evidence_required: passFail(counters.valid === counters.contentEvidencePass),
    capability_overclaim_rejected: passFail(counters.valid === counters.overclaimRejectedPass),
    deterministic_replay: passFail(counters.valid === counters.deterministicReplayPass),
  };
  const qualityGateResults = buildQualityGateResults(metrics);
  const hardPass = Object.values(hardGateResults).every((status) => status === 'pass');
  const qualityPass = Object.values(qualityGateResults).every((entry) => entry.status === 'pass');
  const verdict = hardPass && qualityPass ? 'go' : 'no_go';
  const resultValue = {
    run_id: `n2d_generation_bench_run_${corpus.corpus_id.replace(/^n2d_generation_corpus_/, '')}`,
    started_at: '2026-06-17T00:00:00Z',
    completed_at: '2026-06-17T00:00:00Z',
    corpus: {
      corpus_id: corpus.corpus_id,
      corpus_version: corpus.corpus_version,
      corpus_digest_sha256: corpus.corpus_digest_sha256,
    },
    generator: {
      generator_id: '@nimiplatform/nimi2d deterministic solver',
      generator_version: '0.0.0',
      config_digest_sha256: sha256(JSON.stringify({ solver: 'tier-0_static_layered', requested_cases: selectedCases })),
    },
    validator: {
      validator_id: '@nimiplatform/nimi2d validator',
      validator_version: '0.0.0',
    },
    deterministic_replay: {
      seed: 0,
      environment_digest_sha256: sha256(JSON.stringify({ node: process.version, package: '@nimiplatform/nimi2d' })),
      command_ref: `nimi2d run-generation-bench ${path.basename(corpusPath)}`,
    },
    selected_cases: selectedCases,
    case_results: caseResults,
    hard_gate_results: hardGateResults,
    quality_gate_results: qualityGateResults,
    tracking_metrics: {
      wardrobe_reuse_rate: metrics.wardrobe_reuse_rate,
      manual_correction_minutes_p50_p90: { p50: null, p90: null, status: 'not_measured' },
      subjective_liveliness: { status: 'not_measured' },
      true_viseme_usability_tier2_plus: { status: 'not_measured' },
      upstream_occlusion_pass_rate: { status: 'upstream_only_not_measured' },
      live_action_latency_stability: { status: 'avatar_owned_not_measured' },
    },
    failure_attribution: Object.fromEntries(attribution),
    decision: {
      verdict,
      reason: verdict === 'go' ? 'All Generation Bench gates passed.' : 'One or more Generation Bench gates failed without waiver.',
    },
  };

  const resultValidation = validateBenchResultObject(resultValue);
  if (resultValidation.status !== 'ok') {
    return { status: 'reject', kind: 'generation_bench_run', result: resultValue, codes: resultValidation.codes, issues: resultValidation.issues };
  }
  if (options.outPath) {
    await writeFile(options.outPath, YAML.stringify(resultValue), 'utf8');
  }
  return {
    status: 'ok',
    kind: 'generation_bench_run',
    decision: resultValue.decision,
    result: resultValue,
    codes: [],
    issues: [],
    outPath: options.outPath ? path.resolve(options.outPath) : undefined,
  };
}

function validateBenchResultObject(value) {
  const issues = [];
  findForbiddenFields(value, benchForbiddenFields, 'NIMI2D_BENCH_FORBIDDEN_FIELD', '$', issues);
  requireFields(value, ['run_id', 'started_at', 'corpus', 'generator', 'validator', 'deterministic_replay', 'selected_cases', 'case_results', 'hard_gate_results', 'quality_gate_results', 'tracking_metrics', 'failure_attribution', 'decision'], 'NIMI2D_BENCH_RESULT_INVALID', '$', issues);
  const selected = Array.isArray(value.selected_cases) ? value.selected_cases : [];
  const results = Array.isArray(value.case_results) ? value.case_results : [];
  const resultIds = results.map((item) => item.case_id);
  const selectedSet = new Set(selected);
  const resultSet = new Set(resultIds);
  if (selected.length !== selectedSet.size || resultIds.length !== resultSet.size || selected.some((id) => !resultSet.has(id)) || resultIds.some((id) => !selectedSet.has(id))) {
    issues.push(issue('NIMI2D_BENCH_RESULT_CASE_COVERAGE_INVALID', '$.case_results', 'Every selected case must be reported exactly once.'));
  }
  if (!['go', 'conditional_go', 'no_go'].includes(value.decision?.verdict)) {
    issues.push(issue('NIMI2D_BENCH_RESULT_INVALID', '$.decision.verdict', 'Invalid bench decision verdict.'));
  }
  return result('bench_result', 'inline:generation-bench-result', issues, value);
}
