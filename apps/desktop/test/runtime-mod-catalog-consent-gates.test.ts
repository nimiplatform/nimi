import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalogRegistrySource = readFileSync(
  new URL('../src-tauri/src/runtime_mod/store/catalog_registry.rs', import.meta.url),
  'utf8',
);

function functionBody(name: string): string {
  const marker = `pub fn ${name}(`;
  const start = catalogRegistrySource.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = catalogRegistrySource.indexOf('{', start);
  assert.notEqual(bodyStart, -1, `${name} must have a body`);
  let depth = 0;
  for (let index = bodyStart; index < catalogRegistrySource.length; index += 1) {
    const char = catalogRegistrySource[index];
    if (char === '{') {
      depth += 1;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return catalogRegistrySource.slice(bodyStart + 1, index);
      }
    }
  }
  assert.fail(`${name} body must be balanced`);
}

for (const name of ['install_catalog_mod', 'update_installed_catalog_mod']) {
  test(`${name} gates consent before catalog mutation`, () => {
    const body = functionBody(name);
    const evaluateIndex = body.indexOf('let consent = evaluate_catalog_consent');
    const gateIndex = body.indexOf('require_catalog_consent_clear_before_mutation');
    const downloadIndex = body.indexOf('download_release_archive');
    const mutationIndex = body.indexOf('install_runtime_mod_common');

    assert.ok(evaluateIndex >= 0, `${name} must evaluate consent`);
    assert.ok(gateIndex > evaluateIndex, `${name} must gate after evaluating consent`);
    assert.ok(downloadIndex > gateIndex, `${name} must not download before consent is clear`);
    assert.ok(mutationIndex > gateIndex, `${name} must not mutate before consent is clear`);
  });
}
