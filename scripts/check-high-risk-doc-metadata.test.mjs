import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateHighRiskDocMetadata } from './lib/check-high-risk-doc-metadata-core.mjs';

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('fails high-risk design docs without authority metadata', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-high-risk-docs-'));
  writeFile(
    path.join(repoRoot, 'nimi-coding/.local/example-topic/example-design.md'),
    [
      '---',
      'title: Example Design',
      'doc_type: explore',
      '---',
      '',
      '# Example Design',
      '',
      'content',
      '',
    ].join('\n'),
  );

  const report = evaluateHighRiskDocMetadata({
    repoRoot,
    exemptionsPath: path.join(repoRoot, 'scripts/config/high-risk-doc-metadata-exemptions.yaml'),
  });

  assert.equal(report.scanned.length, 1);
  assert.ok(report.failures.some((item) => item.includes('missing metadata field "Spec Status"')));
});

test('passes high-risk design docs with required metadata', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-high-risk-docs-'));
  writeFile(
    path.join(repoRoot, 'nimi-coding/.local/example-topic/example-design.md'),
    [
      '---',
      'title: Example Design',
      'doc_type: explore',
      'spec_status: aligned',
      'authority_owner: runtime authority',
      'work_type: alignment',
      'parallel_truth: no',
      '---',
      '',
      '# Example Design',
      '',
      'content',
      '',
    ].join('\n'),
  );

  const report = evaluateHighRiskDocMetadata({
    repoRoot,
    exemptionsPath: path.join(repoRoot, 'scripts/config/high-risk-doc-metadata-exemptions.yaml'),
  });

  assert.equal(report.failures.length, 0);
});

test('accepts preflight-required spec status in nimi-coding frontmatter docs', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-high-risk-docs-'));
  writeFile(
    path.join(repoRoot, 'nimi-coding/.local/example-topic/migration-design.md'),
    [
      '---',
      'title: Migration Design',
      'doc_type: explore',
      'spec_status: preflight-required',
      'authority_owner: desktop authority',
      'work_type: redesign',
      'parallel_truth: no',
      '---',
      '',
      '# Migration Design',
      '',
      'content',
      '',
    ].join('\n'),
  );

  const report = evaluateHighRiskDocMetadata({
    repoRoot,
    exemptionsPath: path.join(repoRoot, 'scripts/config/high-risk-doc-metadata-exemptions.yaml'),
  });

  assert.equal(report.failures.length, 0);
});

test('treats refactor plans as high-risk docs that require authority metadata', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-high-risk-docs-'));
  writeFile(
    path.join(repoRoot, 'nimi-coding/.local/example-topic/desktop-chat-refactor.md'),
    [
      '---',
      'title: Desktop Chat Refactor',
      'doc_type: baseline',
      '---',
      '',
      '# Desktop Chat Refactor',
      '',
      'content',
      '',
    ].join('\n'),
  );

  const report = evaluateHighRiskDocMetadata({
    repoRoot,
    exemptionsPath: path.join(repoRoot, 'scripts/config/high-risk-doc-metadata-exemptions.yaml'),
  });

  assert.equal(report.scanned.length, 1);
  assert.ok(report.failures.some((item) => item.includes('desktop-chat-refactor.md: missing metadata field "Spec Status"')));
});

test('skips exempted legacy docs', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-high-risk-docs-'));
  writeFile(
    path.join(repoRoot, 'archive/legacy-design.md'),
    '# Legacy Design\n',
  );
  writeFile(
    path.join(repoRoot, 'scripts/config/high-risk-doc-metadata-exemptions.yaml'),
    'version: 1\nexempt_paths:\n  - archive/legacy-design.md\n',
  );

  const report = evaluateHighRiskDocMetadata({ repoRoot });
  assert.equal(report.failures.length, 0);
});
