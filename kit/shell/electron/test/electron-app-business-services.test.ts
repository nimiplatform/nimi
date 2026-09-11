import { describe, expect, it } from 'vitest';
import { createNimiLocalAppTextModel } from '@nimiplatform/sdk/ai';
import { createAppBusinessServices } from '../src/main/app-business-services.js';
import type { NimiElectronLocalAppHost } from '../src/main/local-app-host.js';

describe('App-owned Node services on the existing protected Host', () => {
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
    expect(closed).toBe(1);
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
});
