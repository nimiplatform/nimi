import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { formatError } from './acceptance-files.mjs';

export function localhostOrigin(origin) {
  const parsed = new URL(origin);
  if (parsed.hostname === '127.0.0.1') {
    parsed.hostname = 'localhost';
  }
  return parsed.origin;
}

export async function startAcceptanceRendererServer({ distDir, apiOrigin }) {
  const capturedRequests = [];
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://localhost');
      if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/__fixture/')) {
        await proxyRendererApiRequest({ request, response, requestUrl, apiOrigin, capturedRequests });
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
    capturedRequests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function proxyRendererApiRequest({ request, response, requestUrl, apiOrigin, capturedRequests }) {
  const body = await readRequestBodyBuffer(request);
  let captureRecord = null;
  let packetRequestBody = null;
  if (request.method === 'POST' && requestUrl.pathname === '/api/human/me/permission-grants') {
    let grantRequestBody = null;
    try { grantRequestBody = JSON.parse(body.toString('utf8')); } catch { grantRequestBody = null; }
    captureRecord = { method: request.method, pathname: requestUrl.pathname, grantRequestBody };
    capturedRequests.push(captureRecord);
  } else if (request.method === 'POST' && /^\/api\/human\/me\/permission-grants\/by-id\/[^/]+\/grant$/u.test(requestUrl.pathname)) {
    let grantDecisionBody = null;
    try { grantDecisionBody = JSON.parse(body.toString('utf8')); } catch { grantDecisionBody = null; }
    captureRecord = { method: request.method, pathname: requestUrl.pathname, grantDecisionBody };
    capturedRequests.push(captureRecord);
  } else if (request.method === 'POST' && requestUrl.pathname === '/api/realm/core/source-materialization-packets') {
    let sourceRef = null;
    try {
      packetRequestBody = JSON.parse(body.toString('utf8'));
      sourceRef = packetRequestBody.sourceRef || null;
    } catch {
      packetRequestBody = null;
    }
    captureRecord = { method: request.method, pathname: requestUrl.pathname, sourceRef };
    capturedRequests.push(captureRecord);
  } else if (request.method === 'GET' && requestUrl.pathname === '/api/auth/jwks/source-materialization') {
    captureRecord = { method: request.method, pathname: requestUrl.pathname };
    capturedRequests.push(captureRecord);
  }
  const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, apiOrigin);
  const headers = { ...request.headers };
  delete headers.host;
  const upstream = await fetch(target, {
    method: request.method || 'GET',
    headers,
    body: body.length > 0 && request.method !== 'GET' && request.method !== 'HEAD' ? body : undefined,
    redirect: 'manual',
  });
  response.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'content-encoding') {
      response.setHeader(key, value);
    }
  });
  const responseBytes = Buffer.from(await upstream.arrayBuffer());
  if (captureRecord) {
    captureRecord.status = upstream.status;
    try {
      const responseBody = JSON.parse(responseBytes.toString('utf8'));
      if (upstream.ok && captureRecord.pathname === '/api/realm/core/source-materialization-packets') {
        const [protectedHeader, detachedPayload, signature] = String(responseBody?.packetProof?.compactJws || '').split('.');
        let detachedProofVerified = false;
        const expectedSignedPayload = responseBody?.packetHash
          ? `nimi.realm.source-materialization-proof/v3\0${responseBody.packetHash}`
          : '';
        if (protectedHeader && detachedPayload === '' && signature
            && responseBody?.packetProof?.signedPayload === expectedSignedPayload) {
          const jwksResponse = await fetch(new URL('/api/auth/jwks/source-materialization', apiOrigin));
          const jwks = await jwksResponse.json();
          const jwk = jwks?.keys?.find((key) => key?.kid === responseBody.keyId);
          if (jwk) {
            const payload = Buffer.from(expectedSignedPayload, 'utf8').toString('base64url');
            detachedProofVerified = verify('RSA-SHA256', Buffer.from(`${protectedHeader}.${payload}`, 'ascii'), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url'));
          }
        }
        captureRecord.packet = {
          schemaVersion: responseBody?.packetSchemaVersion || '',
          issuer: responseBody?.issuer || '',
          keyId: responseBody?.keyId || '',
          algorithm: responseBody?.algorithm || '',
          detachedProofVerified,
          materializerBindingMatch: responseBody?.materializerAccountId === packetRequestBody?.materializerAccountId,
          challengeBindingMatch: responseBody?.challengeId === packetRequestBody?.challengeId
            && responseBody?.challengeDigest === packetRequestBody?.challengeDigest,
          audienceBindingMatch: responseBody?.intendedRuntimeAudience === packetRequestBody?.intendedRuntimeAudience,
          expiryBindingMatch: responseBody?.expiresAt === packetRequestBody?.challengeExpiresAt,
          limitsBindingMatch: JSON.stringify(responseBody?.publishedLimits) === JSON.stringify(packetRequestBody?.publishedLimits),
          sourceBindingMatch: JSON.stringify(responseBody?.sourceRef) === JSON.stringify(packetRequestBody?.sourceRef),
        };
      } else if (upstream.ok && captureRecord.pathname === '/api/human/me/permission-grants') {
        captureRecord.grant = {
          grantId: responseBody?.grantId || '', state: responseBody?.state || '', version: responseBody?.version,
          selectorMatch: responseBody?.appId === 'nimi.avatar'
            && responseBody?.scopeFamily === 'realm_source'
            && responseBody?.scopeName === 'realm_source.snapshot.consume',
        };
      } else if (upstream.ok && /\/grant$/u.test(captureRecord.pathname)) {
        captureRecord.grant = {
          grantId: responseBody?.grantId || '', state: responseBody?.state || '', version: responseBody?.version,
        };
      } else if (upstream.ok) {
        captureRecord.keyIds = (responseBody?.keys || []).map((key) => key?.kid).filter(Boolean);
        captureRecord.keyPurposes = (responseBody?.keys || []).map((key) => key?.purpose).filter(Boolean);
      } else {
        const errorBody = responseBody;
        captureRecord.reasonCode = String(errorBody?.reasonCode || errorBody?.code || '');
        captureRecord.message = String(errorBody?.message || '').slice(0, 240);
      }
    } catch {
      captureRecord.responseJsonObserved = false;
    }
  }
  response.end(responseBytes);
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
