import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, writeJson, writeText } from './context.mjs';

function destination(t) {
  const directory = fs.mkdtempSync(path.join(repoRoot, '.nimi/local/sdk-generation-test-'));
  t.after(() => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      if (fs.statSync(file).isDirectory()) fs.rmdirSync(file);
      else fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  });
  return { directory, file: path.join(directory, 'projection.ts') };
}

test('generator replaces complete content and leaves an unchanged projection untouched', (t) => {
  const { directory, file } = destination(t);
  const relative = path.relative(repoRoot, file);
  writeText(relative, 'before');
  writeText(relative, '完整 replacement');
  assert.equal(fs.readFileSync(file, 'utf8'), '完整 replacement\n');
  fs.utimesSync(file, new Date(0), new Date(0));
  writeText(relative, '完整 replacement\n');
  assert.equal(fs.statSync(file).mtimeMs, 0);
  writeJson(relative, { actual: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { actual: true });
  assert.deepEqual(fs.readdirSync(directory), ['projection.ts']);
});

test('a refused destination remains untouched without leftover files', (t) => {
  const { directory, file } = destination(t);
  fs.mkdirSync(file);
  assert.throws(() => writeText(path.relative(repoRoot, file), 'cannot replace a directory'));
  assert.ok(fs.statSync(file).isDirectory());
  assert.deepEqual(fs.readdirSync(directory), ['projection.ts']);
});
