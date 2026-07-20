import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SDK_DIST_LOCK_TOKEN_ENV = 'NIMI_SDK_DIST_LOCK_TOKEN';
export const SDK_DIST_LOCK_DIR_ENV = 'NIMI_SDK_DIST_LOCK_DIR';
export const SDK_DIST_PREPARED_ENV = 'NIMI_SDK_DIST_PREPARED';

export function isSdkDistPrepared(env = process.env) {
  return env[SDK_DIST_PREPARED_ENV] === '1';
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..');
const DEFAULT_POLL_MS = 250;
const DEFAULT_STALE_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_WAIT_LOG_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readDurationMs(value, fallback, name) {
  const normalized = value === undefined || value === null || value === '' ? fallback : value;
  const duration = Number(normalized);
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`[sdk-dist-lock] ${name} must be a finite non-negative millisecond value`);
  }
  return duration;
}

function lockDir() {
  const configured = String(process.env[SDK_DIST_LOCK_DIR_ENV] || '').trim();
  if (configured) {
    return configured;
  }
  const fingerprint = createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `nimi-sdk-dist-${fingerprint}.lock`);
}

function ownerPath(dir) {
  return path.join(dir, 'owner.json');
}

function readOwner(dir) {
  try {
    return JSON.parse(fs.readFileSync(ownerPath(dir), 'utf8'));
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function describeOwner(owner) {
  if (!owner || typeof owner !== 'object') {
    return 'unknown owner';
  }
  const label = typeof owner.label === 'string' && owner.label ? owner.label : 'unlabeled gate';
  const pid = Number.isInteger(owner.pid) ? `pid=${owner.pid}` : 'pid=unknown';
  const createdAt = typeof owner.createdAt === 'string' && owner.createdAt ? `created=${owner.createdAt}` : '';
  return [label, pid, createdAt].filter(Boolean).join(', ');
}

function removeStaleLock(dir, staleMs) {
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return true;
    }
    throw error;
  }

  if (Date.now() - stat.mtimeMs < staleMs) {
    return false;
  }

  const owner = readOwner(dir);
  if (owner && processIsAlive(Number(owner.pid))) {
    return false;
  }

  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

async function acquireSdkDistLock(label, options = {}) {
  const dir = lockDir();
  const token = randomUUID();
  const startedAt = Date.now();
  const pollMs = readDurationMs(
    options.pollMs ?? process.env.NIMI_SDK_DIST_LOCK_POLL_MS,
    DEFAULT_POLL_MS,
    'NIMI_SDK_DIST_LOCK_POLL_MS',
  );
  const staleMs = readDurationMs(
    options.staleMs ?? process.env.NIMI_SDK_DIST_LOCK_STALE_MS,
    DEFAULT_STALE_MS,
    'NIMI_SDK_DIST_LOCK_STALE_MS',
  );
  const timeoutMs = readDurationMs(
    options.timeoutMs ?? process.env.NIMI_SDK_DIST_LOCK_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    'NIMI_SDK_DIST_LOCK_TIMEOUT_MS',
  );
  const waitLogMs = readDurationMs(
    options.waitLogMs ?? process.env.NIMI_SDK_DIST_LOCK_WAIT_LOG_MS,
    DEFAULT_WAIT_LOG_MS,
    'NIMI_SDK_DIST_LOCK_WAIT_LOG_MS',
  );
  let lastWaitLogAt = 0;

  while (true) {
    try {
      fs.mkdirSync(dir, { recursive: false });
      fs.writeFileSync(
        ownerPath(dir),
        `${JSON.stringify({
          token,
          label,
          pid: process.pid,
          createdAt: new Date().toISOString(),
          repoRoot,
        }, null, 2)}\n`,
      );
      return { dir, token };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }

    const owner = readOwner(dir);
    if (removeStaleLock(dir, staleMs)) {
      continue;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(
        `[sdk-dist-lock] timed out waiting for SDK dist lock after ${elapsed}ms; holder: ${describeOwner(owner)}`,
      );
    }

    if (Date.now() - lastWaitLogAt >= waitLogMs) {
      process.stdout.write(`[sdk-dist-lock] waiting for SDK dist lock: ${label}; holder: ${describeOwner(owner)}\n`);
      lastWaitLogAt = Date.now();
    }
    await sleep(Math.max(25, pollMs));
  }
}

function releaseSdkDistLock(lock) {
  const owner = readOwner(lock.dir);
  if (!owner || owner.token !== lock.token) {
    return;
  }
  fs.rmSync(lock.dir, { recursive: true, force: true });
}

export async function withSdkDistLock(label, callback, options = {}) {
  if (process.env[SDK_DIST_LOCK_TOKEN_ENV]) {
    return callback();
  }

  const lock = await acquireSdkDistLock(label, options);
  const previousToken = process.env[SDK_DIST_LOCK_TOKEN_ENV];
  const previousDir = process.env[SDK_DIST_LOCK_DIR_ENV];

  process.env[SDK_DIST_LOCK_TOKEN_ENV] = lock.token;
  process.env[SDK_DIST_LOCK_DIR_ENV] = lock.dir;
  try {
    return await callback();
  } finally {
    if (previousToken === undefined) {
      delete process.env[SDK_DIST_LOCK_TOKEN_ENV];
    } else {
      process.env[SDK_DIST_LOCK_TOKEN_ENV] = previousToken;
    }
    if (previousDir === undefined) {
      delete process.env[SDK_DIST_LOCK_DIR_ENV];
    } else {
      process.env[SDK_DIST_LOCK_DIR_ENV] = previousDir;
    }
    releaseSdkDistLock(lock);
  }
}
