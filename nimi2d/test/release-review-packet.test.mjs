import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import YAML from 'yaml';

import { buildReleaseReviewPacket, validateReleaseReviewPacket } from '../src/index.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');
const fixtureCorpusPath = path.join(packageRoot, 'fixtures/basic-character/corpus.yaml');
const fixtureCorpusDir = path.dirname(fixtureCorpusPath);
const fixtureSourceImagePath = path.join(fixtureCorpusDir, 'pixel.png');

async function writeYaml(filePath, value) {
  await writeFile(filePath, YAML.stringify(value), 'utf8');
  return filePath;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeSourceReferences(tempDir) {
  const corpus = YAML.parse(await readFile(fixtureCorpusPath, 'utf8'));
  const certifiedIds = new Set(corpus.case_splits.certified_good_tier1);
  return writeYaml(path.join(tempDir, 'source-references.yaml'), {
    manifest_kind: 'nimi.nimi2d.release-review-source-references',
    schema_version: 1,
    case_source_refs: corpus.cases
      .filter((item) => certifiedIds.has(item.case_id))
      .map((item) => ({
        case_id: item.case_id,
        source_image_ref: path.resolve(fixtureSourceImagePath),
      })),
  });
}

test('release review packet renders certified-good corpus cases without faking product review', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-review-packet-'));
  const auditPath = await writeYaml(path.join(tempDir, 'release-candidate-audit.yaml'), {
    manifest_kind: 'nimi.nimi2d.release-candidate-audit',
    decision: { verdict: 'candidate_pass_product_blocked' },
    tier_chain: {
      t1_provider_distribution: { status: 'pass' },
      t2_corpus_certification: { status: 'pass' },
      t3_generation_bench: { status: 'pass' },
      t4_reference_response: { status: 'pass' },
    },
    product_readiness: {
      status: 'blocked',
      blockers: [
        'NIMI2D_RELEASE_MANUAL_CORRECTION_METRICS_NOT_MEASURED',
        'NIMI2D_RELEASE_PRODUCT_REVIEW_NOT_RECORDED',
      ],
    },
  });
  const outputDir = path.join(tempDir, 'packet');

  const result = await buildReleaseReviewPacket({
    corpusPath: fixtureCorpusPath,
    releaseCandidateAuditPath: auditPath,
    outputDir,
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.kind, 'release_review_packet');
  assert.equal(result.caseCount, 3);
  assert.equal(await exists(path.join(outputDir, 'index.html')), true);
  assert.equal(await exists(path.join(outputDir, 'release-review-packet.yaml')), true);
  assert.equal(await exists(path.join(outputDir, 'manual-correction-template.yaml')), true);
  assert.equal(await exists(path.join(outputDir, 'product-review-template.yaml')), true);
  assert.equal(await exists(path.join(outputDir, 'cases/n2d_case_basic_character/layers/layer_body-pixel.png')), true);

  const html = await readFile(path.join(outputDir, 'index.html'), 'utf8');
  assert.equal(html.includes('n2d_case_basic_character'), true);
  assert.equal(html.includes('Product review template remains pending'), true);

  const productTemplate = YAML.parse(await readFile(path.join(outputDir, 'product-review-template.yaml'), 'utf8'));
  assert.equal(productTemplate.decision.verdict, 'pending');
  assert.equal(productTemplate.criteria.identity_preservation, 'pending');

  const correctionTemplate = YAML.parse(await readFile(path.join(outputDir, 'manual-correction-template.yaml'), 'utf8'));
  assert.equal(correctionTemplate.summary.measured_case_count, null);
  assert.equal(correctionTemplate.case_results.length, 3);

  const validation = await validateReleaseReviewPacket({ packetDir: outputDir });
  assert.equal(validation.status, 'ok');
  assert.equal(validation.decision.verdict, 'pass');
  assert.equal(validation.report.summary.case_count, 3);
  assert.equal(validation.report.summary.missing_image_ref_count, 0);
  assert.ok(validation.report.summary.html_image_ref_count > 0);
});

test('release review packet renders source references and rejected product review state for browser QA', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-review-packet-source-'));
  const sourceReferencesPath = await writeSourceReferences(tempDir);
  const auditPath = await writeYaml(path.join(tempDir, 'release-candidate-audit.yaml'), {
    manifest_kind: 'nimi.nimi2d.release-candidate-audit',
    decision: { verdict: 'candidate_rejected_product_review' },
    tier_chain: {
      t1_provider_distribution: { status: 'pass' },
      t2_corpus_certification: { status: 'pass' },
      t3_generation_bench: { status: 'pass' },
      t4_reference_response: { status: 'pass' },
    },
    product_readiness: {
      status: 'failed_product_review',
      blockers: ['NIMI2D_RELEASE_PRODUCT_REVIEW_FAILED'],
    },
  });
  const outputDir = path.join(tempDir, 'packet');

  const result = await buildReleaseReviewPacket({
    corpusPath: fixtureCorpusPath,
    releaseCandidateAuditPath: auditPath,
    sourceReferencesPath,
    outputDir,
  });

  assert.equal(result.status, 'ok');
  const packet = YAML.parse(await readFile(path.join(outputDir, 'release-review-packet.yaml'), 'utf8'));
  assert.equal(packet.cases.length, 3);
  assert.equal(packet.release_candidate_audit.decision_verdict, 'candidate_rejected_product_review');
  for (const item of packet.cases) {
    assert.match(item.source_image_ref, /^cases\/[^/]+\/source\/pixel\.png$/);
    assert.equal(await exists(path.join(outputDir, item.source_image_ref)), true);
  }

  const html = await readFile(path.join(outputDir, 'index.html'), 'utf8');
  assert.equal(html.includes('candidate_rejected_product_review'), true);
  assert.equal(html.includes('Product review failed release candidate criteria.'), true);
  assert.equal(html.includes('class="source-preview"'), true);
  assert.equal(html.includes('data-source-ref='), true);
  assert.equal(html.includes('Source Reference'), true);

  const validation = await validateReleaseReviewPacket({ packetDir: outputDir });
  assert.equal(validation.status, 'ok');
  assert.equal(validation.report.summary.source_ref_count, 3);
  assert.equal(validation.report.summary.missing_source_ref_count, 0);
});

test('CLI builds release review packet', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-review-packet-cli-'));
  const auditPath = await writeYaml(path.join(tempDir, 'release-candidate-audit.yaml'), {
    manifest_kind: 'nimi.nimi2d.release-candidate-audit',
    decision: { verdict: 'candidate_pass_product_blocked' },
    tier_chain: {
      t1_provider_distribution: { status: 'pass' },
      t2_corpus_certification: { status: 'pass' },
      t3_generation_bench: { status: 'pass' },
      t4_reference_response: { status: 'pass' },
    },
    product_readiness: { status: 'blocked', blockers: [] },
  });
  const outputDir = path.join(tempDir, 'packet');
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    'build-release-review-packet',
    '--corpus', fixtureCorpusPath,
    '--release-candidate-audit', auditPath,
    '--out-dir', outputDir,
  ], { cwd: packageRoot });
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'ok');
  assert.equal(result.caseCount, 3);
  assert.equal(await exists(path.join(outputDir, 'index.html')), true);

  const validate = await execFileAsync(process.execPath, [
    cliPath,
    'validate-release-review-packet',
    '--packet-dir', outputDir,
    '--out', path.join(tempDir, 'packet-validation.yaml'),
  ], { cwd: packageRoot });
  const validation = JSON.parse(validate.stdout);
  assert.equal(validation.status, 'ok');
  assert.equal(validation.decision.verdict, 'pass');
});

test('release review packet validator rejects missing referenced images', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-review-packet-invalid-'));
  const auditPath = await writeYaml(path.join(tempDir, 'release-candidate-audit.yaml'), {
    manifest_kind: 'nimi.nimi2d.release-candidate-audit',
    decision: { verdict: 'candidate_pass_product_blocked' },
    tier_chain: {
      t1_provider_distribution: { status: 'pass' },
      t2_corpus_certification: { status: 'pass' },
      t3_generation_bench: { status: 'pass' },
      t4_reference_response: { status: 'pass' },
    },
    product_readiness: { status: 'blocked', blockers: [] },
  });
  const outputDir = path.join(tempDir, 'packet');
  await buildReleaseReviewPacket({
    corpusPath: fixtureCorpusPath,
    releaseCandidateAuditPath: auditPath,
    outputDir,
  });
  await rm(path.join(outputDir, 'cases/n2d_case_basic_character/layers/layer_body-pixel.png'));

  const validation = await validateReleaseReviewPacket({ packetDir: outputDir });

  assert.equal(validation.status, 'reject');
  assert.equal(validation.decision.verdict, 'fail');
  assert.equal(validation.codes.includes('NIMI2D_RELEASE_REVIEW_PACKET_IMAGE_REF_MISSING'), true);
});

test('release review packet validator rejects missing source references', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-review-packet-source-invalid-'));
  const sourceReferencesPath = await writeSourceReferences(tempDir);
  const auditPath = await writeYaml(path.join(tempDir, 'release-candidate-audit.yaml'), {
    manifest_kind: 'nimi.nimi2d.release-candidate-audit',
    decision: { verdict: 'candidate_rejected_product_review' },
    tier_chain: {
      t1_provider_distribution: { status: 'pass' },
      t2_corpus_certification: { status: 'pass' },
      t3_generation_bench: { status: 'pass' },
      t4_reference_response: { status: 'pass' },
    },
    product_readiness: { status: 'failed_product_review', blockers: ['NIMI2D_RELEASE_PRODUCT_REVIEW_FAILED'] },
  });
  const outputDir = path.join(tempDir, 'packet');
  await buildReleaseReviewPacket({
    corpusPath: fixtureCorpusPath,
    releaseCandidateAuditPath: auditPath,
    sourceReferencesPath,
    outputDir,
  });
  await rm(path.join(outputDir, 'cases/n2d_case_basic_character/source/pixel.png'));

  const validation = await validateReleaseReviewPacket({ packetDir: outputDir });

  assert.equal(validation.status, 'reject');
  assert.equal(validation.decision.verdict, 'fail');
  assert.equal(validation.codes.includes('NIMI2D_RELEASE_REVIEW_PACKET_SOURCE_REF_MISSING'), true);
  assert.equal(validation.report.summary.missing_source_ref_count, 1);
});
