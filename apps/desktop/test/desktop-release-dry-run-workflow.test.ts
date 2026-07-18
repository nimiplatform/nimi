import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'desktop-release-dry-run.yml');
const releaseWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml');

test('desktop dry-run upload path output uses GitHub multiline records', () => {
  const source = fs.readFileSync(workflowPath, 'utf8');
  const startIndex = source.indexOf('- name: Compose desktop dry-run upload paths');
  const endIndex = source.indexOf('- name: Upload desktop dry-run artifacts', startIndex);
  assert.ok(startIndex >= 0, 'compose upload paths workflow step must exist');
  assert.ok(endIndex > startIndex, 'upload artifacts workflow step must follow compose step');

  const stepSource = source.slice(startIndex, endIndex);
  const outputLines = stepSource
    .split('\n')
    .filter((line) => line.includes('fs.appendFileSync(outputPath'));

  assert.ok(outputLines.length >= 3, 'compose step must write multiline output records');
  for (const line of outputLines) {
    assert.doesNotMatch(
      line,
      /\\\\n/,
      'GitHub output command records must use newline escapes, not literal backslash-newline text',
    );
  }
});

test('macOS release workflows fail closed without Developer ID signing and notarization', () => {
  for (const candidate of [releaseWorkflowPath, workflowPath]) {
    const source = fs.readFileSync(candidate, 'utf8');
    assert.match(source, /mode='developer-id'/u);
    assert.match(source, /APPLE_CERTIFICATE is required for developer-id macOS signing/u);
    assert.match(source, /APPLE_ID is required for developer-id macOS notarization/u);
    assert.match(source, /APPLE_TEAM_ID is required for developer-id macOS notarization/u);
    assert.doesNotMatch(source, /macOS ad-hoc|mode='ad-hoc'|APPLE_SIGNING_IDENTITY: '-'/u);
    assert.doesNotMatch(source, /NIMI_DESKTOP_MACOS_SIGNING_MODE \|\|/u);
  }
});
