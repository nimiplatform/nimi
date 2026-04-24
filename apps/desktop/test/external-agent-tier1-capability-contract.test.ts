import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('tier-1 external agent actions derive required capabilities from lifecycle domains', () => {
  const source = readDesktopFile('src/runtime/external-agent/tier1-actions.ts');
  assert.match(source, /function tier1ActionCapabilities/);
  assert.match(source, /`action\.discover\.\$\{actionId\}`/);
  assert.match(source, /`action\.dry-run\.\$\{actionId\}`/);
  assert.match(source, /`action\.verify\.\$\{actionId\}`/);
  assert.match(source, /`action\.commit\.\$\{actionId\}`/);
  assert.doesNotMatch(source, /requiredCapabilities:\s*\[\s*'action\.commit\.runtime\.local-ai\.models\.[^']+'\s*\]/);
});

test('tier-1 dry-run capabilities are limited to actions that support dry-run', () => {
  const source = readDesktopFile('src/runtime/external-agent/tier1-actions.ts');
  assert.match(
    source,
    /runtime\.local-ai\.models\.list'[\s\S]*requiredCapabilities: tier1ActionCapabilities\('runtime\.local-ai\.models\.list', \{ supportsDryRun: true \}\)/,
  );
  assert.match(
    source,
    /runtime\.local-ai\.models\.health'[\s\S]*requiredCapabilities: tier1ActionCapabilities\('runtime\.local-ai\.models\.health', \{ supportsDryRun: true \}\)/,
  );
  assert.match(
    source,
    /runtime\.local-ai\.models\.start'[\s\S]*requiredCapabilities: tier1ActionCapabilities\('runtime\.local-ai\.models\.start', \{ supportsDryRun: false \}\)/,
  );
  assert.match(
    source,
    /runtime\.local-ai\.models\.install'[\s\S]*requiredCapabilities: tier1ActionCapabilities\('runtime\.local-ai\.models\.install', \{ supportsDryRun: false \}\)/,
  );
});
