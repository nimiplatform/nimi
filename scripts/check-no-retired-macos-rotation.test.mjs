import assert from 'node:assert/strict';
import test from 'node:test';
import { findRetiredMacOSRotationIdentifiers } from './check-no-retired-macos-rotation.mjs';

const retiredCommand = `pnpm_${['rotate', 'macos', 'dev', 'trust', 'helper'].join('_')}`;
const retiredType = ['TrustHelper', 'Rotation'].join('');

test('active source rejects each retired macOS rotation identifier', () => {
  const findings = findRetiredMacOSRotationIdentifiers(new Map([
    ['scripts/example-a.mjs', `const command = '${retiredCommand}';`],
    ['apps/desktop/macos/example-b.swift', `struct ${retiredType} {}`],
  ]));
  assert.deepEqual(findings.map((finding) => finding.relative), [
    'scripts/example-a.mjs',
    'apps/desktop/macos/example-b.swift',
  ]);
});

test('local evidence and archives are outside active-source enforcement', () => {
  const findings = findRetiredMacOSRotationIdentifiers(new Map([
    ['.nimi/local/evidence.txt', retiredCommand],
    ['archive/retired.txt', retiredType],
    ['runtime/archive/retired.txt', retiredCommand],
  ]));
  assert.deepEqual(findings, []);
});

test('fresh carrier 4 vocabulary remains admitted', () => {
  const findings = findRetiredMacOSRotationIdentifiers(new Map([
    ['scripts/fresh.mjs', 'fresh-carrier-4 candidate; legacy-local-dev-profile-not-supported'],
  ]));
  assert.deepEqual(findings, []);
});
