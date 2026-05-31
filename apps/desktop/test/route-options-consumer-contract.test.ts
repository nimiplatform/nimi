import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopDir = resolve(import.meta.dirname, '..');

function readRendererFile(relativePath: string): string {
  return readFileSync(resolve(desktopDir, `src/shell/renderer/${relativePath}`), 'utf8');
}

test('desktop route options service delegates to host-owned runtime bootstrap route options', () => {
  const source = readRendererFile('features/runtime-config/desktop-route-options-service.ts');
  assert.match(source, /loadRuntimeRouteOptions/);
  assert.match(source, /return loadRuntimeRouteOptions\(\{ capability, targetId: input\?\.targetId \}\)/);
});

test('desktop route model picker provider consumes shared desktop route options service instead of mod runtime client', () => {
  const source = readRendererFile('features/runtime-config/desktop-route-model-picker-provider.ts');
  assert.match(source, /createRuntimeRouteModelPickerProviderCache/);
  assert.match(source, /loadDesktopRouteOptions/);
  assert.doesNotMatch(source, /createModRuntimeClient/);
});

test('desktop keeps route options ownership outside retired product-local runtime clients', () => {
  const source = readRendererFile('features/runtime-config/desktop-route-options-service.ts');
  assert.doesNotMatch(source, /createModRuntimeClient/);
});
