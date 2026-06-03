import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const desktopRoot = resolve(import.meta.dirname, '..');
const desktopSrcRoot = join(desktopRoot, 'src');
const forbiddenRuntimeDataSyncDir = join(desktopSrcRoot, 'runtime', 'data-sync');

function listSourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = join(root, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(filePath));
      continue;
    }
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

describe('D-DSYNC-000: Desktop DataSync facade is non-admitted', () => {
  test('runtime data-sync facade directory does not exist', () => {
    assert.equal(existsSync(forbiddenRuntimeDataSyncDir), false);
  });

  test('desktop source does not import or call a DataSync facade', () => {
    const offenders = listSourceFiles(desktopSrcRoot)
      .map((filePath) => ({
        filePath,
        source: readFileSync(filePath, 'utf8'),
      }))
      .filter(({ source }) => (
        /@runtime\/data-sync/.test(source)
        || /runtime\/data-sync/.test(source)
        || /\bdataSync\./.test(source)
      ))
      .map(({ filePath }) => filePath);

    assert.deepEqual(offenders, []);
  });
});
