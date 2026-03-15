#!/usr/bin/env node
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const version = '9.9.9';

function platformKey() {
  if (process.platform === 'darwin') {
    return 'darwin';
  }
  if (process.platform === 'linux') {
    return 'linux';
  }
  throw new Error(`install script smoke only supports darwin/linux hosts, got ${process.platform}`);
}

function archivePlatform() {
  return platformKey() === 'darwin' ? 'macos' : 'linux';
}

function archiveArch() {
  if (process.arch === 'x64') {
    return 'amd64';
  }
  if (process.arch === 'arm64') {
    return 'arm64';
  }
  throw new Error(`unsupported architecture for install script smoke: ${process.arch}`);
}

const currentPlatformKey = platformKey();
const currentArchivePlatform = archivePlatform();
const currentArch = archiveArch();
const archiveName = `nimi-runtime_${version}_${currentArchivePlatform}_${currentArch}.tar.gz`;

const manifestPayload = {
  tag: `v${version}`,
  version,
  checksumsUrl: `http://127.0.0.1/checksums-${version}.txt`,
  archives: {
    [`${currentPlatformKey}-${currentArch}`]: {
      name: archiveName,
      url: `http://127.0.0.1/${archiveName}`,
    },
  },
};

const server = http.createServer((request, response) => {
  if (request.url === '/runtime/latest.json') {
    response.writeHead(200, {
      'connection': 'close',
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(`${JSON.stringify(manifestPayload)}\n`);
    return;
  }
  response.writeHead(404, {
    'connection': 'close',
    'content-type': 'text/plain; charset=utf-8',
  });
  response.end('not found');
});

await new Promise((resolve, reject) => {
  server.listen(0, '127.0.0.1', (error) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
});

const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('failed to bind local install manifest server');
}

const manifestUrl = `http://127.0.0.1:${address.port}/runtime/latest.json`;

const result = await new Promise((resolve, reject) => {
  const child = spawn(
    'sh',
    ['scripts/install.sh', '--dry-run'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NIMI_INSTALL_MANIFEST_URL: manifestUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('error', reject);
  child.on('close', (status, signal) => {
    resolve({
      error: null,
      signal,
      status,
      stderr,
      stdout,
    });
  });
});

await new Promise((resolve, reject) => {
  server.close((error) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
  server.closeAllConnections?.();
});

if ((result.status ?? 1) !== 0) {
  process.stderr.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.stderr.write(`install script smoke failed with exit code ${result.status ?? 1}\n`);
  process.exit(result.status ?? 1);
}

const output = `${result.stdout}\n${result.stderr}`;
const required = [
  `Installing Nimi v${version}`,
  archiveName,
  'Run: nimi start',
  'Run: nimi doctor',
  'Run: nimi run "What is Nimi?"',
];

for (const token of required) {
  if (!output.includes(token)) {
    process.stderr.write(`install script smoke failed: missing ${JSON.stringify(token)}\n`);
    process.exit(1);
  }
}

if (output.includes('Run: nimi serve')) {
  process.stderr.write('install script smoke failed: legacy serve next-step detected\n');
  process.exit(1);
}

process.stdout.write('install script smoke ok\n');
