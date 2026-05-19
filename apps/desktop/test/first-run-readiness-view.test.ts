import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const viewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/readiness-view.tsx'),
  'utf8',
);

test('FirstRunReadinessView source includes one branch per canonical FirstRunStep label', () => {
  const expectedSteps = [
    'runtimeDaemon',
    'account',
    'aiProfileSelection',
    'materialization',
    'appRegistry',
    'cognitionMemory',
  ];
  for (const step of expectedSteps) {
    assert.ok(viewSource.includes(step), `view source missing canonical step "${step}"`);
  }
});

test('FirstRunReadinessView source includes one branch per canonical ColdStartState label', () => {
  const expectedStates = [
    'unavailable',
    'setup-required',
    'needs-confirmation',
    'in-progress',
    'failed',
    'unsupported',
    'stale-projection',
    'ready',
  ];
  for (const state of expectedStates) {
    assert.ok(viewSource.includes(state), `view source missing canonical state "${state}"`);
  }
});

test('FirstRunReadinessView source exposes data-ready attribute driven by projection.isReady', () => {
  assert.match(viewSource, /data-ready=\{projection\.isReady \? 'true' : 'false'\}/);
});

test('FirstRunReadinessView source includes data-testid hooks for testability', () => {
  assert.ok(viewSource.includes("data-testid=\"first-run-readiness\""));
  assert.ok(viewSource.includes("data-testid=\"first-run-overall-state\""));
  assert.ok(viewSource.includes("data-testid=\"first-run-step-list\""));
  assert.ok(viewSource.includes('data-testid={`first-run-step-${step.step}`}'));
});

test('FirstRunReadinessView source has no provider/model identifier string constants', () => {
  const forbidden =
    /\b(openai|anthropic|claude(?:-[a-z0-9-]+)?|gpt(?:-[a-z0-9.]+)?|gemini(?:-[a-z0-9.-]+)?|deepseek(?:-[a-z0-9.-]+)?|qwen(?:[0-9a-z.-]+)?|mistral(?:-[a-z0-9.-]+)?|llama(?:[.-][a-z0-9.-]+)?|ollama|llamacpp|vllm)\b/i;
  const stringLiteral = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
  let match: RegExpExecArray | null;
  stringLiteral.lastIndex = 0;
  while ((match = stringLiteral.exec(viewSource)) !== null) {
    const literal = match[2];
    if (literal && forbidden.test(literal)) {
      assert.fail(`forbidden identifier "${literal}" found in view source`);
    }
  }
});

test('FirstRunReadinessView source is a pure presentational component (no useState/useEffect/useReducer)', () => {
  assert.doesNotMatch(viewSource, /\buseState\b/);
  assert.doesNotMatch(viewSource, /\buseEffect\b/);
  assert.doesNotMatch(viewSource, /\buseReducer\b/);
});

test('FirstRunReadinessView source uses heading and labelled-by for a11y', () => {
  assert.match(viewSource, /<h2 id="first-run-readiness-title"/);
  assert.match(viewSource, /aria-labelledby="first-run-readiness-title"/);
});

test('FirstRunReadinessView source omits "Nimi Desktop" / public mod / extension naming', () => {
  assert.doesNotMatch(viewSource, /Nimi Desktop/);
  assert.doesNotMatch(viewSource, /public mod/i);
  assert.doesNotMatch(viewSource, /extension/i);
});
