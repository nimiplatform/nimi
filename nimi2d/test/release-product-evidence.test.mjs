import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import YAML from 'yaml';

import { validateReleaseProductEvidence } from '../src/index.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');

async function writeYaml(filePath, value) {
  await writeFile(filePath, YAML.stringify(value), 'utf8');
  return filePath;
}

function validManualCorrectionReport() {
  return {
    manifest_kind: 'nimi.nimi2d.manual-correction-report',
    schema_version: 1,
    measurement_scope: 'release_candidate',
    case_results: [
      { case_id: 'case-01', correction_minutes: 0, prompt_repair_required: false },
      { case_id: 'case-02', correction_minutes: 3, prompt_repair_required: true },
      { case_id: 'case-03', correction_minutes: 5, prompt_repair_required: true },
    ],
    summary: {
      measured_case_count: 3,
      p50_minutes: 3,
      p90_minutes: 5,
      max_minutes: 5,
    },
    decision: {
      verdict: 'pass',
      reason: 'Measured correction minutes are recorded.',
    },
  };
}

function validProductReviewReport() {
  return {
    manifest_kind: 'nimi.nimi2d.product-review-report',
    schema_version: 1,
    review_scope: 'release_candidate',
    reviewer: {
      id: 'reviewer-01',
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
      reason: 'Product review passed.',
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
    notes: [
      'source03_repair composite has a disproportionate head/face layer over the body.',
      'source04 eye layer contains stray pixels near the top edge.',
    ],
    decision: {
      verdict: 'fail',
      reason: 'Visual QA recorded release-candidate product defects.',
    },
  };
}

test('release product evidence validator accepts measured correction and passing review reports', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-product-evidence-'));
  const correctionPath = await writeYaml(path.join(tempDir, 'manual-correction.yaml'), validManualCorrectionReport());
  const productReviewPath = await writeYaml(path.join(tempDir, 'product-review.yaml'), validProductReviewReport());
  const outPath = path.join(tempDir, 'product-evidence-report.yaml');

  const result = await validateReleaseProductEvidence({
    manualCorrectionReportPath: correctionPath,
    productReviewReportPath: productReviewPath,
    outPath,
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.decision.verdict, 'pass');
  assert.equal(result.report.manual_correction.status, 'pass');
  assert.equal(result.report.product_review.status, 'pass');
  assert.deepEqual(result.codes, []);
  const written = await readFile(outPath, 'utf8');
  assert.equal(written.includes('manifest_kind: nimi.nimi2d.release-product-evidence-report'), true);
});

test('release product evidence validator records failing product review as valid failed evidence', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-product-evidence-failing-review-'));
  const correctionPath = await writeYaml(path.join(tempDir, 'manual-correction.yaml'), validManualCorrectionReport());
  const productReviewPath = await writeYaml(path.join(tempDir, 'product-review.yaml'), failingProductReviewReport());

  const result = await validateReleaseProductEvidence({
    manualCorrectionReportPath: correctionPath,
    productReviewReportPath: productReviewPath,
  });

  assert.equal(result.status, 'reject');
  assert.equal(result.decision.verdict, 'fail');
  assert.equal(result.decision.reason, 'Release product evidence reports are missing, invalid, or failing.');
  assert.equal(result.report.manual_correction.status, 'pass');
  assert.equal(result.report.product_review.status, 'fail');
  assert.deepEqual(result.report.product_review.missing_or_failed_criteria, [
    'layer_alignment',
    'expression_readability',
    'product_fit',
  ]);
  assert.deepEqual(result.codes, ['NIMI2D_RELEASE_PRODUCT_REVIEW_FAILED']);
});

test('release product evidence validator rejects pending review packet templates', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-product-evidence-pending-'));
  const correctionPath = await writeYaml(path.join(tempDir, 'manual-correction.yaml'), {
    manifest_kind: 'nimi.nimi2d.manual-correction-report',
    schema_version: 1,
    measurement_scope: 'release_candidate',
    case_results: [
      { case_id: 'case-01', correction_minutes: null, prompt_repair_required: null },
    ],
    summary: {
      measured_case_count: null,
      p50_minutes: null,
      p90_minutes: null,
      max_minutes: null,
    },
    decision: { verdict: 'pending' },
  });
  const productReviewPath = await writeYaml(path.join(tempDir, 'product-review.yaml'), {
    manifest_kind: 'nimi.nimi2d.product-review-report',
    schema_version: 1,
    review_scope: 'release_candidate',
    reviewer: { id: null, role: null },
    reviewed_at: null,
    criteria: {
      identity_preservation: 'pending',
      layer_alignment: 'pending',
      expression_readability: 'pending',
      wardrobe_readiness: 'pending',
      product_fit: 'pending',
    },
    decision: { verdict: 'pending' },
  });

  const result = await validateReleaseProductEvidence({
    manualCorrectionReportPath: correctionPath,
    productReviewReportPath: productReviewPath,
  });

  assert.equal(result.status, 'reject');
  assert.equal(result.decision.verdict, 'fail');
  assert.equal(result.codes.includes('NIMI2D_RELEASE_MANUAL_CORRECTION_REPORT_INVALID'), true);
  assert.equal(result.codes.includes('NIMI2D_RELEASE_PRODUCT_REVIEW_REPORT_INVALID'), true);
});

test('CLI validates release product evidence reports', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-product-evidence-cli-'));
  const correctionPath = await writeYaml(path.join(tempDir, 'manual-correction.yaml'), validManualCorrectionReport());
  const productReviewPath = await writeYaml(path.join(tempDir, 'product-review.yaml'), validProductReviewReport());
  const outPath = path.join(tempDir, 'product-evidence-report.yaml');
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    'validate-release-product-evidence',
    '--manual-correction-report', correctionPath,
    '--product-review-report', productReviewPath,
    '--out', outPath,
  ], { cwd: packageRoot });
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'ok');
  assert.equal(result.decision.verdict, 'pass');
});
