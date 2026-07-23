import { sha256Digest } from '@nimiplatform/app-tools/simulator-conformance';

export const QUALIFICATION_BINDINGS = Object.freeze({
  begin: '__NIMI_SIMULATOR_QUALIFICATION_BEGIN_V1__',
  mark: '__NIMI_SIMULATOR_QUALIFICATION_MARK_V1__',
  end: '__NIMI_SIMULATOR_QUALIFICATION_END_V1__',
});

const TRACE_CATEGORIES = [
  '-*',
  'blink',
  'cc',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
].join(',');

const PAINT_COMPOSITE_EVENTS = new Set([
  'Paint',
  'PaintImage',
  'CompositeLayers',
  'DrawFrame',
  'RasterTask',
]);

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}:object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}:fields`);
}

async function readTraceStream(cdp, handle) {
  const chunks = [];
  while (true) {
    const row = await cdp.send('IO.read', { handle });
    chunks.push(row.base64Encoded ? Buffer.from(row.data, 'base64') : Buffer.from(row.data));
    if (row.eof) break;
  }
  await cdp.send('IO.close', { handle });
  return Buffer.concat(chunks);
}

function clockSyncId(event) {
  return event?.args?.sync_id ?? event?.args?.syncId ?? event?.args?.data?.sync_id ?? null;
}

export function traceWindowEvidence(events, token, firstFrame, secondFrame) {
  const firstId = `${token}:first`;
  const secondId = `${token}:second`;
  const firstMarker = events.find((event) => event.name === 'clock_sync' && clockSyncId(event) === firstId);
  const secondMarker = events.find((event) => event.name === 'clock_sync' && clockSyncId(event) === secondId);
  if (!firstMarker || !secondMarker || !(secondMarker.ts > firstMarker.ts)) {
    const markerSamples = events
      .filter((event) => JSON.stringify(event).includes(token) || /clock/i.test(event.name ?? ''))
      .slice(0, 12)
      .map((event) => ({ name: event.name, category: event.cat, timestamp: event.ts, args: event.args }));
    return {
      ok: false,
      reason: 'clock-sync-marker-missing',
      firstFrame,
      secondFrame,
      events: [],
      markerSamples,
    };
  }
  const matched = events
    .filter((event) => event.ts >= firstMarker.ts
      && event.ts <= secondMarker.ts
      && PAINT_COMPOSITE_EVENTS.has(event.name))
    .map((event) => event.name)
    .sort();
  return {
    ok: matched.length > 0,
    reason: matched.length > 0 ? null : 'paint-composite-event-missing',
    firstFrame,
    secondFrame,
    markerIntervalMicros: secondMarker.ts - firstMarker.ts,
    events: [...new Set(matched)],
  };
}

export function createBrowserTraceQualification({ cdp, errorPrefix, tokenPrefix }) {
  if (!cdp || typeof cdp.send !== 'function' || typeof cdp.once !== 'function') {
    throw new Error(`${errorPrefix}_TRACE_CDP_INVALID`);
  }
  let sequence = 0;
  let tail = Promise.resolve();
  let active = null;
  let closed = false;
  const evidence = [];

  async function begin(input) {
    exactObject(input, ['instanceId', 'surfaceId'], `${errorPrefix}_TRACE_BEGIN`);
    if (closed) throw new Error(`${errorPrefix}_TRACE_CLOSED`);
    if (typeof input.instanceId !== 'string' || typeof input.surfaceId !== 'string') {
      throw new Error(`${errorPrefix}_TRACE_BEGIN_VALUE`);
    }
    let release;
    const slot = new Promise((resolve) => { release = resolve; });
    const prior = tail;
    tail = prior.then(() => slot);
    await prior;
    if (closed) {
      release();
      throw new Error(`${errorPrefix}_TRACE_CLOSED`);
    }
    if (active) {
      release();
      throw new Error(`${errorPrefix}_TRACE_OVERLAP`);
    }
    const token = `${tokenPrefix}-${++sequence}`;
    const completed = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
    try {
      await cdp.send('Tracing.start', {
        categories: TRACE_CATEGORIES,
        transferMode: 'ReturnAsStream',
      });
    } catch (error) {
      release();
      throw error;
    }
    active = { token, input, release, completed, frames: {} };
    return token;
  }

  async function mark(input) {
    exactObject(input, ['observationToken', 'ordinal', 'frame'], `${errorPrefix}_TRACE_MARK`);
    if (!active || input.observationToken !== active.token
      || !['first', 'second'].includes(input.ordinal)
      || !Number.isFinite(input.frame)
      || Object.hasOwn(active.frames, input.ordinal)) return false;
    await cdp.send('Tracing.recordClockSyncMarker', { syncId: `${active.token}:${input.ordinal}` });
    active.frames[input.ordinal] = input.frame;
    if (input.ordinal === 'first') {
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      active.probeScreenshotDigest = sha256Digest(Buffer.from(screenshot.data, 'base64'));
    }
    return true;
  }

  async function end(input) {
    exactObject(input, ['observationToken', 'firstFrame', 'secondFrame'], `${errorPrefix}_TRACE_END`);
    const current = active;
    if (!current || input.observationToken !== current.token) return false;
    active = null;
    try {
      await cdp.send('Tracing.end');
      const complete = await current.completed;
      if (!complete.stream) throw new Error(`${errorPrefix}_TRACE_STREAM_MISSING`);
      const bytes = await readTraceStream(cdp, complete.stream);
      const trace = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(trace.traceEvents)) throw new Error(`${errorPrefix}_TRACE_EVENTS_MISSING`);
      if (input.firstFrame === null || input.secondFrame === null) {
        evidence.push({
          token: current.token,
          instanceId: current.input.instanceId,
          surfaceId: current.input.surfaceId,
          ok: false,
          reason: 'cancelled',
          traceDigest: sha256Digest(bytes),
        });
        return false;
      }
      if (current.frames.first !== input.firstFrame || current.frames.second !== input.secondFrame) {
        throw new Error(`${errorPrefix}_TRACE_FRAME_DRIFT`);
      }
      const window = traceWindowEvidence(trace.traceEvents, current.token, input.firstFrame, input.secondFrame);
      evidence.push({
        token: current.token,
        instanceId: current.input.instanceId,
        surfaceId: current.input.surfaceId,
        traceDigest: sha256Digest(bytes),
        probeScreenshotDigest: current.probeScreenshotDigest ?? null,
        ...window,
      });
      if (!current.probeScreenshotDigest) {
        evidence[evidence.length - 1].ok = false;
        evidence[evidence.length - 1].reason = 'probe-screenshot-missing';
      }
      return evidence[evidence.length - 1].ok;
    } finally {
      current.release();
    }
  }

  async function whenIdle() {
    await tail;
  }

  async function close() {
    if (closed) return;
    closed = true;
    const current = active;
    if (current) {
      await end({
        observationToken: current.token,
        firstFrame: null,
        secondFrame: null,
      });
    }
    await whenIdle();
  }

  return { begin, mark, end, whenIdle, close, evidence };
}

export async function installQualificationBindings(page, traces) {
  await page.exposeBinding(QUALIFICATION_BINDINGS.begin, (_source, input) => traces.begin(input));
  await page.exposeBinding(QUALIFICATION_BINDINGS.mark, (_source, input) => traces.mark(input));
  await page.exposeBinding(QUALIFICATION_BINDINGS.end, (_source, input) => traces.end(input));
}
