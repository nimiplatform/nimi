import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { formatError } from './acceptance-files.mjs';

export function localhostOrigin(origin) {
  const parsed = new URL(origin);
  if (parsed.hostname === '127.0.0.1') {
    parsed.hostname = 'localhost';
  }
  return parsed.origin;
}

export async function startAcceptanceRendererServer({ distDir, apiOrigin }) {
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://localhost');
      if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/__fixture/')) {
        await proxyRendererApiRequest({ request, response, requestUrl, apiOrigin });
        return;
      }
      serveRendererAsset({ response, requestUrl, distDir });
    } catch (error) {
      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end(formatError(error).message);
    }
  });
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('acceptance renderer server did not expose a TCP address');
  }
  return {
    origin: `http://localhost:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function proxyRendererApiRequest({ request, response, requestUrl, apiOrigin }) {
  const body = await readRequestBodyBuffer(request);
  const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, apiOrigin);
  const headers = { ...request.headers };
  delete headers.host;
  const upstream = await fetch(target, {
    method: request.method || 'GET',
    headers,
    body: body.length > 0 && request.method !== 'GET' && request.method !== 'HEAD' ? body : undefined,
  });
  response.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'content-encoding') {
      response.setHeader(key, value);
    }
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function serveRendererAsset({ response, requestUrl, distDir }) {
  const rawPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const decoded = decodeURIComponent(rawPath);
  const resolved = path.resolve(distDir, decoded.replace(/^\/+/u, ''));
  const normalizedDist = path.resolve(distDir);
  if (resolved !== normalizedDist && !resolved.startsWith(normalizedDist + path.sep)) {
    response.statusCode = 403;
    response.end('forbidden');
    return;
  }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    response.statusCode = 404;
    response.end('not found');
    return;
  }
  response.statusCode = 200;
  response.setHeader('content-type', contentTypeForPath(resolved));
  response.end(fs.readFileSync(resolved));
}

function contentTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

function readRequestBodyBuffer(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
