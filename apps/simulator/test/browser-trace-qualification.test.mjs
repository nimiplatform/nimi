import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  createBrowserTraceQualification,
  traceWindowEvidence,
} from '../build/browser-trace-qualification.mjs';

class FakeCdp extends EventEmitter {
  constructor(traceFactory) {
    super();
    this.traceFactory = traceFactory;
    this.commands = [];
    this.stream = Buffer.alloc(0);
    this.offset = 0;
  }

  async send(method, params = {}) {
    this.commands.push({ method, params });
    if (method === 'Page.captureScreenshot') return { data: Buffer.from('png').toString('base64') };
    if (method === 'Tracing.end') {
      this.stream = Buffer.from(this.traceFactory(this.commands));
      this.offset = 0;
      queueMicrotask(() => this.emit('Tracing.tracingComplete', { stream: 'trace-stream' }));
      return {};
    }
    if (method === 'IO.read') {
      const next = this.stream.subarray(this.offset, this.offset + 7);
      this.offset += next.length;
      return { data: next.toString('base64'), base64Encoded: true, eof: this.offset === this.stream.length };
    }
    return {};
  }
}

function validTrace(commands) {
  const markers = commands
    .filter((row) => row.method === 'Tracing.recordClockSyncMarker')
    .slice(-2)
    .map((row, index) => ({ name: 'clock_sync', ts: 10 + index * 20, args: { sync_id: row.params.syncId } }));
  return JSON.stringify({ traceEvents: [markers[0], { name: 'Paint', ts: 20, args: {} }, markers[1]] });
}

test('shared trace qualification serializes tokens and preserves Paint evidence', async () => {
  const cdp = new FakeCdp(validTrace);
  const traces = createBrowserTraceQualification({ cdp, errorPrefix: 'TEST', tokenPrefix: 'trace' });
  const firstToken = await traces.begin({ instanceId: 'one', surfaceId: 'main' });
  const secondBegin = traces.begin({ instanceId: 'two', surfaceId: 'main' });
  let secondSettled = false;
  void secondBegin.then(() => { secondSettled = true; });
  await Promise.resolve();
  assert.equal(secondSettled, false);
  await traces.mark({ observationToken: firstToken, ordinal: 'first', frame: 1 });
  await traces.mark({ observationToken: firstToken, ordinal: 'second', frame: 2 });
  assert.equal(await traces.end({ observationToken: firstToken, firstFrame: 1, secondFrame: 2 }), true);
  const secondToken = await secondBegin;
  assert.equal(secondToken, 'trace-2');
  await traces.mark({ observationToken: secondToken, ordinal: 'first', frame: 3 });
  await traces.mark({ observationToken: secondToken, ordinal: 'second', frame: 4 });
  assert.equal(await traces.end({ observationToken: secondToken, firstFrame: 3, secondFrame: 4 }), true);
  await traces.close();
  assert.equal(traces.evidence.length, 2);
  assert.equal(cdp.commands.filter((row) => row.method === 'Tracing.start').length, 2);
});

test('shared trace fails closed on missing Paint, malformed trace, and marker drift', async () => {
  const missingPaint = traceWindowEvidence([
    { name: 'clock_sync', ts: 1, args: { sync_id: 'token:first' } },
    { name: 'clock_sync', ts: 2, args: { sync_id: 'token:second' } },
  ], 'token', 1, 2);
  assert.equal(missingPaint.ok, false);
  assert.equal(missingPaint.reason, 'paint-composite-event-missing');

  const malformedCdp = new FakeCdp(() => '{"traceEvents":[');
  const malformed = createBrowserTraceQualification({ cdp: malformedCdp, errorPrefix: 'TEST', tokenPrefix: 'bad' });
  const token = await malformed.begin({ instanceId: 'one', surfaceId: 'main' });
  await assert.rejects(
    malformed.end({ observationToken: token, firstFrame: null, secondFrame: null }),
    SyntaxError,
  );

  const driftCdp = new FakeCdp(validTrace);
  const drift = createBrowserTraceQualification({ cdp: driftCdp, errorPrefix: 'TEST', tokenPrefix: 'drift' });
  const driftToken = await drift.begin({ instanceId: 'one', surfaceId: 'main' });
  await drift.mark({ observationToken: driftToken, ordinal: 'first', frame: 1 });
  await drift.mark({ observationToken: driftToken, ordinal: 'second', frame: 2 });
  await assert.rejects(
    drift.end({ observationToken: driftToken, firstFrame: 1, secondFrame: 3 }),
    /TEST_TRACE_FRAME_DRIFT/u,
  );
});

test('shared trace close drains an active trace and prevents new tokens', async () => {
  const cdp = new FakeCdp(validTrace);
  const traces = createBrowserTraceQualification({ cdp, errorPrefix: 'TEST', tokenPrefix: 'close' });
  await traces.begin({ instanceId: 'one', surfaceId: 'main' });
  await traces.close();
  assert.equal(traces.evidence.at(-1)?.reason, 'cancelled');
  await assert.rejects(
    traces.begin({ instanceId: 'two', surfaceId: 'main' }),
    /TEST_TRACE_CLOSED/u,
  );
});
