#!/usr/bin/env node
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const version = '9.9.9';
const currentPlatformKey = 'linux';
const currentArchivePlatform = 'linux';
const currentArch = 'amd64';
const smokeTarget = `${currentPlatformKey}-${currentArch}`;

function resolvePosixShell() {
  if (process.platform !== 'win32') {
    return 'sh';
  }
  const gitExecutables = execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  for (const gitExecutable of gitExecutables) {
    const gitRoot = path.resolve(path.dirname(gitExecutable), '..');
    for (const candidate of [path.join(gitRoot, 'bin', 'sh.exe'), path.join(gitRoot, 'usr', 'bin', 'sh.exe')]) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error('install script smoke requires the POSIX shell bundled with Git for Windows');
}

const posixShell = resolvePosixShell();
const archiveName = `nimi-runtime_${version}_${currentArchivePlatform}_${currentArch}.tar.gz`;
const runtimeTag = `runtime/v${version}`;

function manifestPayload(tag) {
  return {
    tag,
    version,
    checksumsUrl: `http://127.0.0.1/checksums-${version}.txt`,
    archives: {
      [`${currentPlatformKey}-${currentArch}`]: {
        name: archiveName,
        url: `http://127.0.0.1/${archiveName}`,
      },
    },
  };
}

// The second route stands in for a manifest from another release owner.
const manifests = new Map([
  ['/runtime/latest.json', manifestPayload(runtimeTag)],
  ['/nimi/latest.json', manifestPayload(`nimi/v${version}`)],
]);

const server = http.createServer((request, response) => {
  if (manifests.has(request.url)) {
    response.writeHead(200, {
      'connection': 'close',
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(`${JSON.stringify(manifests.get(request.url))}\n`);
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

const manifestBase = `http://127.0.0.1:${address.port}`;

// Asynchronous so the in-process manifest server can answer the script.
function runInstall(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(posixShell, ['scripts/install.sh', ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    child.on('close', (status) => {
      resolve({ status, stdout, stderr, output: `${stdout}\n${stderr}` });
    });
  });
}

function failSmoke(message, result) {
  process.stderr.write(result?.stdout || '');
  process.stderr.write(result?.stderr || '');
  process.stderr.write(`install script smoke failed: ${message}\n`);
  process.exit(1);
}

const result = await runInstall(['--dry-run', '--target', smokeTarget], {
  NIMI_INSTALL_MANIFEST_URL: `${manifestBase}/runtime/latest.json`,
});
const foreign = await runInstall(['--dry-run', '--target', smokeTarget], {
  NIMI_INSTALL_MANIFEST_URL: `${manifestBase}/nimi/latest.json`,
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
  failSmoke(`exit code ${result.status ?? 1}`, result);
}
for (const token of [
  `Installing Nimi ${runtimeTag}`,
  archiveName,
  'Run: nimi start',
  'Run: nimi doctor',
  'Run: nimi status',
]) {
  if (!result.output.includes(token)) failSmoke(`missing ${JSON.stringify(token)}`, result);
}
if (result.output.includes('Run: nimi serve')) {
  failSmoke('legacy serve next-step detected', result);
}

// Another release owner's manifest is refused with a visible reason.
if (foreign.status === 0 || !foreign.stderr.includes(`does not describe a Runtime release (tag nimi/v${version}`)) {
  failSmoke('a nimi/v manifest was not refused as a non-Runtime release', foreign);
}

// A requested version resolves to the Runtime owner's tag and final archive.
const rcTag = `runtime/v${version}-rc.2`;
for (const requested of [rcTag, `v${version}-rc.2`, `${version}-rc.2`]) {
  const rc = await runInstall(['--dry-run', '--target', smokeTarget, '--version', requested]);
  if ((rc.status ?? 1) !== 0) failSmoke(`--version ${requested} exited ${rc.status ?? 1}`, rc);
  for (const token of [`Installing Nimi ${rcTag}`, `releases/download/${rcTag}/${archiveName}`]) {
    if (!rc.output.includes(token)) failSmoke(`--version ${requested} is missing ${JSON.stringify(token)}`, rc);
  }
  if (rc.output.includes(`nimi-runtime_${version}-rc.2_`)) {
    failSmoke('RC suffix leaked into final artifact name', rc);
  }
}

for (const requested of [`nimi/v${version}`, `sdk/v${version}`, `runtime/v${version}-preview.1`]) {
  const refused = await runInstall(['--dry-run', '--target', smokeTarget, '--version', requested]);
  if (refused.status === 0 || !refused.stderr.includes('--version must name a Runtime release')) {
    failSmoke(`--version ${requested} was not refused`, refused);
  }
}

process.stdout.write('install script smoke ok\n');
