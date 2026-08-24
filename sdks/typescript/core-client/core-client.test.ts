import assert from 'node:assert/strict';
import test from 'node:test';

import { CoreClient, type CoreTransport, NimiCoreTransportRequiredError } from './index';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';

async function expectWithin<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

class FakeCoreTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];
  readonly streamCalls: CoreStreamRequest[] = [];
  responseMetadata = { 'x-nimi-runtime-version': '0.4.0' };

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    request.responseMetadataObserver?.(this.responseMetadata);
    return { ok: true } as Response;
  }

  async *serverStream<Response>(request: CoreStreamRequest): AsyncIterable<Response> {
    this.streamCalls.push(request);
    request.responseMetadataObserver?.(this.responseMetadata);
    yield { event: 'ok' } as Response;
  }
}

test('CoreClient fails closed when explicit transport is missing or incomplete', () => {
  assert.throws(
    () => new CoreClient({} as ConstructorParameters<typeof CoreClient>[0]),
    (error: unknown) => {
      assert.equal(error instanceof NimiCoreTransportRequiredError, true);
      assert.equal((error as { code?: string }).code, 'SDK_CORE_TRANSPORT_REQUIRED');
      return true;
    },
  );

  assert.throws(
    () => new CoreClient({ transport: { unary: async () => ({}) } as unknown as CoreTransport }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_CORE_TRANSPORT_REQUIRED',
  );
});

test('CoreClient preserves explicit transport calls and merges auth metadata', async () => {
  const transport = new FakeCoreTransport();
  const observedClientMetadata: Array<Record<string, string>> = [];
  const observedRequestMetadata: Array<Record<string, string>> = [];
  const client = new CoreClient({
    transport,
    authMetadata: () => ({ authorization: 'Bearer core-test' }),
    responseMetadataObserver: (metadata) => {
      observedClientMetadata.push({ ...metadata });
    },
  });

  await client.unary({
    methodId: '/runtime.v1.Test/Unary',
    body: { input: true },
    metadata: { 'x-nimi-caller': 'core-client-test' },
    timeoutMs: 42,
    responseMetadataObserver: (metadata) => {
      observedRequestMetadata.push({ ...metadata });
    },
  });

  const streamEvents = [];
  for await (const event of client.serverStream({
    methodId: '/runtime.v1.Test/Stream',
    body: {},
  })) {
    streamEvents.push(event);
  }

  assert.equal(transport.unaryCalls[0]?.metadata?.authorization, 'Bearer core-test');
  assert.equal(transport.unaryCalls[0]?.metadata?.['x-nimi-caller'], 'core-client-test');
  assert.equal(transport.unaryCalls[0]?.timeoutMs, 42);
  assert.deepEqual(observedClientMetadata, [
    { 'x-nimi-runtime-version': '0.4.0' },
    { 'x-nimi-runtime-version': '0.4.0' },
  ]);
  assert.deepEqual(observedRequestMetadata, [{ 'x-nimi-runtime-version': '0.4.0' }]);
  assert.deepEqual(streamEvents, [{ event: 'ok' }]);
});

test('CoreClient serverStream return cancels pending transport streams', async () => {
  let resolveNextStarted!: () => void;
  const nextStarted = new Promise<void>((resolve) => {
    resolveNextStarted = resolve;
  });
  let resolvePendingNext: ((result: IteratorResult<{ event: string }>) => void) | undefined;
  let returnCalled = false;

  const transport: CoreTransport = {
    async unary() {
      throw new Error('unexpected unary call');
    },
    serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
      return {
        [Symbol.asyncIterator](): AsyncIterator<Response> {
          return {
            next: () => {
              resolveNextStarted();
              return new Promise<IteratorResult<Response>>((resolve) => {
                resolvePendingNext = resolve as (result: IteratorResult<{ event: string }>) => void;
              });
            },
            return: async () => {
              returnCalled = true;
              resolvePendingNext?.({ done: true, value: undefined });
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
  };

  const client = new CoreClient({ transport });
  const iterator = client
    .serverStream<{ event: string }>({
      methodId: '/runtime.v1.Test/Stream',
      body: {},
    })
    [Symbol.asyncIterator]();

  const pendingNext = iterator.next();
  await expectWithin(nextStarted, 500, 'transport stream next');
  const returned = await expectWithin(
    iterator.return?.() ?? Promise.resolve({ done: true, value: undefined }),
    500,
    'transport stream return',
  );
  const pendingNextResult = await expectWithin(pendingNext, 500, 'pending stream next');

  assert.deepEqual(returned, { done: true, value: undefined });
  assert.equal(returnCalled, true);
  assert.deepEqual(pendingNextResult, { done: true, value: undefined });
});
