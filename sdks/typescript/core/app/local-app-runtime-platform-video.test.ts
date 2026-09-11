import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiVideoSessionClient, type NimiVideoSessionShell } from './local-app-runtime-platform-video.js';

test('video Session bounds unfinished submissions and carries compact binary data', async () => {
  const submitted: Record<string, unknown>[] = [];
  const finish: Array<() => void> = [];
  const shell: NimiVideoSessionShell = {
    async open() { return { videoSessionId: 'session-1', generation: '1', format: { width: 1280, height: 720, pixelFormat: 'rgb8' }, maximumInFlightSubmissions: 2 }; },
    submitFrame(input) { submitted.push(input); return new Promise(resolve => finish.push(() => resolve({ accepted: true, sequence: input.sequence }))); },
    async read() { return { result: null }; },
    async close() { return { closed: true }; },
  };
  const client = createNimiVideoSessionClient(shell);
  const opened = await client.open({ referenceImageArtifactId: 'reference-1', format: { width: 1280, height: 720, pixelFormat: 'rgb8' } });
  const scope = { videoSessionId: opened.videoSessionId, generation: opened.generation };
  const frame = new Uint8Array(1280 * 720 * 3);
  const one = client.submitFrame({ ...scope, sequence: '1', timestampUs: '0', frame });
  const two = client.submitFrame({ ...scope, sequence: '2', timestampUs: '33333', frame });
  await assert.rejects(() => client.submitFrame({ ...scope, sequence: '3', timestampUs: '66666', frame }), error => (error as { reasonCode: string }).reasonCode === 'AI_VIDEO_SESSION_OVERLOADED');
  assert.equal(submitted.length, 2);
  assert.equal(typeof submitted[0].frameBase64, 'string');
  assert.equal((submitted[0].frameBase64 as string).length, 1280 * 720 * 4);
  finish.forEach(resolve => resolve());
  assert.deepEqual(await Promise.all([one, two]), [{ accepted: true, sequence: '1' }, { accepted: true, sequence: '2' }]);
  assert.equal(await client.read(scope), null);
  assert.deepEqual(await client.close(scope), { closed: true });
});

test('video Session terminal closes pending use without inventing a transformed result', async () => {
  const client = createNimiVideoSessionClient({
    async open() { return { videoSessionId: 'session-2', generation: '1', format: { width: 1280, height: 720, pixelFormat: 'rgb8' }, maximumInFlightSubmissions: 2 }; },
    async submitFrame() { throw new Error('must not submit after terminal'); },
    async read() { return { result: { videoSessionId: 'session-2', generation: '1', type: 'session-terminal', reasonCode: 'ai-video-session-overloaded' } }; },
    async close() { throw new Error('stop failed'); },
  });
  const scope = { videoSessionId: 'session-2', generation: '1' };
  assert.equal((await client.read(scope))?.type, 'session-terminal');
  await assert.rejects(() => client.submitFrame({ ...scope, sequence: '1', timestampUs: '0', frame: new Uint8Array(1280 * 720 * 3) }));
  await assert.rejects(() => client.close(scope), /stop failed/u);
});

test('a closed video Session cannot submit again through the same client', async () => {
  let submissions = 0;
  const client = createNimiVideoSessionClient({
    async open() { throw new Error('unused'); },
    async submitFrame(input) { submissions++; return { accepted: true, sequence: input.sequence }; },
    async read() { return { result: null }; },
    async close() { return { closed: true }; },
  });
  const scope = { videoSessionId: 'closed-session', generation: '1' };
  await client.close(scope);
  await assert.rejects(() => client.submitFrame({ ...scope, sequence: '1', timestampUs: '0', frame: new Uint8Array(1280 * 720 * 3) }),
    error => (error as { reasonCode: string }).reasonCode === 'SDK_LOCAL_APP_OPERATION_UNAVAILABLE');
  assert.equal(submissions, 0);
});

test('terminal receipt rejects unfinished submissions without waiting for transport', { timeout: 2000 }, async () => {
  const scope = { videoSessionId: 'terminal-session', generation: '1' };
  const client = createNimiVideoSessionClient({
    async open() { throw new Error('unused'); },
    submitFrame() { return new Promise(() => {}); },
    async read() { return { result: { ...scope, type: 'session-terminal', reasonCode: 'ai-video-session-overloaded' } }; },
    async close() { throw new Error('stop failed'); },
  });
  const frame = new Uint8Array(1280 * 720 * 3);
  const waiting = [1, 2].map(sequence => assert.rejects(client.submitFrame({ ...scope, sequence: String(sequence), timestampUs: '0', frame }),
    error => (error as { reasonCode: string }).reasonCode === 'SDK_LOCAL_APP_OPERATION_UNAVAILABLE'));
  assert.equal((await client.read(scope))?.type, 'session-terminal');
  await Promise.all(waiting);
  await assert.rejects(client.close(scope), /stop failed/u);
});

test('video transport loss rejects an unfinished reader', { timeout: 2000 }, async () => {
  const scope = { videoSessionId: 'lost-session', generation: '1' };
  const client = createNimiVideoSessionClient({
    async open() { throw new Error('unused'); },
    async submitFrame() { throw new Error('transport lost'); },
    read() { return new Promise(() => {}); },
    async close() { throw new Error('transport lost'); },
  });
  const waiting = assert.rejects(client.read(scope),
    error => (error as { reasonCode: string }).reasonCode === 'SDK_LOCAL_APP_OPERATION_UNAVAILABLE');
  await assert.rejects(client.submitFrame({ ...scope, sequence: '1', timestampUs: '0', frame: new Uint8Array(1280 * 720 * 3) }), /transport lost/u);
  await waiting;
});
