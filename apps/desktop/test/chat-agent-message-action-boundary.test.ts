import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const executionEngineInternalsSource = readSource(
  '../src/shell/renderer/features/chat/chat-nimi-execution-engine-internals.ts',
);

test('image readiness does not suppress model-planned image action existence', () => {
  assert.doesNotMatch(
    executionEngineInternalsSource,
    /image\.generate capability is unavailable[\s\S]*do not emit an image action/,
  );
  assert.doesNotMatch(
    executionEngineInternalsSource,
    /imageReady\s*===\s*false[\s\S]*do not emit an image action/,
  );
  assert.match(
    executionEngineInternalsSource,
    /Image capability readiness affects execution only; it must not decide whether a model-planned image action exists\./,
  );
  assert.match(
    executionEngineInternalsSource,
    /emit exactly one <action id="image-0" kind="image">/,
  );
});
