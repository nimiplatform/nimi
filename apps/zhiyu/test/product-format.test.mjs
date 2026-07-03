import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/app/product-format.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

const NOW = new Date('2026-07-02T20:30:00.000+08:00');

test('formats same-day timestamps as 今天 with local time', async () => {
  const { formatZhiyuObservedAtLabel } = await loadModule();
  const label = formatZhiyuObservedAtLabel('2026-07-02T14:56:18.455Z', NOW);
  assert.match(label, /^今天 \d{2}:\d{2}$/);
});

test('formats previous-day timestamps as 昨天 with local time', async () => {
  const { formatZhiyuObservedAtLabel } = await loadModule();
  const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const label = formatZhiyuObservedAtLabel(yesterday, NOW);
  assert.match(label, /^昨天 \d{2}:\d{2}$/);
});

test('formats older timestamps with a localized Chinese date', async () => {
  const { formatZhiyuObservedAtLabel } = await loadModule();
  const label = formatZhiyuObservedAtLabel('2026-06-01T02:00:00.000Z', NOW);
  assert.match(label, /月/);
  assert.match(label, /\d{2}:\d{2}$/);
  assert.doesNotMatch(label, /T|Z/);
});

test('treats missing, invalid, and epoch placeholder values as not observed', async () => {
  const { formatZhiyuObservedAtLabel } = await loadModule();
  assert.equal(formatZhiyuObservedAtLabel(null, NOW), '尚未观测');
  assert.equal(formatZhiyuObservedAtLabel(undefined, NOW), '尚未观测');
  assert.equal(formatZhiyuObservedAtLabel('not-a-date', NOW), '尚未观测');
  assert.equal(formatZhiyuObservedAtLabel('1970-01-01T00:00:00.000Z', NOW), '尚未观测');
});
