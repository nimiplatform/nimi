import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('run history append propagates storage read failures instead of overwriting with empty history', () => {
  const source = read('src/tester/tester-history-storage.ts');

  assert.match(source, /export async function appendTesterRunHistory/);
  assert.doesNotMatch(source, /loadTesterRunHistory\(\)\.catch\(\(\) => \(\{\} as TesterRunHistory\)\)/);
});

test('image history append propagates storage read failures instead of overwriting with empty history', () => {
  const source = read('src/tester/tester-image-history.ts');

  assert.match(source, /export async function appendTesterImageHistoryRecord/);
  assert.doesNotMatch(source, /loadTesterImageHistory\(\)\.catch\(\(\) => \[\] as TesterImageHistoryRecord\[\]\)/);
});
