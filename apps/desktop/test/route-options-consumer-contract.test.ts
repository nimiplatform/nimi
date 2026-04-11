import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readRendererFile(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, `../src/shell/renderer/${relativePath}`), 'utf8');
}

test('desktop route options service delegates to host-owned runtime bootstrap route options', () => {
  const source = readRendererFile('features/runtime-config/desktop-route-options-service.ts');
  assert.match(source, /loadRuntimeRouteOptions/);
  assert.match(source, /return loadRuntimeRouteOptions\(\{ capability \}\)/);
});

test('desktop route model picker provider consumes shared desktop route options service instead of mod runtime client', () => {
  const source = readRendererFile('features/runtime-config/desktop-route-model-picker-provider.ts');
  assert.match(source, /loadDesktopRouteOptions/);
  assert.doesNotMatch(source, /createModRuntimeClient/);
});

test('tester route snapshot loading consumes shared desktop route options service instead of mod runtime client', () => {
  const source = readRendererFile('features/tester/tester-state.ts');
  assert.match(source, /loadDesktopRouteOptions/);
  assert.doesNotMatch(source, /createModRuntimeClient/);
});
