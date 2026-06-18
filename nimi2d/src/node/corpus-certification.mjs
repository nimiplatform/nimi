import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { validateBenchCorpus } from './generation-bench.mjs';

const defaultRequiredDistributionTags = [
  'realm_persona_representative',
  'expression_stress',
  'wardrobe_stress',
  'anchor_stress',
];

function issue(code, pathLabel, message) {
  return { code, path: pathLabel, message };
}

function sourceRefs(item) {
  return [
    item.source_evidence?.layer_generation_ref,
    item.source_evidence?.identity_preservation_ref,
    item.source_evidence?.content_admission_ref,
    item.source_evidence?.occlusion_completion_ref,
  ].filter((value) => typeof value === 'string');
}

function hasDemoSourceEvidence(item) {
  return sourceRefs(item).some((ref) => /\b(fixture|demo|generated|synthetic)\b/i.test(ref));
}

async function writeReport(outPath, report) {
  if (!outPath) return null;
  const absoluteOut = path.resolve(outPath);
  await mkdir(path.dirname(absoluteOut), { recursive: true });
  await writeFile(absoluteOut, YAML.stringify(report), 'utf8');
  return absoluteOut;
}

export async function certifyBenchCorpus(corpusPath, options = {}) {
  const minCertifiedCases = options.minCertifiedCases ?? 8;
  const minInvalidCases = options.minInvalidCases ?? 5;
  const requiredDistributionTags = options.requiredDistributionTags ?? defaultRequiredDistributionTags;
  const corpusResult = await validateBenchCorpus(corpusPath);
  const issues = [...corpusResult.issues];
  const corpus = corpusResult.value ?? null;
  const report = {
    manifest_kind: 'nimi.nimi2d.certified-corpus-report',
    schema_version: 1,
    corpus_path: path.resolve(corpusPath),
    certification_scope: 'corpus_manifest_certification',
    requirements: {
      min_certified_good_tier1_cases: minCertifiedCases,
      min_invalid_contract_cases: minInvalidCases,
      required_distribution_tags: requiredDistributionTags,
      demo_fixture_source_evidence_allowed: false,
    },
    summary: {
      certified_good_tier1_count: 0,
      invalid_contract_count: 0,
      unique_certified_content_hash_count: 0,
      distribution_tags_seen: [],
    },
    decision: {
      verdict: 'fail',
      reason: 'Corpus manifest is not certified for release-gate use.',
    },
  };

  if (corpusResult.status === 'ok') {
    const certifiedIds = corpus.case_splits.certified_good_tier1 ?? [];
    const invalidIds = corpus.case_splits.invalid_contract ?? [];
    const certifiedSet = new Set(certifiedIds);
    const certifiedCases = corpus.cases.filter((item) => certifiedSet.has(item.case_id));
    const certifiedHashes = new Set(certifiedCases.map((item) => item.content_hash_sha256));
    const tagSet = new Set(certifiedCases.flatMap((item) => item.distribution_tags ?? []));
    report.summary = {
      certified_good_tier1_count: certifiedCases.length,
      invalid_contract_count: invalidIds.length,
      unique_certified_content_hash_count: certifiedHashes.size,
      distribution_tags_seen: [...tagSet].sort(),
    };

    if (certifiedCases.length < minCertifiedCases) {
      issues.push(issue(
        'NIMI2D_CERTIFIED_CORPUS_TOO_FEW_CERTIFIED_CASES',
        '$.case_splits.certified_good_tier1',
        `Certified corpus requires at least ${minCertifiedCases} certified-good tier-1 cases.`,
      ));
    }
    if (invalidIds.length < minInvalidCases) {
      issues.push(issue(
        'NIMI2D_CERTIFIED_CORPUS_TOO_FEW_INVALID_CASES',
        '$.case_splits.invalid_contract',
        `Certified corpus requires at least ${minInvalidCases} invalid contract cases.`,
      ));
    }
    if (certifiedHashes.size !== certifiedCases.length) {
      issues.push(issue(
        'NIMI2D_CERTIFIED_CORPUS_DUPLICATE_CONTENT_HASH',
        '$.cases',
        'Certified-good cases must have unique content hashes.',
      ));
    }
    for (const tag of requiredDistributionTags) {
      if (!tagSet.has(tag)) {
        issues.push(issue(
          'NIMI2D_CERTIFIED_CORPUS_DISTRIBUTION_TAG_MISSING',
          '$.cases[].distribution_tags',
          `Certified corpus is missing required distribution tag ${tag}.`,
        ));
      }
    }
    for (const [index, item] of certifiedCases.entries()) {
      const base = `$.cases[${index}]`;
      if (item.expected_outcome !== 'admit') {
        issues.push(issue(
          'NIMI2D_CERTIFIED_CORPUS_CASE_OUTCOME_INVALID',
          `${base}.expected_outcome`,
          'Certified-good tier-1 cases must expect admit.',
        ));
      }
      if (item.target_tier !== 'tier-1_agent_basic') {
        issues.push(issue(
          'NIMI2D_CERTIFIED_CORPUS_TARGET_TIER_INVALID',
          `${base}.target_tier`,
          'Certified-good release cases must target tier-1_agent_basic.',
        ));
      }
      if (hasDemoSourceEvidence(item)) {
        issues.push(issue(
          'NIMI2D_CERTIFIED_CORPUS_SOURCE_NOT_CERTIFIED',
          `${base}.source_evidence`,
          'Certified corpus cannot use fixture, demo, generated, or synthetic source evidence refs.',
        ));
      }
    }
  }

  const codes = [...new Set(issues.map((item) => item.code))];
  const passed = issues.length === 0;
  report.issues = issues;
  report.codes = codes;
  report.decision = {
    verdict: passed ? 'pass' : 'fail',
    reason: passed
      ? 'Corpus manifest satisfies certified-good release-gate protocol.'
      : 'Corpus manifest is not certified for release-gate use.',
  };
  const outPath = await writeReport(options.outPath, report);
  return {
    status: passed ? 'ok' : 'reject',
    kind: 'certified_corpus_report',
    outPath,
    decision: report.decision,
    report,
    codes,
    issues,
  };
}
