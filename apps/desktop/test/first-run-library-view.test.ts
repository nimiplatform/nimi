import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const viewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/library-view.tsx'),
  'utf8',
);

test('LibraryView source renders error banner for projection.status === "error"', () => {
  assert.match(viewSource, /projection\.status === 'error'/);
  assert.match(viewSource, /data-testid="library-error"/);
});

test('LibraryView source renders empty placeholder when projection has no entries', () => {
  assert.match(viewSource, /data-testid="library-empty"/);
});

test('LibraryView source labels all canonical trust tiers', () => {
  for (const tier of ['nimi-first-party', 'nimi-verified-partner', 'nimi-community']) {
    assert.ok(viewSource.includes(tier), `LibraryView missing trust tier "${tier}"`);
  }
});

test('LibraryView source labels all canonical launch readiness states', () => {
  for (const state of [
    'ready',
    'install-required',
    'update-required',
    'repair-required',
    'permission-required',
    'blocked-by-master-gate',
    'unsupported',
  ]) {
    assert.ok(viewSource.includes(state), `LibraryView missing readiness "${state}"`);
  }
});

test('LibraryView source carries data-testid hooks for entry list + per-entry slots', () => {
  assert.ok(viewSource.includes('data-testid="library-entry-list"'));
  assert.ok(viewSource.includes('data-testid={`library-entry-${entry.app.appId}`}'));
  assert.ok(viewSource.includes('data-testid={`library-entry-${entry.app.appId}-name`}'));
  assert.ok(viewSource.includes('data-testid={`library-entry-${entry.app.appId}-tier`}'));
  assert.ok(viewSource.includes('data-testid={`library-entry-${entry.app.appId}-state`}'));
});

test('LibraryView source is pure presentational (no useState/useEffect/useReducer)', () => {
  assert.doesNotMatch(viewSource, /\buseState\b/);
  assert.doesNotMatch(viewSource, /\buseEffect\b/);
  assert.doesNotMatch(viewSource, /\buseReducer\b/);
});

test('LibraryView source does not admit public mod/extension product kinds in labels', () => {
  assert.doesNotMatch(viewSource, /\bMod Hub\b/);
  assert.doesNotMatch(viewSource, /\bPublic Mod\b/);
  assert.doesNotMatch(viewSource, /\bExtension\b/);
});

test('LibraryView source has no provider/model identifier string constants', () => {
  const forbidden =
    /\b(openai|anthropic|claude(?:-[a-z0-9-]+)?|gpt(?:-[a-z0-9.]+)?|gemini(?:-[a-z0-9.-]+)?|deepseek(?:-[a-z0-9.-]+)?|qwen(?:[0-9a-z.-]+)?|mistral(?:-[a-z0-9.-]+)?|llama(?:[.-][a-z0-9.-]+)?|ollama|llamacpp|vllm)\b/i;
  const stringLiteral = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
  let match: RegExpExecArray | null;
  stringLiteral.lastIndex = 0;
  while ((match = stringLiteral.exec(viewSource)) !== null) {
    const literal = match[2];
    if (literal && forbidden.test(literal)) {
      assert.fail(`forbidden identifier "${literal}" found in LibraryView`);
    }
  }
});

test('LibraryView source uses heading + aria-labelledby for accessibility', () => {
  assert.match(viewSource, /<h2 id="library-view-title"/);
  assert.match(viewSource, /aria-labelledby="library-view-title"/);
});
