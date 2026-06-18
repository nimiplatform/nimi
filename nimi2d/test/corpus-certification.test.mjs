import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import YAML from 'yaml';

import { certifyBenchCorpus } from '../src/index.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');
const fixtureCorpusPath = path.join(packageRoot, 'fixtures/basic-character/corpus.yaml');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeYaml(dir, name, value) {
  const file = path.join(dir, name);
  await writeFile(file, YAML.stringify(value), 'utf8');
  return file;
}

function certifiedCase(caseId, tags) {
  return {
    case_id: caseId,
    split: 'certified_good_tier1',
    layer_input_manifest_ref: `${caseId}.yaml`,
    content_hash_sha256: sha256(caseId),
    expected_outcome: 'admit',
    target_tier: 'tier-1_agent_basic',
    source_evidence: {
      layer_generation_ref: `upstream.realm_persona.${caseId}.layer_generation`,
      identity_preservation_ref: `upstream.realm_persona.${caseId}.identity`,
      content_admission_ref: `upstream.realm_persona.${caseId}.content`,
    },
    distribution_tags: tags,
  };
}

function invalidCase(caseId) {
  return {
    case_id: caseId,
    split: 'invalid_contract',
    layer_input_manifest_ref: `${caseId}.yaml`,
    content_hash_sha256: sha256(caseId),
    expected_outcome: 'reject',
    expected_reject_codes: ['NIMI2D_LAYER_INPUT_RAW_IMAGE_FORBIDDEN'],
    target_tier: 'tier-1_agent_basic',
    source_evidence: {
      layer_generation_ref: `upstream.realm_persona.${caseId}.layer_generation`,
      identity_preservation_ref: `upstream.realm_persona.${caseId}.identity`,
      content_admission_ref: `upstream.realm_persona.${caseId}.content`,
    },
    distribution_tags: ['contract_boundary'],
  };
}

async function writeCertifiableCorpus(dir) {
  const certifiedCases = [
    certifiedCase('n2d_case_representative_a', ['realm_persona_representative']),
    certifiedCase('n2d_case_expression_stress', ['realm_persona_representative', 'expression_stress']),
    certifiedCase('n2d_case_wardrobe_stress', ['realm_persona_representative', 'wardrobe_stress']),
    certifiedCase('n2d_case_anchor_stress', ['realm_persona_representative', 'anchor_stress']),
  ];
  const invalidCases = [
    invalidCase('n2d_case_invalid_raw_image'),
    invalidCase('n2d_case_invalid_missing_anchor'),
  ];
  return writeYaml(dir, 'corpus.yaml', {
    corpus_id: 'n2d_generation_corpus_certification_test',
    corpus_version: '0.0.0',
    corpus_digest_sha256: sha256('certification-test-corpus'),
    frozen: true,
    created_at: '2026-06-18T00:00:00Z',
    case_splits: {
      certified_good_tier1: certifiedCases.map((item) => item.case_id),
      invalid_contract: invalidCases.map((item) => item.case_id),
    },
    cases: [...certifiedCases, ...invalidCases],
  });
}

async function runCli(args) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
  });
  return JSON.parse(stdout);
}

test('certified corpus gate rejects demo fixture evidence and under-sized release corpus', async () => {
  const result = await certifyBenchCorpus(fixtureCorpusPath);
  assert.equal(result.status, 'reject');
  assert.equal(result.decision.verdict, 'fail');
  assert.ok(result.codes.includes('NIMI2D_CERTIFIED_CORPUS_TOO_FEW_CERTIFIED_CASES'));
  assert.ok(result.codes.includes('NIMI2D_CERTIFIED_CORPUS_DISTRIBUTION_TAG_MISSING'));
  assert.ok(result.codes.includes('NIMI2D_CERTIFIED_CORPUS_SOURCE_NOT_CERTIFIED'));
});

test('certified corpus gate admits curated source-backed distribution coverage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nimi2d-certified-corpus-'));
  const corpusPath = await writeCertifiableCorpus(dir);
  const reportPath = path.join(dir, 'certified-corpus-report.yaml');

  const result = await certifyBenchCorpus(corpusPath, {
    minCertifiedCases: 4,
    minInvalidCases: 2,
    outPath: reportPath,
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.decision.verdict, 'pass');
  assert.equal(result.report.summary.certified_good_tier1_count, 4);
  assert.equal(result.report.summary.invalid_contract_count, 2);
  assert.equal(result.report.summary.unique_certified_content_hash_count, 4);
  assert.deepEqual(result.report.summary.distribution_tags_seen, [
    'anchor_stress',
    'expression_stress',
    'realm_persona_representative',
    'wardrobe_stress',
  ]);
  const written = await readFile(reportPath, 'utf8');
  assert.equal(written.includes('manifest_kind: nimi.nimi2d.certified-corpus-report'), true);
});

test('CLI exposes certified corpus gate with explicit local thresholds', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nimi2d-certified-corpus-cli-'));
  const corpusPath = await writeCertifiableCorpus(dir);
  const reportPath = path.join(dir, 'certified-corpus-report.yaml');

  const result = await runCli([
    'certify-corpus',
    corpusPath,
    '--min-certified',
    '4',
    '--min-invalid',
    '2',
    '--out',
    reportPath,
  ]);

  assert.equal(result.status, 'ok');
  assert.equal(result.kind, 'certified_corpus_report');
  assert.equal(result.outPath, reportPath);
  assert.equal(result.report.decision.verdict, 'pass');
});
