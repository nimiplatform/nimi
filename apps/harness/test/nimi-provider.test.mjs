import assert from 'node:assert/strict';
import test from 'node:test';
import { createModels } from '@earendil-works/pi-ai/models';
import { buildReasoningOptions, nimiProvider, projectReasoningChoices } from '../dist-electron/nimi-provider.js';

test('reported zero and aggregate counts remain distinct from missing Pi usage', async () => {
  for (const usage of [undefined, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, { promptTokens: 7, completionTokens: 2, totalTokens: 9 }]) {
    const provider = nimiProvider({ text: { async streamTurn() { return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'delta', itemIndex: 0, text: 'Answer.' };
        yield { type: 'completed', finishReason: 'stop', ...(usage ? { usage } : {}) };
      },
      async cancel() {},
    }; } } }, 'test', 'Test model', false);
    const models = createModels();
    models.setProvider(provider);
    const answer = await (await models.streamSimple(provider.getModels()[0], { messages: [{ role: 'user', content: 'Answer.', timestamp: 0 }] })).result();
    assert.equal(answer.diagnostics.some(item => item.type === 'nimi.usage-unreported'), usage === undefined);
    assert.equal(answer.diagnostics.some(item => item.type === 'nimi.cost-unreported'), true);
    assert.equal(answer.usage.input, usage?.promptTokens ?? 0);
    assert.equal(answer.usage.output, usage?.completionTokens ?? 0);
  }
});

test('the Nimi Pi Provider replays opaque reasoning in its original position', async () => {
  const inputs = [];
  const carrier = { kind: 'test.continuity', version: 1, payload: [0, 127, 255] };
  const ai = {
    text: {
      async streamTurn(input) {
        inputs.push(input);
        const first = inputs.length === 1;
        return {
          async *[Symbol.asyncIterator]() {
            if (first) yield { type: 'reasoning-continuity', itemIndex: 0, carrier };
            yield { type: 'delta', itemIndex: first ? 1 : 0, text: first ? 'First answer' : 'Follow-up' };
            yield { type: 'completed', finishReason: 'stop' };
          },
          async cancel() {},
        };
      },
    },
  };
  const provider = nimiProvider(ai, 'configured-default', 'Nimi configuration', true);
  const models = createModels();
  models.setProvider(provider);
  const [model] = provider.getModels();
  const user = { role: 'user', content: 'Test reasoning', timestamp: Date.now() };
  const answer = await (await models.streamSimple(model, { messages: [user] })).result();
  assert.equal(answer.stopReason, 'stop');
  assert.equal(answer.content[0].type, 'thinking');
  assert.equal(answer.content[0].redacted, true);
  assert.equal(answer.content[1].text, 'First answer');

  const next = { role: 'user', content: 'Continue', timestamp: Date.now() };
  const resumed = await (await models.streamSimple(model, { messages: [user, answer, next] })).result();
  assert.equal(resumed.stopReason, 'stop');
  assert.deepEqual(inputs[1].messages[1].turnItems, [
    { type: 'output', output: { type: 'reasoning-continuity', carrier } },
    { type: 'output', output: { type: 'text', text: 'First answer' } },
  ]);
});

test('reasoning effort choices project from reasoningInput and pass through to streamTurn', async () => {
  const caps = {
    followsModelDefault: true,
    supportsDisabled: true,
    supportsRequired: true,
    supportsAdaptive: true,
    efforts: ['low', 'medium', 'high'],
    supportsBudget: false,
    presentations: ['summary', 'hidden'],
  };
  assert.deepEqual(projectReasoningChoices(caps).map(c => c.value), ['default', 'off', 'low', 'medium', 'high']);
  assert.equal(buildReasoningOptions(caps, 'default'), undefined);
  assert.deepEqual(buildReasoningOptions(caps, 'off'), { activation: 'disabled', presentation: 'hidden' });
  assert.deepEqual(buildReasoningOptions(caps, 'high'), { activation: 'adaptive', effort: 'high', presentation: 'summary' });

  let currentEffort = 'high';
  const captured = [];
  const provider = nimiProvider({
    text: {
      async streamTurn(input) {
        captured.push(input.reasoning);
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'delta', itemIndex: 0, text: 'OK' };
            yield { type: 'completed', finishReason: 'stop' };
          },
          async cancel() {},
        };
      },
    },
  }, 'reason-model', 'Reason Model', true, false, 32768, undefined, () => buildReasoningOptions(caps, currentEffort));
  const models = createModels();
  models.setProvider(provider);
  const [model] = provider.getModels();
  await (await models.streamSimple(model, { messages: [{ role: 'user', content: 'Hi', timestamp: 0 }] })).result();
  currentEffort = 'off';
  await (await models.streamSimple(model, { messages: [{ role: 'user', content: 'Hi again', timestamp: 1 }] })).result();
  assert.deepEqual(captured, [
    { activation: 'adaptive', effort: 'high', presentation: 'summary' },
    { activation: 'disabled', presentation: 'hidden' },
  ]);
});
