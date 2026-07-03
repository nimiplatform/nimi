import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export function seedAdmittedProductControlFromUserHome({ homeDir, stateRoot }) {
  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  if (!userHome) {
    return { seeded: false, reason: 'user_home_unavailable' };
  }
  const sourceProductControlPath = path.join(userHome, '.nimi', 'nimi.json');
  const sourceLocalStatePath = path.join(userHome, '.nimi', 'runtime', 'local-state.json');
  if (!fs.existsSync(sourceProductControlPath) || !fs.existsSync(sourceLocalStatePath)) {
    return { seeded: false, reason: 'admitted_product_control_source_missing' };
  }
  const productControl = readJsonFile(sourceProductControlPath);
  if (productControl?.state !== 'ready_for_use') {
    return { seeded: false, reason: `source_product_control_not_ready:${String(productControl?.state || '')}` };
  }
  const targetProductControlPath = path.join(homeDir, '.nimi', 'nimi.json');
  const targetLocalStatePath = path.join(stateRoot, 'local-state.json');
  fs.mkdirSync(path.dirname(targetProductControlPath), { recursive: true });
  fs.mkdirSync(path.dirname(targetLocalStatePath), { recursive: true });
  fs.copyFileSync(sourceProductControlPath, targetProductControlPath);
  fs.copyFileSync(sourceLocalStatePath, targetLocalStatePath);
  return {
    seeded: true,
    productControlState: productControl.state,
    sourceDataRoot: String(productControl?.dataRoot?.path || ''),
    targetProductControlPath,
    targetLocalStatePath,
  };
}

export function normalizeOptionalPath(value) {
  return String(value || '').trim();
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
  if (daemon.pid !== undefined) {
    try {
      process.kill(-daemon.pid, 'SIGTERM');
    } catch {
      try {
        process.kill(daemon.pid, 'SIGTERM');
      } catch {
        return;
      }
    }
  }
  await delay(1000);
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} failed with ${response.status}`);
  }
  return response.json();
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
