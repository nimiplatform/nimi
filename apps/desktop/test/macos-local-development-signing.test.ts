import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertMacOSLocalDevelopmentAdHocCodeSigningOutput,
} from '../scripts/lib/macos-local-development-release.mjs';

const identifier = 'ai.nimi.runtime.dev';
const validOutput = `
Identifier=${identifier}
CodeDirectory v=20500 size=244 flags=0x10002(adhoc,runtime) hashes=2+2 location=embedded
Signature=adhoc
TeamIdentifier=not set
`;

test('macOS local development accepts only the fixed ad-hoc hardened Runtime identity', () => {
  assert.doesNotThrow(() => {
    assertMacOSLocalDevelopmentAdHocCodeSigningOutput(validOutput, identifier);
  });
});

test('macOS local development rejects a wrong identifier or incomplete ad-hoc flags', () => {
  for (const output of [
    validOutput.replace(`Identifier=${identifier}`, 'Identifier=ai.nimi.runtime'),
    validOutput.replace('(adhoc,runtime)', '(adhoc)'),
    validOutput.replace('Signature=adhoc', 'Signature=Developer ID'),
  ]) {
    assert.throws(
      () => assertMacOSLocalDevelopmentAdHocCodeSigningOutput(output, identifier),
      /local-development ad-hoc code identity rejected/u,
    );
  }
});

test('macOS local development rejects certificate-backed signing metadata', () => {
  for (const output of [
    validOutput.replace('TeamIdentifier=not set', 'TeamIdentifier=ABCDEFGHIJ'),
    `${validOutput}Authority=Apple Development: Nimi Developer (ABCDEFGHIJ)\n`,
  ]) {
    assert.throws(
      () => assertMacOSLocalDevelopmentAdHocCodeSigningOutput(output, identifier),
      /local-development ad-hoc code identity rejected/u,
    );
  }
});
