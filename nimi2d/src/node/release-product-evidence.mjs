import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

function issue(code, pathLabel, message) {
  return { code, path: pathLabel, message };
}

function verdictOf(value) {
  return value?.decision?.verdict
    ?? value?.result?.decision?.verdict
    ?? value?.verdict
    ?? 'not_recorded';
}

async function readTextFile(filePath) {
  const bytes = await readFile(filePath);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le');
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.alloc(bytes.length - 2);
    for (let index = 2; index < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1] ?? 0;
      swapped[index - 1] = bytes[index];
    }
    return swapped.toString('utf16le');
  }
  if (bytes.length > 3 && bytes[1] === 0x00 && bytes[3] === 0x00) {
    return bytes.toString('utf16le');
  }
  return bytes.toString('utf8');
}

async function readStructured(filePath) {
  const absolute = path.resolve(filePath);
  const raw = await readTextFile(absolute);
  if (absolute.endsWith('.json')) return JSON.parse(raw);
  return YAML.parse(raw);
}

async function writeReport(outPath, report) {
  if (!outPath) return null;
  const absolute = path.resolve(outPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, YAML.stringify(report), 'utf8');
  return absolute;
}

function measuredManualCorrection(generationBench) {
  const metric = generationBench?.tracking_metrics?.manual_correction_minutes_p50_p90
    ?? generationBench?.result?.tracking_metrics?.manual_correction_minutes_p50_p90;
  return typeof metric?.p50 === 'number'
    && typeof metric?.p90 === 'number'
    && metric.status !== 'not_measured';
}

function summarizeManualCorrection(report, generationBench, issues) {
  if (!report) {
    if (measuredManualCorrection(generationBench)) {
      const metric = generationBench?.tracking_metrics?.manual_correction_minutes_p50_p90
        ?? generationBench?.result?.tracking_metrics?.manual_correction_minutes_p50_p90;
      return {
        status: 'pass',
        source: 'generation_bench_tracking_metric',
        p50_minutes: metric.p50,
        p90_minutes: metric.p90,
      };
    }
    issues.push(issue(
      'NIMI2D_RELEASE_MANUAL_CORRECTION_METRICS_NOT_MEASURED',
      '$.manual_correction_report',
      'Manual correction p50/p90 minutes are not measured for this release candidate.',
    ));
    return {
      status: 'missing',
      source: 'not_recorded',
    };
  }

  const caseResults = Array.isArray(report.case_results) ? report.case_results : [];
  const summary = report.summary ?? {};
  const minutes = caseResults.map((item) => item.correction_minutes);
  const valid = report.manifest_kind === 'nimi.nimi2d.manual-correction-report'
    && report.measurement_scope === 'release_candidate'
    && verdictOf(report) === 'pass'
    && caseResults.length > 0
    && minutes.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    && summary.measured_case_count === caseResults.length
    && typeof summary.p50_minutes === 'number'
    && typeof summary.p90_minutes === 'number'
    && typeof summary.max_minutes === 'number'
    && summary.p90_minutes >= summary.p50_minutes
    && summary.max_minutes >= summary.p90_minutes;
  if (!valid) {
    issues.push(issue(
      'NIMI2D_RELEASE_MANUAL_CORRECTION_REPORT_INVALID',
      '$.manual_correction_report',
      'Manual correction report must contain measured release-candidate case minutes and p50/p90/max summary values.',
    ));
  }
  return {
    status: valid ? 'pass' : 'fail',
    source: 'manual_correction_report',
    measured_case_count: summary.measured_case_count ?? caseResults.length,
    p50_minutes: summary.p50_minutes ?? null,
    p90_minutes: summary.p90_minutes ?? null,
    max_minutes: summary.max_minutes ?? null,
    prompt_repair_required_count: caseResults.filter((item) => item.prompt_repair_required === true).length,
  };
}

function summarizeProductReview(report, issues) {
  if (!report) {
    issues.push(issue(
      'NIMI2D_RELEASE_PRODUCT_REVIEW_NOT_RECORDED',
      '$.product_review_report',
      'No passing product review report was supplied for this release candidate.',
    ));
    return {
      status: 'missing',
      source: 'not_recorded',
    };
  }
  const criteria = report.criteria ?? {};
  const requiredCriteria = [
    'identity_preservation',
    'layer_alignment',
    'expression_readability',
    'wardrobe_readiness',
    'product_fit',
  ];
  const verdict = verdictOf(report);
  const missingCriteria = requiredCriteria.filter((key) => !(key in criteria));
  const missingOrFailed = requiredCriteria.filter((key) => criteria[key] !== 'pass');
  const formatValid = report.manifest_kind === 'nimi.nimi2d.product-review-report'
    && report.review_scope === 'release_candidate'
    && typeof report.reviewer?.id === 'string'
    && report.reviewer.id.length > 0
    && typeof report.reviewer?.role === 'string'
    && report.reviewer.role.length > 0
    && typeof report.reviewed_at === 'string'
    && report.reviewed_at.length > 0;
  const criteriaValuesValid = requiredCriteria.every((key) => ['pass', 'fail'].includes(criteria[key]));
  const passingReview = formatValid
    && criteriaValuesValid
    && verdict === 'pass'
    && missingOrFailed.length === 0;
  const failingReview = formatValid
    && criteriaValuesValid
    && verdict === 'fail'
    && missingCriteria.length === 0
    && missingOrFailed.length > 0;
  if (failingReview) {
    issues.push(issue(
      'NIMI2D_RELEASE_PRODUCT_REVIEW_FAILED',
      '$.product_review_report',
      'Product review was recorded and failed one or more release-candidate criteria.',
    ));
  } else if (!passingReview) {
    issues.push(issue(
      'NIMI2D_RELEASE_PRODUCT_REVIEW_REPORT_INVALID',
      '$.product_review_report',
      'Product review report must pass all required release-candidate review criteria.',
    ));
  }
  return {
    status: passingReview ? 'pass' : 'fail',
    source: 'product_review_report',
    reviewer_id: report.reviewer?.id ?? null,
    reviewer_role: report.reviewer?.role ?? null,
    reviewed_at: report.reviewed_at ?? null,
    missing_or_failed_criteria: missingOrFailed,
  };
}

async function validateReleaseProductEvidence(options = {}) {
  const manualCorrectionReport = options.manualCorrectionReportPath
    ? await readStructured(options.manualCorrectionReportPath)
    : null;
  const productReviewReport = options.productReviewReportPath
    ? await readStructured(options.productReviewReportPath)
    : null;
  const generationBench = options.generationBenchResultPath
    ? await readStructured(options.generationBenchResultPath)
    : null;
  const issues = [];
  const manualCorrection = summarizeManualCorrection(manualCorrectionReport, generationBench, issues);
  const productReview = summarizeProductReview(productReviewReport, issues);
  const passed = issues.length === 0;
  const report = {
    manifest_kind: 'nimi.nimi2d.release-product-evidence-report',
    schema_version: 1,
    inputs: {
      manual_correction_report_path: options.manualCorrectionReportPath ? path.resolve(options.manualCorrectionReportPath) : null,
      product_review_report_path: options.productReviewReportPath ? path.resolve(options.productReviewReportPath) : null,
      generation_bench_result_path: options.generationBenchResultPath ? path.resolve(options.generationBenchResultPath) : null,
    },
    manual_correction: manualCorrection,
    product_review: productReview,
    decision: {
      verdict: passed ? 'pass' : 'fail',
      reason: passed
        ? 'Release product evidence reports are valid.'
        : 'Release product evidence reports are missing, invalid, or failing.',
    },
    issues,
    codes: [...new Set(issues.map((item) => item.code))],
  };
  const outPath = await writeReport(options.outPath, report);
  return {
    status: passed ? 'ok' : 'reject',
    kind: 'release_product_evidence_report',
    outPath,
    decision: report.decision,
    report,
    codes: report.codes,
    issues,
  };
}

export {
  issue,
  readStructured,
  summarizeManualCorrection,
  summarizeProductReview,
  validateReleaseProductEvidence,
  verdictOf,
};
