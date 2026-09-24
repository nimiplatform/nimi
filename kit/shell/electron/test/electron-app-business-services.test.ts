import { describe, expect, it } from 'vitest';
import { createNimiLocalAppTextModel } from '@nimiplatform/sdk/ai';
import { createAppBusinessServices } from '../src/main/app-business-services.js';
import type { NimiElectronLocalAppHost } from '../src/main/local-app-host.js';

describe('App-owned Node services on the existing protected Host', () => {
  it('finishes an asset read without closing an EOF-retired Host resource', async () => {
    let next = 0;
    let closes = 0;
    const owner = createAppBusinessServices({
      assetReadOpen: async () => ({ streamId: 'read-1',
        asset: { relativePath: 'audio/result.wav', mediaType: 'audio/wav', sizeBytes: 3,
          sha256: `sha256:${'a'.repeat(64)}`, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z' },
        range: { offset: 0, length: 3, totalSize: 3 } }),
      assetReadNext: async () => next++ === 0
        ? { completed: false, bodyChunk: new Uint8Array([1, 2, 3]) }
        : { completed: true },
      // Scoped Host ownership retires the stream when next returns EOF.
      assetReadClose: async () => { closes++; throw new Error('not-found'); },
    } as unknown as NimiElectronLocalAppHost);
    const read = await owner.services.storage.assets.read({ relativePath: 'audio/result.wav' });
    const received: number[] = [];
    for await (const chunk of read.body) received.push(...chunk);
    expect(received).toEqual([1, 2, 3]);
    owner.invalidate();
    owner.close();
    expect(closes).toBe(0);
  });

  it('does not close a subscription whose Host has already returned EOF', async () => {
    let closes = 0;
    const owner = createAppBusinessServices({
      scenarioJobSubscribe: async () => ({ streamId: 'job-stream-1' }),
      scenarioJobStreamNext: async () => ({ completed: true }),
      scenarioJobStreamClose: async () => { closes++; throw new Error('not-found'); },
    } as unknown as NimiElectronLocalAppHost);
    const subscription = await owner.services.ai.scenarioJobs.subscribe('job-1');
    const events = [];
    for await (const event of subscription) events.push(event);
    await subscription.cancel();
    owner.close();
    expect(events).toEqual([]);
    expect(closes).toBe(0);
  });

  it('maps SDK asset move paths to the native Host contract', async () => {
    const requests: unknown[] = [];
    const owner = createAppBusinessServices({
      assetMove: async (input: unknown) => {
        requests.push(input);
        return { relativePath: 'saved/result.json', mediaType: 'application/json', sizeBytes: 2,
          sha256: `sha256:${'a'.repeat(64)}`, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z' };
      },
    } as unknown as NimiElectronLocalAppHost);
    await owner.services.storage.assets.move({ from: 'draft/result.json', to: 'saved/result.json' });
    expect(requests).toEqual([{ fromRelativePath: 'draft/result.json', toRelativePath: 'saved/result.json', overwrite: false }]);
    owner.close();
  });

  it('uses the common model binding and preserves complete ordered tool output', async () => {
    const requests: unknown[] = [];
    let closed = 0;
    const events = [
      { type: 'delta', sequence: '1', traceId: 'trace-1', itemIndex: 0, text: 'Searching.' },
      { type: 'tool-call', sequence: '2', traceId: 'trace-1', itemIndex: 1, toolCall: { id: 'call-1', name: 'search', arguments: { subject: 'trees' } } },
      { type: 'completed', sequence: '3', traceId: 'trace-1', finishReason: 'tool-calls' },
    ];
    const owner = createAppBusinessServices({
      textTurnSubscribe: async (input: unknown) => { requests.push(input); return { streamId: 's-1' }; },
      textTurnStreamNext: async () => events.length ? { completed: false, event: events.shift() } : { completed: true },
      textTurnStreamClose: async () => { closed++; return { closed: true }; },
    } as unknown as NimiElectronLocalAppHost);
    const model = createNimiLocalAppTextModel(owner.services.ai);
    const result = await model.generateText({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Find sources.' }] }],
      tools: [{ name: 'search', inputSchema: { type: 'object', properties: { subject: { type: 'string' } } } }],
    });
    expect(result.finishReason).toBe('tool-calls');
    expect(result.outputItems).toEqual([
      { type: 'text', text: 'Searching.' },
      { type: 'tool-call', toolCall: { id: 'call-1', name: 'search', arguments: { subject: 'trees' } } },
    ]);
    expect(requests).toHaveLength(1);
    expect(closed).toBe(0); // The Host already retired this stream when it returned EOF.
    owner.close();
  });

  it('cancels a model request while the protected stream is waiting', async () => {
    let finishNext!: (value: { completed: true }) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    let closes = 0;
    const owner = createAppBusinessServices({
      textTurnSubscribe: async () => ({ streamId: 's-1' }),
      textTurnStreamNext: () => { entered(); return new Promise((resolve) => { finishNext = resolve; }); },
      textTurnStreamClose: async () => { closes++; finishNext({ completed: true }); return { closed: true }; },
    } as unknown as NimiElectronLocalAppHost);
    const signal = new AbortController();
    const result = createNimiLocalAppTextModel(owner.services.ai).generateText({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Find sources.' }] }], signal: signal.signal,
    });
    const rejected = expect(result).rejects.toThrow();
    await waiting;
    signal.abort();
    await rejected;
    expect(closes).toBe(1);
    owner.close();
  });

  it('stops a pending asset write at session invalidation before it can publish a commit', async () => {
    let finishChunk!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    let commits = 0;
    let aborts = 0;
    const owner = createAppBusinessServices({
      assetWriteOpen: async () => ({ streamId: 'write-1' }),
      assetWriteChunk: () => { entered(); return new Promise((resolve) => { finishChunk = () => resolve({ accepted: true }); }); },
      assetWriteCommit: async () => { commits++; throw new Error('old write must not commit'); },
      assetWriteAbort: async () => { aborts++; return { closed: true }; },
    } as unknown as NimiElectronLocalAppHost);
    const write = owner.services.storage.assets.write({ relativePath: 'research/body.json', body: new Uint8Array([1, 2, 3]) });
    const rejected = expect(write).rejects.toMatchObject({ reasonCode: 'session-invalid' });
    await waiting;
    owner.invalidate();
    finishChunk();
    await rejected;
    expect(commits).toBe(0);
    expect(aborts).toBe(1);
    owner.close();
    await expect(owner.services.storage.readJson('config.json')).rejects.toMatchObject({ reasonCode: 'session-invalid' });
  });

  describe('synchronous Scenario call control', () => {
    const decideSpec = {
      type: 'text-decide' as const,
      state: { json: { hand: ['A', 'K'], pot: 12 } },
      questions: [
        { id: 'bet', instructions: { text: 'Choose the action.' }, kind: 'choice' as const, candidates: [{ id: 'fold' }, { id: 'call' }] },
      ],
    };
    const decision = {
      output: { type: 'text-decide', answers: [{ questionId: 'bet', kind: 'choice', selectedCandidateId: 'call',
        probabilities: [{ candidateId: 'fold', probability: 0.25 }, { candidateId: 'call', probability: 0.75 }] }] },
      traceId: 'trace-bet',
    };

    it('carries the canonical text decision, caller deadline and signal to the Host', async () => {
      const requests: Array<{ input: unknown; signal?: AbortSignal }> = [];
      const owner = createAppBusinessServices({
        scenarioExecute: async (input: unknown, options?: { signal?: AbortSignal }) => {
          requests.push({ input, signal: options?.signal });
          return decision;
        },
      } as unknown as NimiElectronLocalAppHost);
      await expect(owner.services.ai.scenario.execute(decideSpec, { timeoutMs: 4_000 })).resolves.toEqual(decision);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.input).toEqual({
        spec: { type: 'text-decide', state: { json: '{"hand":["A","K"],"pot":12}' }, questions: decideSpec.questions },
        timeoutMs: 4_000,
      });
      expect(requests[0]?.signal?.aborted).toBe(false);
      owner.close();
    });

    it('settles an abort as the typed canceled failure and drops the Host call', async () => {
      let hostSignal: AbortSignal | undefined;
      let finish: ((value: unknown) => void) | undefined;
      const owner = createAppBusinessServices({
        scenarioExecute: (_input: unknown, options?: { signal?: AbortSignal }) => {
          hostSignal = options?.signal;
          return new Promise((resolve) => { finish = resolve; });
        },
      } as unknown as NimiElectronLocalAppHost);
      const controller = new AbortController();
      const pending = owner.services.ai.scenario.execute(decideSpec, { signal: controller.signal });
      await Promise.resolve();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ reasonCode: 'OPERATION_ABORTED', source: 'sdk' });
      expect(hostSignal?.aborted).toBe(true);
      finish?.(decision);
      owner.close();
    });

    it('settles an elapsed caller deadline as a typed timeout without invalidating the services', async () => {
      let calls = 0;
      const owner = createAppBusinessServices({
        scenarioExecute: (_input: unknown, options?: { signal?: AbortSignal }) => {
          calls += 1;
          if (calls > 1) return Promise.resolve(decision);
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { reasonCode: 'canceled' })));
          });
        },
      } as unknown as NimiElectronLocalAppHost);
      await expect(owner.services.ai.scenario.execute(decideSpec, { timeoutMs: 15 })).rejects.toMatchObject({ reasonCode: 'OPERATION_TIMEOUT' });
      await expect(owner.services.ai.scenario.execute(decideSpec)).resolves.toEqual(decision);
      owner.close();
    });

    it('cancels every outstanding call on invalidation', async () => {
      const signals: AbortSignal[] = [];
      const owner = createAppBusinessServices({
        scenarioExecute: (_input: unknown, options?: { signal?: AbortSignal }) => {
          if (options?.signal) signals.push(options.signal);
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { reasonCode: 'canceled' })));
          });
        },
      } as unknown as NimiElectronLocalAppHost);
      const first = owner.services.ai.scenario.execute(decideSpec);
      const second = owner.services.ai.scenario.execute({ type: 'text-embed', inputs: ['hello'] }, { timeoutMs: 60_000 });
      await Promise.resolve();
      owner.invalidate();
      await expect(first).rejects.toMatchObject({ reasonCode: 'session-invalid' });
      await expect(second).rejects.toMatchObject({ reasonCode: 'session-invalid' });
      expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
      owner.close();
    });
  });
});
