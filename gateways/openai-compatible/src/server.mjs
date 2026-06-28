import http from 'node:http';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export function createOpenAICompatibleGatewayHttpServer(gateway, options = {}) {
  if (!gateway || typeof gateway.fetch !== 'function') {
    throw new Error('OpenAI-compatible gateway HTTP server requires a gateway with fetch(request).');
  }
  const maxBodyBytes = normalizeMaxBodyBytes(options.maxBodyBytes);
  return http.createServer(async (incoming, outgoing) => {
    try {
      const request = await toWebRequest(incoming, { maxBodyBytes });
      const response = await gateway.fetch(request, {
        remoteAddress: incoming.socket.remoteAddress || '',
        gatewayOrigin: socketLoopbackOrigin(incoming.socket),
      });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      await writeWebResponseBody(response, outgoing);
    } catch (error) {
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
    }
  });
}

async function writeWebResponseBody(response, outgoing) {
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        await writeChunk(outgoing, Buffer.from(value));
      }
    }
    outgoing.end();
  } catch (error) {
    outgoing.destroy(error);
  } finally {
    reader.releaseLock();
  }
}

function writeChunk(outgoing, chunk) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      outgoing.off('error', onError);
      outgoing.off('drain', onDrain);
      reject(error);
    };
    const onDrain = () => {
      outgoing.off('error', onError);
      resolve();
    };
    outgoing.on('error', onError);
    if (outgoing.write(chunk)) {
      outgoing.off('error', onError);
      resolve();
    } else {
      outgoing.once('drain', onDrain);
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

async function toWebRequest(incoming, { maxBodyBytes }) {
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
