import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExecuteLocalAppScenarioRequest, ExecuteLocalAppScenarioResponse, RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client.js';
import {
  createNimiLocalAppAIConsumptionClient,
  createNimiLocalAppAIConsumptionRuntimeClient,
  type NimiLocalAppAIConsumptionRuntime,
  type NimiLocalAppScenarioExecuteOptions,
  type NimiLocalAppScenarioExecuteShellSpec,
} from './local-app-runtime-platform-ai.js';
import {
  nimiLocalAppTextDecideSpecFromShell,
  prepareNimiLocalAppTextDecideSpec,
  validateNimiLocalAppTextDecideOutput,
  validateNimiLocalAppTextDecideShellSpec,
  type NimiLocalAppTextDecideSpec,
} from './local-app-text-decision.js';

const decideSpec: NimiLocalAppTextDecideSpec = {
  type: 'text-decide',
  state: { json: { turn: 3, board: [['x', null], [null, 'o']], zeta: true, alpha: 'first' } },
  questions: [
    {
      id: 'next-move',
      instructions: { text: 'Pick the strongest move.' },
      kind: 'choice',
      candidates: [
        { id: 'a1', description: { text: 'Top left corner' } },
        { id: 'b2' },
        { id: 'c3', description: { json: { risk: 'low', reward: 2 } } },
      ],
    },
    { id: 'resign', instructions: { json: ['Should the player resign?'] }, kind: 'boolean', trueCriterion: { text: 'The game is lost.' } },
    { id: 'draw', instructions: { text: 'Offer a draw?' }, kind: 'boolean' },
  ],
};

const decisionOutput = {
  type: 'text-decide',
  answers: [
    {
      questionId: 'next-move', kind: 'choice', selectedCandidateId: 'b2',
      probabilities: [
        { candidateId: 'a1', probability: 0.2 },
        { candidateId: 'b2', probability: 0.7 },
        { candidateId: 'c3', probability: 0.1 },
      ],
    },
    { questionId: 'resign', kind: 'boolean', trueProbability: 0.05 },
    { questionId: 'draw', kind: 'boolean', trueProbability: 0.5 },
  ],
};

function unused(): Promise<never> {
  return Promise.reject(new Error('unused fixture operation'));
}

function shellClient(execute: (spec: NimiLocalAppScenarioExecuteShellSpec, options?: NimiLocalAppScenarioExecuteOptions) => Promise<unknown>) {
  return createNimiLocalAppAIConsumptionClient({
    text: { streamTurn: unused },
    scenario: { execute },
    scenarioJobs: { submit: unused, get: unused, subscribe: unused, cancel: unused },
    artifacts: { read: unused, upload: unused },
    voiceAssets: { list: unused },
  });
}

function runtimeFixture(execute: NimiLocalAppAIConsumptionRuntime['executeLocalAppScenario']): NimiLocalAppAIConsumptionRuntime {
  return {
    streamLocalAppTextTurn: () => (async function* () { throw new Error('unused'); })(),
    executeLocalAppScenario: execute,
    submitLocalAppScenarioJob: unused,
    getLocalAppScenarioJob: unused,
    subscribeLocalAppScenarioJobEvents: () => (async function* () { throw new Error('unused'); })(),
    cancelLocalAppScenarioJob: unused,
    readLocalAppArtifact: unused,
    uploadLocalAppArtifact: unused,
    listLocalAppVoiceAssets: unused,
  };
}

test('text-decide round trip keeps submitted ids, order, JSON spelling and call control', async () => {
  let request: ExecuteLocalAppScenarioRequest | undefined;
  let callOptions: RuntimeTypedCallOptions | undefined;
  const client = createNimiLocalAppAIConsumptionRuntimeClient(runtimeFixture(async (value, options) => {
    request = value;
    callOptions = options;
    const response: ExecuteLocalAppScenarioResponse = {
      traceId: 'trace-decide',
      output: {
        oneofKind: 'textDecide',
        textDecide: {
          answers: [
            {
              questionId: 'next-move',
              result: {
                oneofKind: 'choice',
                choice: {
                  selectedCandidateId: 'b2',
                  probabilities: [
                    { candidateId: 'a1', probability: 0.2 },
                    { candidateId: 'b2', probability: 0.7 },
                    { candidateId: 'c3', probability: 0.1 },
                  ],
                },
              },
            },
            { questionId: 'resign', result: { oneofKind: 'boolean', boolean: { trueProbability: 0.05 } } },
            { questionId: 'draw', result: { oneofKind: 'boolean', boolean: { trueProbability: 0.5 } } },
          ],
        },
      },
    };
    return response;
  }));
  const controller = new AbortController();
  const result = await client.scenario.execute(decideSpec, { signal: controller.signal, timeoutMs: 5_000 });
  assert.deepEqual(result, { output: decisionOutput, traceId: 'trace-decide' });
  assert.ok(Object.isFrozen(result.output));
  // Runtime owns the deadline carried in the request; the transport only
  // bounds the call a little beyond it.
  assert.equal(callOptions?.timeoutMs, 7_000);
  assert.ok(callOptions?.signal);
  assert.equal(callOptions?.signal?.aborted, false);
  assert.deepEqual(request, {
    timeoutMs: 5_000,
    spec: {
      oneofKind: 'textDecide',
      textDecide: {
        state: { value: { oneofKind: 'json', json: '{"turn":3,"board":[["x",null],[null,"o"]],"zeta":true,"alpha":"first"}' } },
        questions: [
          {
            id: 'next-move',
            instructions: { value: { oneofKind: 'text', text: 'Pick the strongest move.' } },
            kind: {
              oneofKind: 'choice',
              choice: {
                candidates: [
                  { id: 'a1', description: { value: { oneofKind: 'text', text: 'Top left corner' } } },
                  { id: 'b2' },
                  { id: 'c3', description: { value: { oneofKind: 'json', json: '{"risk":"low","reward":2}' } } },
                ],
              },
            },
          },
          {
            id: 'resign',
            instructions: { value: { oneofKind: 'json', json: '["Should the player resign?"]' } },
            kind: { oneofKind: 'boolean', boolean: { trueCriterion: { value: { oneofKind: 'text', text: 'The game is lost.' } } } },
          },
          {
            id: 'draw',
            instructions: { value: { oneofKind: 'text', text: 'Offer a draw?' } },
            kind: { oneofKind: 'boolean', boolean: {} },
          },
        ],
      },
    },
  });
});

test('text-decide JSON content keeps its authority-looking business keys as product content', async () => {
  let carried: NimiLocalAppScenarioExecuteShellSpec | undefined;
  const client = shellClient(async (spec) => {
    carried = spec;
    return { output: { type: 'text-decide', answers: [{ questionId: 'q', kind: 'boolean', trueProbability: 1 }] }, traceId: 'trace-json' };
  });
  await client.scenario.execute({
    type: 'text-decide',
    state: { json: { token: 'bishop', account: { owner: 'white' }, sessionId: 7 } },
    questions: [{ id: 'q', instructions: { text: 'Is the bishop pinned?' }, kind: 'boolean' }],
  });
  assert.deepEqual(carried, {
    type: 'text-decide',
    state: { json: '{"token":"bishop","account":{"owner":"white"},"sessionId":7}' },
    questions: [{ id: 'q', instructions: { text: 'Is the bishop pinned?' }, kind: 'boolean' }],
  });
});

test('text-decide accepts a well-formed replacement character ID and rejects blank information separators', () => {
  const spec = prepareNimiLocalAppTextDecideSpec({
    ...decideSpec,
    questions: [{ id: 'replacement\uFFFD', instructions: { text: 'Choose.' }, kind: 'boolean' }],
  });
  assert.equal(spec.questions[0]?.id, 'replacement\uFFFD');
  assert.throws(
    () => prepareNimiLocalAppTextDecideSpec({ ...decideSpec, state: { text: ' \u001c ' } }),
    { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' },
  );
});

test('invalid text-decide input and call options are rejected before transport', async () => {
  let calls = 0;
  const client = shellClient(async () => {
    calls += 1;
    return { output: decisionOutput, traceId: 'trace' };
  });
  const question = decideSpec.questions[0]!;
  const choice = question as Extract<typeof question, { kind: 'choice' }>;
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let deep: unknown = [];
  for (let depth = 0; depth < 64; depth += 1) deep = [deep];
  const invalid: unknown[] = [
    { ...decideSpec, extra: true },
    { ...decideSpec, state: { text: ' \t　 ' } },
    { ...decideSpec, state: { text: 'a\0b' } },
    { ...decideSpec, state: { text: 'x', json: {} } },
    { ...decideSpec, state: { json: 'not-a-container' } },
    { ...decideSpec, state: { json: null } },
    { ...decideSpec, state: { json: { value: Number.NaN } } },
    { ...decideSpec, state: { json: { value: undefined } } },
    { ...decideSpec, state: { json: { when: new Date(0) } } },
    { ...decideSpec, state: { json: cyclic } },
    { ...decideSpec, state: { json: deep } },
    { ...decideSpec, state: { json: [1, , 3] } },
    { ...decideSpec, state: { json: { text: '\ud800' } } },
    { ...decideSpec, state: { text: 'x'.repeat(256 * 1024 + 1) } },
    { ...decideSpec, questions: [] },
    { ...decideSpec, questions: Array.from({ length: 65 }, (_, index) => ({ id: `q${index}`, instructions: { text: 'x' }, kind: 'boolean' })) },
    { ...decideSpec, questions: [question, question] },
    { ...decideSpec, questions: [{ ...choice, candidates: [{ id: 'only' }] }] },
    { ...decideSpec, questions: [{ ...choice, candidates: [{ id: 'same' }, { id: 'same' }] }] },
    { ...decideSpec, questions: [{ ...choice, candidates: Array.from({ length: 256 }, (_, index) => ({ id: `c${index}` })) }] },
    { ...decideSpec, questions: [{ ...choice, id: ' padded' }] },
    { ...decideSpec, questions: [{ ...choice, id: 'x'.repeat(65) }] },
    { ...decideSpec, questions: [{ ...choice, id: 'tab\tinside' }] },
    { ...decideSpec, questions: [{ ...choice, kind: 'ranking' }] },
    { ...decideSpec, questions: [{ ...choice, trueCriterion: { text: 'x' } }] },
    { ...decideSpec, questions: [{ id: 'q', instructions: { text: 'x' }, kind: 'boolean', candidates: [] }] },
    { ...decideSpec, questions: [{ id: 'q', instructions: { text: 'x'.repeat(32 * 1024 + 1) }, kind: 'boolean' }] },
    { ...decideSpec, questions: [{ ...choice, candidates: [{ id: 'a', description: { text: 'x'.repeat(8 * 1024 + 1) } }, { id: 'b' }] }] },
    // Each question is individually bounded, but the complete request exceeds 1 MiB.
    { ...decideSpec, questions: Array.from({ length: 40 }, (_, index) => ({ id: `q${index}`, instructions: { text: 'x'.repeat(30 * 1024) }, kind: 'boolean' })) },
  ];
  for (const [index, spec] of invalid.entries()) {
    await assert.rejects(
      client.scenario.execute(spec as NimiLocalAppTextDecideSpec),
      { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' },
      `invalid text-decide case ${index}`,
    );
  }
  for (const options of [
    { timeoutMs: 0 }, { timeoutMs: 120_001 }, { timeoutMs: 1.5 }, { timeoutMs: '100' }, { signal: {} }, { deadline: 1 },
  ]) {
    await assert.rejects(
      client.scenario.execute(decideSpec, options as NimiLocalAppScenarioExecuteOptions),
      { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' },
    );
  }
  await assert.rejects(
    client.scenarioJobs.submit(decideSpec as never),
    { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' },
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(client.scenario.execute(decideSpec, { signal: aborted.signal }), { reasonCode: 'OPERATION_ABORTED' });
  assert.equal(calls, 0);
});

test('inconsistent text-decide results are rejected as invalid projections', async () => {
  const answers = decisionOutput.answers;
  const choice = answers[0] as typeof answers[0] & { probabilities: { candidateId: string; probability: number }[] };
  const invalidOutputs: unknown[] = [
    { type: 'text-decide', answers: answers.slice(0, 2) },
    { type: 'text-decide', answers: [...answers, answers[2]] },
    { type: 'text-decide', answers: [answers[1], answers[0], answers[2]] },
    { type: 'text-decide', answers: [{ ...choice, questionId: 'other' }, answers[1], answers[2]] },
    { type: 'text-decide', answers: [{ ...choice, kind: 'boolean' }, answers[1], answers[2]] },
    { type: 'text-decide', answers: [{ ...choice, probabilities: [...choice.probabilities].reverse() }, answers[1], answers[2]] },
    { type: 'text-decide', answers: [{ ...choice, probabilities: choice.probabilities.slice(0, 2) }, answers[1], answers[2]] },
    { type: 'text-decide', answers: [{ ...choice, selectedCandidateId: 'a1' }, answers[1], answers[2]] },
    { type: 'text-decide', answers: [{ ...choice, selectedCandidateId: 'zz' }, answers[1], answers[2]] },
    { type: 'text-decide', answers: [{ ...choice, probabilities: [
      { candidateId: 'a1', probability: 0.3 }, { candidateId: 'b2', probability: 0.7 }, { candidateId: 'c3', probability: 0.1 },
    ] }, answers[1], answers[2]] },
    { type: 'text-decide', answers: [{ ...choice, probabilities: [
      { candidateId: 'a1', probability: -0.1 }, { candidateId: 'b2', probability: 1 }, { candidateId: 'c3', probability: 0.1 },
    ] }, answers[1], answers[2]] },
    { type: 'text-decide', answers: [answers[0], { ...answers[1], trueProbability: Number.NaN }, answers[2]] },
    { type: 'text-decide', answers: [answers[0], { ...answers[1], trueProbability: 1.5 }, answers[2]] },
    { type: 'text-decide', answers: [answers[0], { ...answers[1], confidence: 0.9 }, answers[2]] },
    { type: 'text-decide', answers: [{ ...choice, probabilities: [
      { candidateId: 'a1', probability: 0.2, logit: 1 }, choice.probabilities[1], choice.probabilities[2],
    ] }, answers[1], answers[2]] },
    { type: 'text-decide', answers, usage: { tokens: 3 } },
    { type: 'text-embed', vectors: [[1]], spaceId: 'space' },
  ];
  for (const output of invalidOutputs) {
    const client = shellClient(async () => ({ output, traceId: 'trace' }));
    await assert.rejects(client.scenario.execute(decideSpec), { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' });
  }
  const embedClient = shellClient(async () => ({ output: decisionOutput, traceId: 'trace' }));
  await assert.rejects(
    embedClient.scenario.execute({ type: 'text-embed', inputs: ['hello'] }),
    { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' },
  );
  // Ties at the maximum are admitted.
  const tie = shellClient(async () => ({
    output: { type: 'text-decide', answers: [{ ...choice, selectedCandidateId: 'a1', probabilities: [
      { candidateId: 'a1', probability: 0.45 }, { candidateId: 'b2', probability: 0.45 }, { candidateId: 'c3', probability: 0.1 },
    ] }, answers[1], answers[2]] },
    traceId: 'trace-tie',
  }));
  assert.equal((await tie.scenario.execute(decideSpec)).traceId, 'trace-tie');
  // Sums of exactly 0.98 and 1.02 are inside the tolerance; 0.97 and 1.03 are not.
  for (const [a1, b2, valid] of [[0.49, 0.49, true], [0.51, 0.51, true], [0.48, 0.49, false], [0.51, 0.52, false]] as const) {
    const client = shellClient(async () => ({
      output: { type: 'text-decide', answers: [{ ...choice, selectedCandidateId: 'b2', probabilities: [
        { candidateId: 'a1', probability: a1 }, { candidateId: 'b2', probability: b2 }, { candidateId: 'c3', probability: 0 },
      ] }, answers[1], answers[2]] },
      traceId: 'trace-sum',
    }));
    if (valid) assert.equal((await client.scenario.execute(decideSpec)).traceId, 'trace-sum');
    else await assert.rejects(client.scenario.execute(decideSpec), { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' });
  }
});

test('abort settles as the typed canceled failure, cancels the carrier call and drops a late result', async () => {
  let carrierSignal: AbortSignal | undefined;
  let resolveCarrier: ((value: unknown) => void) | undefined;
  const client = shellClient((_spec, options) => {
    carrierSignal = options?.signal;
    return new Promise((resolve) => { resolveCarrier = resolve; });
  });
  const controller = new AbortController();
  const pending = client.scenario.execute(decideSpec, { signal: controller.signal });
  await Promise.resolve();
  assert.equal(carrierSignal?.aborted, false);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => {
    const typed = error as { reasonCode?: string; source?: string; retryable?: boolean };
    return typed.reasonCode === 'OPERATION_ABORTED' && typed.source === 'sdk' && typed.retryable === false;
  });
  assert.equal(carrierSignal?.aborted, true);
  resolveCarrier?.({ output: decisionOutput, traceId: 'late' });
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('caller deadline settles as a typed timeout and leaves the carrier call to Runtime\'s deadline', async () => {
  let carrierOptions: NimiLocalAppScenarioExecuteOptions | undefined;
  const client = shellClient((_spec, options) => {
    carrierOptions = options;
    return new Promise(() => undefined);
  });
  const started = Date.now();
  await assert.rejects(client.scenario.execute(decideSpec, { timeoutMs: 20 }), (error: unknown) => {
    const typed = error as { reasonCode?: string; retryable?: boolean; details?: { timeoutMs?: number } };
    return typed.reasonCode === 'OPERATION_TIMEOUT' && typed.retryable === true && typed.details?.timeoutMs === 20;
  });
  assert.ok(Date.now() - started >= 15);
  assert.equal(carrierOptions?.timeoutMs, 20);
  // The deadline travels with the call: Runtime ends it and records a timeout,
  // so the SDK does not turn the deadline into a cancel of the carrier call.
  assert.equal(carrierOptions?.signal?.aborted, false);

  const carrierTimeout = shellClient(async () => {
    throw Object.assign(new Error('timeout'), { reasonCode: 'timeout' });
  });
  await assert.rejects(carrierTimeout.scenario.execute(decideSpec, { timeoutMs: 5_000 }), { reasonCode: 'OPERATION_TIMEOUT' });
  const carrierFailure = shellClient(async () => {
    throw Object.assign(new Error('limit'), { reasonCode: 'ai-input-limit-exceeded' });
  });
  await assert.rejects(carrierFailure.scenario.execute(decideSpec, { timeoutMs: 5_000 }), { reasonCode: 'ai-input-limit-exceeded' });
});

test('per-call options also carry the other execute variants', async () => {
  const seen: Array<NimiLocalAppScenarioExecuteOptions | undefined> = [];
  const client = shellClient(async (_spec, options) => {
    seen.push(options);
    return { output: { type: 'text-embed', vectors: [[0.5]], spaceId: 'space-1' }, traceId: 'trace-embed' };
  });
  await client.scenario.execute({ type: 'text-embed', inputs: ['hello'] });
  await client.scenario.execute({ type: 'text-embed', inputs: ['hello'] }, { timeoutMs: 1_000 });
  assert.equal(seen[0], undefined);
  assert.equal(seen[1]?.timeoutMs, 1_000);
  assert.equal(seen[1]?.signal?.aborted, false);
});

test('carrier text-decide specs accept only the canonical SDK serialization', () => {
  const shell = {
    type: 'text-decide',
    state: { json: '{"b":1,"a":[1.5,"x"]}' },
    questions: [{ id: 'q', instructions: { text: 'Decide.' }, kind: 'boolean' }],
  };
  assert.deepEqual(validateNimiLocalAppTextDecideShellSpec(shell), shell);
  const restored = nimiLocalAppTextDecideSpecFromShell(shell);
  assert.equal(JSON.stringify((restored.state as { json: unknown }).json), '{"b":1,"a":[1.5,"x"]}');
  for (const json of ['{"b": 1}', '{"a":1,"a":2}', '{"a":1.0}', '"text"', 'null', '{"a":"\\ud800"}', '{', '']) {
    assert.throws(
      () => validateNimiLocalAppTextDecideShellSpec({ ...shell, state: { json } }),
      { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' },
      json,
    );
  }
  assert.throws(
    () => validateNimiLocalAppTextDecideShellSpec({ ...shell, state: { json: { a: 1 } } }),
    { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' },
  );
  assert.throws(
    () => validateNimiLocalAppTextDecideOutput({ type: 'text-decide', answers: [] }, shell as never),
    { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' },
  );
});
