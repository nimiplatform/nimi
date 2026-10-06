import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import test from 'node:test';

import { createDesktopStderrWriter } from '../src-electron/stderr-log.js';

test('Desktop stderr preserves output on an available stream', () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const write = createDesktopStderrWriter(stream);
  write('runtime disconnected\n');
  write('shutdown cleanup\n');
  assert.deepEqual(lines, ['runtime disconnected\n', 'shutdown cleanup\n']);
  stream.end();
  write('after end\n');
  assert.equal(lines.length, 2);
});

test('Desktop stderr stops after a synchronous write failure', () => {
  let writes = 0;
  const stream = new Writable({
    write() {
      writes += 1;
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    },
  });
  const write = createDesktopStderrWriter(stream);
  assert.doesNotThrow(() => write('runtime disconnected\n'));
  write('retry\n');
  assert.equal(writes, 1);
});

test('Desktop stderr handles asynchronous stream errors without retrying the failed sink', async () => {
  let writes = 0;
  const stream = new Writable({
    autoDestroy: false,
    write(_chunk, _encoding, callback) {
      writes += 1;
      queueMicrotask(() => callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })));
    },
  });
  const write = createDesktopStderrWriter(stream);
  const failed = once(stream, 'error');
  write('runtime disconnected\n');
  const [error] = await failed;
  assert.equal(error.code, 'EPIPE');
  // The listener must also cover errors from writes already in flight.
  assert.doesNotThrow(() => stream.emit('error', error));
  write('retry\n');
  assert.equal(writes, 1);
  stream.destroy();
});

test('renderer recovery logs survive a real closed stderr pipe and allow normal exit', { timeout: 10_000 }, async (t) => {
  const require = createRequire(import.meta.url);
  const hostUrl = new URL('../src-electron/renderer-log-host.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--import', require.resolve('tsx'), '--input-type=module', '-e', String.raw`
    import { errorMonitor } from 'node:events';
    import { createDesktopElectronRendererLogHost } from ${JSON.stringify(hostUrl)};
    const host = createDesktopElectronRendererLogHost({ verbose: false });
    let streamError;
    process.stderr.on(errorMonitor, (error) => { streamError = error.code; });
    process.stdin.once('data', async () => {
      const payload = { payload: {
        level: 'warn', area: 'runtime', message: 'action:runtime-disconnected',
        traceId: 'trace-001', flowId: 'flow-001', details: { retryable: true },
      } };
      host.commandHandlers.log_renderer_event({ payload });
      await new Promise((resolve) => setTimeout(resolve, 50));
      for (let i = 0; i < 10; i += 1) host.commandHandlers.log_renderer_event({ payload });
      process.stdout.write(JSON.stringify({ error: streamError, completed: true }));
    });
    process.stdout.write('ready\n');
  `], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  const ready = once(child.stdout, 'data');
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  const exited = once(child, 'exit');
  await ready;
  const closed = once(child.stderr, 'close');
  child.stderr.destroy();
  await closed;
  child.stdin.end('write');
  const [code, signal] = await exited;
  assert.equal(signal, null);
  assert.equal(code, 0, output);
  assert.deepEqual(JSON.parse(output.replace('ready\n', '')), { error: 'EPIPE', completed: true });
});
