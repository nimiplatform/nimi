import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('Desktop Runtime bridge has no public TCP endpoint or storage fallback', () => {
  const mainSource = readDesktopFile('src-electron/main.ts');
  const liveAcceptanceSource = readDesktopFile('scripts/run-electron-live-runtime-acceptance.mjs');

  assert.match(mainSource, /PROTECTED_DESKTOP_RUNTIME_TRANSPORT_REF\s*=\s*'protected-desktop-control'/);
  assert.doesNotMatch(mainSource, /NIMI_RUNTIME_GRPC_ADDR/);
  assert.doesNotMatch(mainSource, /NIMI_DESKTOP_ELECTRON_RUNTIME_ENDPOINT/);
  assert.doesNotMatch(mainSource, /127\.0\.0\.1:46371/);
  assert.doesNotMatch(mainSource, /runtime-get-app-storage/);
  assert.match(liveAcceptanceSource, /protectedRuntimeTransportRef\s*=\s*'protected-desktop-control'/);
  assert.doesNotMatch(liveAcceptanceSource, /NIMI_RUNTIME_GRPC_ADDR/);
  assert.doesNotMatch(liveAcceptanceSource, /NIMI_DESKTOP_ELECTRON_RUNTIME_ENDPOINT/);
  assert.doesNotMatch(liveAcceptanceSource, /127\.0\.0\.1:46371/);
  assert.match(liveAcceptanceSource, /assert\.deepEqual\(\s*consoleErrors,\s*\[\]/);
  assert.match(liveAcceptanceSource, /assert\.deepEqual\(\s*pageErrors,\s*\[\]/);
});

test('creator eligibility keeps unavailable distinct from not eligible', () => {
  const performanceSource = readDesktopFile('src/shell/renderer/features/settings/settings-performance-page.tsx');
  const english = JSON.parse(readDesktopFile('src/shell/renderer/locales/en/09-Performance.json')) as Record<string, string>;
  const chinese = JSON.parse(readDesktopFile('src/shell/renderer/locales/zh/09-Performance.json')) as Record<string, string>;

  assert.match(performanceSource, /const eligibilityState = eligibilityQuery\.isPending/);
  assert.match(performanceSource, /eligibilityQuery\.isError \|\| !eligibility\s*\? 'unavailable'/);
  assert.match(performanceSource, /eligibilityState === 'not-eligible'\s*\? 'warning'\s*:\s*'neutral'/);
  assert.match(performanceSource, /tone=\{eligibilityBadgeTone\}/);
  assert.doesNotMatch(performanceSource, /eligibility\?\.isEligible\s*\?\?\s*false/);
  assert.equal(english.eligibilityUnavailable, 'Unavailable');
  assert.equal(chinese.eligibilityUnavailable, '暂不可用');
  assert.match(chinese.eligibilityLoadError ?? '', /暂时无法获取创作者资格/);
});
