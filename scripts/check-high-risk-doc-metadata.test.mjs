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
    path.join(repoRoot, 'dev/research/example-design.md'),
    '# Example Design\n\ncontent\n',
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
    path.join(repoRoot, 'dev/research/example-design.md'),
    [
      '# Example Design',
      '',
      '> **Spec Status**: aligned',
      '> **Authority Owner**: runtime authority',
      '> **Work Type**: alignment',
      '> **Parallel Truth**: no',
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
    path.join(repoRoot, 'dev/plan/desktop-chat-refactor.md'),
    '# Desktop Chat Refactor\n\ncontent\n',
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
    path.join(repoRoot, 'dev/research/legacy-design.md'),
    '# Legacy Design\n',
  );
  writeFile(
    path.join(repoRoot, 'scripts/config/high-risk-doc-metadata-exemptions.yaml'),
    'version: 1\nexempt_paths:\n  - dev/research/legacy-design.md\n',
  );

  const report = evaluateHighRiskDocMetadata({ repoRoot });
  assert.equal(report.failures.length, 0);
});
