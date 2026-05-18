import assert from 'node:assert/strict';
import test from 'node:test';
import { projectFirstRunReadiness, FIRST_RUN_STEPS } from '../src/shell/renderer/first-run/index.js';
import { DefaultExperienceBridge } from '../src/runtime/default-experience-bridge/index.js';
import type { RuntimeAdapter, UpstreamInputs } from '../src/runtime/default-experience-bridge/index.js';

const allReady: UpstreamInputs = {
  runtimeDaemon: 'ready',
  account: 'ready',
  defaultExperienceProfile: 'ready',
  materialization: 'ready',
  appRegistry: 'ready',
  cognitionMemory: 'ready',
};

function makeAdapter(overrides: Partial<RuntimeAdapter> = {}): RuntimeAdapter {
  return {
    async hostProfile() {
      return { profileId: 'darwin-arm64-metal', platform: { os: 'darwin', arch: 'arm64' } };
    },
    async recommendProfile() {
      throw new Error('not used in this test');
    },
    async applyProfile() {
      throw new Error('not used in this test');
    },
    async projectColdStart(inputs) {
      const allFieldsReady = (Object.values(inputs) as string[]).every((v) => v === 'ready');
      return { state: allFieldsReady ? 'ready' : 'unavailable' };
    },
    ...overrides,
  };
}

test('projectFirstRunReadiness returns ready overall + per-step ready when all upstreams ready', async () => {
  const bridge = new DefaultExperienceBridge(makeAdapter());
  const projection = await projectFirstRunReadiness(bridge, allReady);
  assert.equal(projection.overall.state, 'ready');
  assert.equal(projection.isReady, true);
  assert.equal(projection.steps.length, FIRST_RUN_STEPS.length);
  for (const step of projection.steps) {
    assert.equal(step.state, 'ready', `step ${step.step} should be ready`);
  }
});

test('projectFirstRunReadiness reports isReady=false when any upstream is not ready', async () => {
  const bridge = new DefaultExperienceBridge(makeAdapter());
  const inputs: UpstreamInputs = { ...allReady, account: 'setup-required' };
  const projection = await projectFirstRunReadiness(bridge, inputs);
  assert.equal(projection.isReady, false);
  assert.notEqual(projection.overall.state, 'ready');
  const accountStep = projection.steps.find((s) => s.step === 'account');
  assert.equal(accountStep?.state, 'setup-required');
});

test('projectFirstRunReadiness fails closed when bridge.projectReadiness throws', async () => {
  const bridge = new DefaultExperienceBridge(makeAdapter({
    async projectColdStart() {
      throw new Error('bridge boom');
    },
  }));
  const projection = await projectFirstRunReadiness(bridge, allReady);
  assert.equal(projection.isReady, false);
  assert.equal(projection.overall.state, 'unavailable');
  assert.match(projection.overall.detail ?? '', /bridge boom|projectReadiness failed/);
});

test('projectFirstRunReadiness fails closed when bridge is null', async () => {
  const projection = await projectFirstRunReadiness(null as unknown as DefaultExperienceBridge, allReady);
  assert.equal(projection.isReady, false);
  assert.equal(projection.overall.state, 'unavailable');
});

test('projectFirstRunReadiness preserves the FIRST_RUN_STEPS canonical order', async () => {
  const bridge = new DefaultExperienceBridge(makeAdapter());
  const projection = await projectFirstRunReadiness(bridge, allReady);
  for (let i = 0; i < FIRST_RUN_STEPS.length; i += 1) {
    assert.equal(projection.steps[i]!.step, FIRST_RUN_STEPS[i]);
  }
});

test('projectFirstRunReadiness reports non-canonical bridge response as unavailable', async () => {
  const bridge = new DefaultExperienceBridge(makeAdapter({
    async projectColdStart() {
      // Bridge would normally validate but here we simulate a downstream
      // that somehow returns non-canonical; bridge's own fail-closed
      // converts to 'unavailable'.
      return { state: 'active_ready' as 'ready' };
    },
  }));
  const projection = await projectFirstRunReadiness(bridge, allReady);
  assert.equal(projection.overall.state, 'unavailable');
  assert.equal(projection.isReady, false);
});

test('first-run readiness projection module embeds no provider/model identifier string constants', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const sources = [
    resolve(import.meta.dirname, '../src/shell/renderer/first-run/types.ts'),
    resolve(import.meta.dirname, '../src/shell/renderer/first-run/readiness-projection.ts'),
    resolve(import.meta.dirname, '../src/shell/renderer/first-run/index.ts'),
  ];
  const forbidden =
    /\b(openai|anthropic|claude(?:-[a-z0-9-]+)?|gpt(?:-[a-z0-9.]+)?|gemini(?:-[a-z0-9.-]+)?|deepseek(?:-[a-z0-9.-]+)?|qwen(?:[0-9a-z.-]+)?|mistral(?:-[a-z0-9.-]+)?|llama(?:[.-][a-z0-9.-]+)?|ollama|llamacpp|vllm)\b/i;
  const stringLiteral = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
  for (const sourcePath of sources) {
    const source = readFileSync(sourcePath, 'utf8');
    let match: RegExpExecArray | null;
    stringLiteral.lastIndex = 0;
    while ((match = stringLiteral.exec(source)) !== null) {
      const literal = match[2];
      if (literal && forbidden.test(literal)) {
        assert.fail(`forbidden identifier "${literal}" found in ${sourcePath}`);
      }
    }
  }
});
