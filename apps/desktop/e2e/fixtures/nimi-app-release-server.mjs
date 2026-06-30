import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ARTIFACT_PATHNAME = '/releases/nimi-app-platform-fixture.tar';
const METADATA_PATHNAME = '/releases/nimi-app-platform-fixture.metadata.json';

function json(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(payload)}\n`);
}

function options(response) {
  response.statusCode = 204;
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  response.end();
}

function artifactMetadata(artifactPath, artifactUrl) {
  const bytes = fs.readFileSync(artifactPath);
  return {
    artifactUrl,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  };
}

export async function startNimiAppReleaseFixtureServer(input) {
  const artifactPath = path.resolve(String(input?.artifactPath || '').trim());
  if (!artifactPath || !fs.existsSync(artifactPath)) {
    throw new Error(`Nimi App release fixture artifact is missing: ${artifactPath}`);
  }
  if (!fs.statSync(artifactPath).isFile()) {
    throw new Error(`Nimi App release fixture artifact is not a file: ${artifactPath}`);
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'OPTIONS') {
      options(response);
      return;
    }
    if (request.method !== 'GET') {
      json(response, 405, { error: 'method_not_allowed' });
      return;
    }
    if (url.pathname === ARTIFACT_PATHNAME) {
      response.statusCode = 200;
      response.setHeader('access-control-allow-origin', '*');
      response.setHeader('content-type', 'application/x-tar');
      response.setHeader('content-length', String(fs.statSync(artifactPath).size));
      fs.createReadStream(artifactPath).pipe(response);
      return;
    }
    if (url.pathname === METADATA_PATHNAME) {
      const artifactUrl = `${originFromServer(server)}${ARTIFACT_PATHNAME}`;
      json(response, 200, artifactMetadata(artifactPath, artifactUrl));
      return;
    }
    json(response, 404, { error: 'release_fixture_not_found', pathname: url.pathname });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const origin = originFromServer(server);
  const artifactUrl = `${origin}${ARTIFACT_PATHNAME}`;
  const metadataUrl = `${origin}${METADATA_PATHNAME}`;
  return {
    origin,
    artifactUrl,
    metadataUrl,
    sha256: artifactMetadata(artifactPath, artifactUrl).sha256,
    sizeBytes: artifactMetadata(artifactPath, artifactUrl).sizeBytes,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}

function originFromServer(server) {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Nimi App release fixture server has no TCP address');
  }
  return `http://127.0.0.1:${address.port}`;
}
