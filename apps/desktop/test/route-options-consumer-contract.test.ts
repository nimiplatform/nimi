import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const desktopDir = resolve(import.meta.dirname, '..');

function readRendererFile(relativePath: string): string {
  return readFileSync(resolve(desktopDir, `src/shell/renderer/${relativePath}`), 'utf8');
}

function rendererPath(relativePath: string): string {
  return resolve(desktopDir, `src/shell/renderer/${relativePath}`);
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

test('desktop keeps route options ownership outside the extracted Tester product surface', () => {
  assert.equal(existsSync(rendererPath('features/tester/tester-state.ts')), false);
  assert.equal(existsSync(dirname(rendererPath('features/tester/tester-state.ts'))), false);
  const source = readRendererFile('features/runtime-config/desktop-route-options-service.ts');
  assert.doesNotMatch(source, /features\/tester|createModRuntimeClient/);
});
