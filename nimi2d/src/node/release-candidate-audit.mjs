import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import {
  readStructured,
  summarizeManualCorrection,
  summarizeProductReview,
  verdictOf,
} from './release-product-evidence.mjs';

const requiredDistributionTags = [
  'realm_persona_representative',
  'expression_stress',
  'wardrobe_stress',
  'anchor_stress',
];

function issue(code, pathLabel, message) {
  return { code, path: pathLabel, message };
}

async function writeReport(outPath, report) {
  if (!outPath) return null;
  const absolute = path.resolve(outPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, YAML.stringify(report), 'utf8');
  return absolute;
}

function gateStatusesPass(gates) {
  return Object.values(gates ?? {}).every((value) => {
    if (typeof value === 'string') return value === 'pass';
    return value?.status === 'pass';
  });
}

function normalizeRuntimeProof(value) {
  return value?.result ?? value;
}

function summarizeDistribution(report, options, issues) {
  const summary = report?.summary ?? {};
  const minSamples = options.minSamples ?? report?.min_unique_samples ?? 5;
  const minUnderlyingSources = options.minUnderlyingSources
    ?? report?.min_unique_underlying_sources
    ?? 5;
  const minFullChain = options.minFullChainPasses ?? minSamples;
  const pass = verdictOf(report) === 'pass'
    && (summary.unique_source_sample_count ?? 0) >= minSamples
    && (summary.unique_underlying_source_sample_count ?? 0) >= minUnderlyingSources
    && (summary.layer_input_full_chain_pass_count ?? 0) >= minFullChain
    && (summary.passing_run_count ?? 0) >= minSamples;
  if (!pass) {
    issues.push(issue(
      'NIMI2D_RELEASE_T1_PROVIDER_DISTRIBUTION_FAILED',
      '$.distribution_report',
      'Provider distribution did not pass required source, underlying-source, full-chain, and passing-run gates.',
    ));
  }
  return {
    status: pass ? 'pass' : 'fail',
    verdict: verdictOf(report),
    gate_mode: report?.gate_mode ?? 'not_recorded',
    source_surface: report?.filters?.source_surface ?? null,
    min_unique_samples: minSamples,
    min_unique_underlying_sources: minUnderlyingSources,
    run_count: summary.run_count ?? 0,
    unique_source_sample_count: summary.unique_source_sample_count ?? 0,
    unique_underlying_source_sample_count: summary.unique_underlying_source_sample_count ?? 0,
    layer_input_full_chain_pass_count: summary.layer_input_full_chain_pass_count ?? 0,
    passing_run_count: summary.passing_run_count ?? 0,
  };
}

function summarizeCorpus(report, options, issues) {
  const summary = report?.summary ?? {};
  const minCertified = options.minCertifiedCases ?? report?.requirements?.min_certified_good_tier1_cases ?? 5;
  const minInvalid = options.minInvalidCases ?? report?.requirements?.min_invalid_contract_cases ?? 5;
  const tags = new Set(summary.distribution_tags_seen ?? []);
  const missingTags = requiredDistributionTags.filter((tag) => !tags.has(tag));
  const pass = verdictOf(report) === 'pass'
    && (summary.certified_good_tier1_count ?? 0) >= minCertified
    && (summary.invalid_contract_count ?? 0) >= minInvalid
    && (summary.unique_certified_content_hash_count ?? 0) >= minCertified
    && missingTags.length === 0;
  if (!pass) {
    issues.push(issue(
      'NIMI2D_RELEASE_T2_CORPUS_CERTIFICATION_FAILED',
      '$.certified_corpus_report',
      'Certified corpus report did not pass release-candidate corpus gates.',
    ));
  }
  return {
    status: pass ? 'pass' : 'fail',
    verdict: verdictOf(report),
    min_certified_good_tier1_cases: minCertified,
    min_invalid_contract_cases: minInvalid,
    certified_good_tier1_count: summary.certified_good_tier1_count ?? 0,
    invalid_contract_count: summary.invalid_contract_count ?? 0,
    unique_certified_content_hash_count: summary.unique_certified_content_hash_count ?? 0,
    distribution_tags_seen: [...tags].sort(),
    missing_distribution_tags: missingTags,
  };
}

function summarizeGenerationBench(report, issues) {
  const hardGates = report?.hard_gate_results ?? report?.result?.hard_gate_results ?? {};
  const qualityGates = report?.quality_gate_results ?? report?.result?.quality_gate_results ?? {};
  const pass = verdictOf(report) === 'go'
    && gateStatusesPass(hardGates)
    && gateStatusesPass(qualityGates);
  if (!pass) {
    issues.push(issue(
      'NIMI2D_RELEASE_T3_GENERATION_BENCH_FAILED',
      '$.generation_bench_result',
      'Generation Bench did not return go with all hard and quality gates passing.',
    ));
  }
  return {
    status: pass ? 'pass' : 'fail',
    verdict: verdictOf(report),
    hard_gate_results: hardGates,
    quality_gate_results: qualityGates,
  };
}

function summarizeRuntimeProof(report, issues) {
  const runtimeProof = normalizeRuntimeProof(report);
  const hardGates = runtimeProof?.hard_gate_results ?? {};
  const cases = runtimeProof?.case_results ?? [];
  const casesPass = cases.every((item) => item.status === 'passed'
    && item.reference_action_verdict === 'pass_minimal_tier1'
    && item.reference_action_stress_verdict === 'pass_stream_stress_tier1');
  const pass = verdictOf(report) === 'pass'
    && gateStatusesPass(hardGates)
    && cases.length > 0
    && casesPass;
  if (!pass) {
    issues.push(issue(
      'NIMI2D_RELEASE_T4_REFERENCE_RESPONSE_FAILED',
      '$.runtime_proof_matrix',
      'Runtime Proof Matrix did not pass visual proof plus reference action bench/stress gates.',
    ));
  }
  return {
    status: pass ? 'pass' : 'fail',
    verdict: verdictOf(report),
    selected_case_count: runtimeProof?.selected_cases?.length ?? cases.length,
    passed_case_count: cases.filter((item) => item.status === 'passed').length,
    hard_gate_results: hardGates,
    reference_action_bench_passed: hardGates.reference_action_bench_passed ?? 'not_recorded',
    reference_action_stress_passed: hardGates.reference_action_stress_passed ?? 'not_recorded',
  };
}

export async function auditReleaseCandidate(options = {}) {
  const distributionReport = await readStructured(options.distributionReportPath);
  const corpusReport = await readStructured(options.corpusCertificationReportPath);
  const generationBench = await readStructured(options.generationBenchResultPath);
  const runtimeProof = await readStructured(options.runtimeProofMatrixPath);
  const manualCorrectionReport = options.manualCorrectionReportPath
    ? await readStructured(options.manualCorrectionReportPath)
    : null;
  const productReviewReport = options.productReviewReportPath
    ? await readStructured(options.productReviewReportPath)
    : null;

  const issues = [];
  const tierChain = {
    t1_provider_distribution: summarizeDistribution(distributionReport, options, issues),
    t2_corpus_certification: summarizeCorpus(corpusReport, options, issues),
    t3_generation_bench: summarizeGenerationBench(generationBench, issues),
    t4_reference_response: summarizeRuntimeProof(runtimeProof, issues),
  };

  const manualCorrection = summarizeManualCorrection(manualCorrectionReport, generationBench, issues);
  const productReview = summarizeProductReview(productReviewReport, issues);

  const failureIssues = issues.filter((item) => /^NIMI2D_RELEASE_T[1-4]_/.test(item.code));
  const productBlockers = issues.filter((item) => !/^NIMI2D_RELEASE_T[1-4]_/.test(item.code));
  const chainPass = failureIssues.length === 0;
  const productReviewFailed = productBlockers.some((item) => item.code === 'NIMI2D_RELEASE_PRODUCT_REVIEW_FAILED');
  const decision = chainPass
    ? productReviewFailed
      ? {
          verdict: 'candidate_rejected_product_review',
          reason: 'T1-T4 technical chain passed, but recorded product review failed release-candidate criteria.',
        }
      : {
          verdict: productBlockers.length > 0 ? 'candidate_pass_product_blocked' : 'release_candidate_pass',
          reason: productBlockers.length > 0
            ? 'T1-T4 technical chain passed, but product release blockers remain.'
            : 'T1-T4 technical chain and product release blockers are closed.',
        }
    : {
        verdict: 'fail',
        reason: 'One or more T1-T4 technical gates failed.',
      };
  const report = {
    manifest_kind: 'nimi.nimi2d.release-candidate-audit',
    schema_version: 1,
    inputs: {
      distribution_report_path: path.resolve(options.distributionReportPath),
      certified_corpus_report_path: path.resolve(options.corpusCertificationReportPath),
      generation_bench_result_path: path.resolve(options.generationBenchResultPath),
      runtime_proof_matrix_path: path.resolve(options.runtimeProofMatrixPath),
      manual_correction_report_path: options.manualCorrectionReportPath ? path.resolve(options.manualCorrectionReportPath) : null,
      product_review_report_path: options.productReviewReportPath ? path.resolve(options.productReviewReportPath) : null,
    },
    tier_chain: tierChain,
    product_readiness: {
      status: productReviewFailed ? 'fail' : productBlockers.length > 0 ? 'blocked' : 'pass',
      manual_correction: manualCorrection,
      product_review: productReview,
      blockers: productBlockers.map((item) => item.code),
    },
    boundary: {
      closes_production_avatar_readiness: false,
      closes_public_product_release: chainPass && productBlockers.length === 0,
      note: 'This is a Nimi2D package release-candidate audit, not production Avatar embodiment authority.',
    },
    decision,
    issues,
    codes: [...new Set(issues.map((item) => item.code))],
  };
  const outPath = await writeReport(options.outPath, report);
  return {
    status: chainPass ? 'ok' : 'reject',
    kind: 'release_candidate_audit',
    outPath,
    decision,
    report,
    codes: report.codes,
    issues,
  };
}
