import http from 'node:http';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export function createOpenAICompatibleGatewayHttpServer(gateway, options = {}) {
  if (!gateway || typeof gateway.fetch !== 'function') {
    throw new Error('OpenAI-compatible gateway HTTP server requires a gateway with fetch(request).');
  }
  const maxBodyBytes = normalizeMaxBodyBytes(options.maxBodyBytes);
  return http.createServer(async (incoming, outgoing) => {
    const cancellation = new AbortController();
    const abort = () => cancellation.abort(new Error('Gateway HTTP client disconnected'));
    const onClose = () => { if (!outgoing.writableFinished) abort(); };
    incoming.once('aborted', abort);
    outgoing.once('close', onClose);
    try {
      const request = await toWebRequest(incoming, { maxBodyBytes, signal: cancellation.signal });
      cancellation.signal.throwIfAborted();
      const response = await gateway.fetch(request, {
        remoteAddress: incoming.socket.remoteAddress || '',
        gatewayOrigin: socketLoopbackOrigin(incoming.socket),
      });
      if (cancellation.signal.aborted) {
        await response.body?.cancel(cancellation.signal.reason);
        return;
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      await writeWebResponseBody(response, outgoing, cancellation.signal);
    } catch (error) {
      if (outgoing.destroyed || cancellation.signal.aborted) return;
      if (outgoing.headersSent) {
        outgoing.destroy(error);
        return;
      }
      const status = error instanceof BodyTooLargeError ? 413 : 500;
      const code = error instanceof BodyTooLargeError
        ? 'NIMI_GATEWAY_REQUEST_TOO_LARGE'
        : 'NIMI_GATEWAY_HTTP_SERVER_ERROR';
      const message = error instanceof BodyTooLargeError
        ? 'OpenAI-compatible gateway request body is too large.'
        : 'OpenAI-compatible gateway HTTP server failed to read the request.';
      outgoing.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      outgoing.end(JSON.stringify({
        error: {
          message,
          type: status === 413 ? 'invalid_request_error' : 'server_error',
          code,
        },
      }));
    } finally {
      incoming.off('aborted', abort);
      outgoing.off('close', onClose);
    }
  });
}

async function writeWebResponseBody(response, outgoing, signal) {
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  const onAbort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        await writeChunk(outgoing, Buffer.from(value));
      }
    }
    if (!outgoing.destroyed) outgoing.end();
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    outgoing.destroy(error);
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function writeChunk(outgoing, chunk) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      outgoing.off('error', onError);
      outgoing.off('drain', onDrain);
      outgoing.off('close', onClose);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => onError(new Error('Gateway HTTP response closed'));
    const onDrain = () => {
      cleanup();
      resolve();
    };
    if (outgoing.destroyed) { onClose(); return; }
    outgoing.on('error', onError);
    outgoing.once('close', onClose);
    try {
      if (outgoing.write(chunk)) {
        onDrain();
      } else {
        outgoing.once('drain', onDrain);
      }
    } catch (error) {
      onError(error);
    }
  });
}

export function listenOpenAICompatibleGateway({ gateway, host = '127.0.0.1', port = 43181 }) {
  assertLoopbackHost(host);
  const server = createOpenAICompatibleGatewayHttpServer(gateway);
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      reject(error);
    };
    server.on('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

export function assertLoopbackHost(host) {
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error('OpenAI-compatible gateway v1 only supports numeric loopback hosts.');
  }
}

class BodyTooLargeError extends Error {}

function normalizeMaxBodyBytes(value) {
  const number = Number(value ?? DEFAULT_MAX_BODY_BYTES);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error('OpenAI-compatible gateway maxBodyBytes must be a positive integer.');
  }
  return number;
}

async function toWebRequest(incoming, { maxBodyBytes, signal }) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of incoming) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBodyBytes) {
      throw new BodyTooLargeError('request body too large');
    }
    chunks.push(buffer);
  }
  const protocol = incoming.socket.encrypted ? 'https' : 'http';
  const host = incoming.headers.host || '127.0.0.1';
  const url = `${protocol}://${host}${incoming.url || '/'}`;
  return new Request(url, {
    method: incoming.method || 'GET',
    headers: incoming.headers,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    signal,
  });
}

function socketLoopbackOrigin(socket) {
  const host = numericLoopbackOriginHost(socket.localAddress || '');
  const port = Number(socket.localPort || 0);
  if (!host || !Number.isInteger(port) || port < 1) {
    return undefined;
  }
  const protocol = socket.encrypted ? 'https' : 'http';
  return `${protocol}://${host}:${port}`;
}

function numericLoopbackOriginHost(address) {
  if (address === '127.0.0.1' || address === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }
  if (address === '::1') {
    return '[::1]';
  }
  return '';
}
