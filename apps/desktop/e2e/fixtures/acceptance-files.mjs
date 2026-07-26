import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

// Immutable model/dependency artifacts at or above this size are hardlinked into the
// trial data root instead of byte-copied. Small files (manifests, registry JSON) stay
// real copies because the runtime may rewrite them in place, and an in-place write
// through a hardlink would corrupt the admitted source data root.
export const DEPENDENCY_LINK_THRESHOLD_BYTES = 4 * 1024 * 1024;

export function cloneDataRootDependency(source, target, stats, linkThresholdBytes = DEPENDENCY_LINK_THRESHOLD_BYTES) {
  const info = fs.lstatSync(source);
  if (info.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      cloneDataRootDependency(path.join(source, entry), path.join(target, entry), stats, linkThresholdBytes);
    }
    return stats;
  }
  if (info.isSymbolicLink()) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { force: true, verbatimSymlinks: true });
    return stats;
  }
  if (!info.isFile()) {
    throw new Error(`data-root dependency ${source} is neither a regular file, directory, nor symlink`);
  }
  fs.rmSync(target, { force: true });
  if (info.size >= linkThresholdBytes) {
    try {
      fs.linkSync(source, target);
      stats.linkedFiles += 1;
      stats.linkedBytes += info.size;
      return stats;
    } catch (error) {
      if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EMLINK'].includes(error?.code)) throw error;
      if (!stats.linkFallbackCode) stats.linkFallbackCode = error.code;
    }
  }
  fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
  stats.copiedFiles += 1;
  stats.copiedBytes += info.size;
  return stats;
}

export async function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

export async function terminateDaemon(daemon) {
  if (process.platform === 'win32' && daemon.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(daemon.pid), '/T', '/F'], { stdio: 'ignore' });
    await delay(1000);
    return;
  }
  let signaledProcessGroup = false;
  if (daemon.pid !== undefined) {
    try {
      process.kill(-daemon.pid, 'SIGTERM');
      signaledProcessGroup = true;
    } catch {
      try {
        process.kill(daemon.pid, 'SIGTERM');
      } catch {
        return;
      }
    }
  }
  const [daemonExitedAfterTerm, processGroupExitedAfterTerm] = await Promise.all([
    waitForDaemonExit(daemon, 5_000),
    signaledProcessGroup && daemon.pid !== undefined
      ? waitForProcessGroupExit(daemon.pid, 5_000)
      : Promise.resolve(true),
  ]);
  if (daemonExitedAfterTerm && processGroupExitedAfterTerm) return;
  if (daemon.pid !== undefined) {
    try {
      process.kill(signaledProcessGroup ? -daemon.pid : daemon.pid, 'SIGKILL');
    } catch {
      try {
        process.kill(daemon.pid, 'SIGKILL');
      } catch {
        // The process may have exited between the timeout and escalation.
      }
    }
  }
  const [daemonExitedAfterKill, processGroupExitedAfterKill] = await Promise.all([
    waitForDaemonExit(daemon, 2_000),
    signaledProcessGroup && daemon.pid !== undefined
      ? waitForProcessGroupExit(daemon.pid, 2_000)
      : Promise.resolve(true),
  ]);
  if (!daemonExitedAfterKill || !processGroupExitedAfterKill) {
    throw new Error(`Runtime daemon process group ${String(daemon.pid || '')} did not terminate`);
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const startedAt = Date.now();
  while (processGroupAlive(processGroupId)) {
    if (Date.now() - startedAt >= timeoutMs) return false;
    await delay(25);
  }
  return true;
}

function processGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function waitForDaemonExit(daemon, timeoutMs) {
  if (daemon.exitCode !== null || daemon.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      daemon.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    daemon.once('exit', onExit);
  });
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} failed with ${response.status}`);
  }
  return response.json();
}

export function safeResetDir(dir, { reportsRoot }) {
  const resolved = path.resolve(dir);
  const reportsRootPath = path.resolve(reportsRoot);
  if (!resolved.startsWith(reportsRootPath + path.sep)) {
    throw new Error(`refusing to reset non-report directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? String(error.cause) : undefined,
    };
  }
  return { message: String(error || '') };
}
