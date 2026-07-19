import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const MAX_MEMORY_LOG_BYTES = 512 * 1024;

export class AcceptanceProcessSupervisor {
  constructor(logRoot) {
    this.logRoot = logRoot;
    this.processes = new Map();
  }

  async start(input) {
    if (this.processes.has(input.label)) throw new Error(`acceptance process label already exists: ${input.label}`);
    await mkdir(this.logRoot, { recursive: true, mode: 0o700 });
    const stdoutPath = path.join(this.logRoot, `${input.label}.stdout.log`);
    const stderrPath = path.join(this.logRoot, `${input.label}.stderr.log`);
    const stdoutFile = createWriteStream(stdoutPath, { flags: 'wx', mode: 0o600 });
    const stderrFile = createWriteStream(stderrPath, { flags: 'wx', mode: 0o600 });
    const child = spawn(input.command, input.args ?? [], {
      cwd: input.cwd,
      detached: true,
      env: input.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = {
      child,
      command: input.command,
      args: [...(input.args ?? [])],
      cwd: input.cwd,
      label: input.label,
      stdout: '',
      stderr: '',
      stdoutFile,
      stderrFile,
      stdoutPath,
      stderrPath,
    };
    this.processes.set(input.label, record);
    child.stdout.on('data', (chunk) => {
      input.onRawOutput?.('stdout', String(chunk));
      const projected = input.transformOutput ? input.transformOutput(String(chunk)) : String(chunk);
      stdoutFile.write(projected);
      record.stdout = appendBounded(record.stdout, projected);
    });
    child.stderr.on('data', (chunk) => {
      input.onRawOutput?.('stderr', String(chunk));
      const projected = input.transformOutput ? input.transformOutput(String(chunk)) : String(chunk);
      stderrFile.write(projected);
      record.stderr = appendBounded(record.stderr, projected);
    });
    child.once('exit', () => {
      stdoutFile.end();
      stderrFile.end();
    });
    await waitForSpawn(child, input.label);
    return record;
  }

  get(label) {
    return this.processes.get(label);
  }

  async waitForOutput(label, pattern, timeoutMs) {
    const record = this.processes.get(label);
    if (!record) throw new Error(`unknown acceptance process: ${label}`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const combined = `${record.stdout}\n${record.stderr}`;
      if (pattern.test(combined)) return combined;
      if (record.child.exitCode !== null) {
        throw new Error(`${label} exited before required output (${record.child.exitCode}): ${combined.slice(-2000)}`);
      }
      await delay(200);
    }
    throw new Error(`${label} did not emit required output before timeout`);
  }

  async stop(label, signal = 'SIGTERM') {
    const record = this.processes.get(label);
    if (!record || record.child.exitCode !== null) return;
    await terminateProcessGroup(record.child, signal);
  }

  async stopAll() {
    const labels = [...this.processes.keys()].reverse();
    const outcomes = await Promise.allSettled(labels.map((label) => this.stop(label)));
    const failures = outcomes.filter((value) => value.status === 'rejected');
    if (failures.length > 0) throw new AggregateError(failures.map((value) => value.reason), 'acceptance process cleanup failed');
  }

  project() {
    return [...this.processes.values()].map((record) => ({
      label: record.label,
      pid: record.child.pid ?? null,
      exitCode: record.child.exitCode,
      signalCode: record.child.signalCode,
      command: record.command,
      args: record.args,
      cwd: record.cwd,
      stdoutPath: record.stdoutPath,
      stderrPath: record.stderrPath,
    }));
  }
}

export async function assertPortsFree(ports) {
  const unique = [...new Set(ports)];
  if (unique.length !== ports.length || unique.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)) {
    throw new Error('acceptance ports must be unique non-privileged TCP ports');
  }
  const occupied = [];
  for (const port of unique) {
    if (await canConnect(port)) occupied.push(port);
  }
  if (occupied.length > 0) throw Object.assign(new Error(`Refusing unknown listeners on acceptance ports: ${occupied.join(', ')}`), {
    reasonCode: 'macos-dev-acceptance-port-occupied',
    actionHint: 'stop_the_exact_conflicting_processes_after_inspection',
  });
}

export async function waitForHTTP(url, input = {}) {
  const deadline = Date.now() + (input.timeoutMs ?? 90_000);
  let diagnostic = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(2_500) });
      const body = await response.text();
      if (response.status >= (input.minimumStatus ?? 200) && response.status <= (input.maximumStatus ?? 399)
        && (!input.validate || input.validate(response, body))) {
        return { status: response.status, body: body.slice(0, 10_000), url };
      }
      diagnostic = `status ${response.status}`;
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
    }
    await delay(350);
  }
  throw new Error(`HTTP readiness failed for ${url}: ${diagnostic}`);
}

export async function waitForTCP(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return;
    await delay(250);
  }
  throw new Error(`TCP readiness failed for 127.0.0.1:${port}`);
}

export function processRows() {
  const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,uid=,lstart=,command='], { encoding: 'utf8' });
  return output.split(/\r?\n/u).map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/u);
    return match ? {
      pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]), startedAt: match[4], command: match[5],
    } : null;
  }).filter(Boolean);
}

export function relevantProcessRows() {
  return processRows().filter((row) => /(?:Nimi Dev|Local App Host|Zhiyu|Electron|vite|esbuild|nimi-runtime|nest|realtime|nimi-realm)/iu.test(row.command));
}

export function processTree(rootPid) {
  const rows = processRows();
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (ids.has(row.ppid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => ids.has(row.pid));
}

export async function waitForProcessesGone(pids, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const live = new Set(processRows().map((row) => row.pid));
    if (pids.every((pid) => !live.has(pid))) return true;
    await delay(250);
  }
  return false;
}

export async function runBoundedCommand(input) {
  const supervisor = new AcceptanceProcessSupervisor(input.logRoot);
  const record = await supervisor.start(input);
  const exit = await waitForExit(record.child, input.timeoutMs ?? 60_000);
  if (exit.timedOut) await supervisor.stop(input.label);
  return Object.freeze({
    ...exit,
    stdout: record.stdout,
    stderr: record.stderr,
    pid: record.child.pid ?? null,
  });
}

async function terminateProcessGroup(child, signal) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  if ((await waitForExit(child, 8_000)).timedOut) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    if ((await waitForExit(child, 5_000)).timedOut) throw new Error(`process group ${child.pid} did not terminate`);
  }
}

async function waitForSpawn(child, label) {
  if (child.pid) return;
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (error) => reject(new Error(`${label} failed to spawn: ${error.message}`)));
  });
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { exitCode: child.exitCode, signalCode: child.signalCode, timedOut: false };
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish({ exitCode: null, signalCode: null, timedOut: true }), timeoutMs);
    const onExit = (exitCode, signalCode) => finish({ exitCode, signalCode, timedOut: false });
    const finish = (value) => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(value);
    };
    child.once('exit', onExit);
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(700, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function appendBounded(current, next) {
  const combined = `${current}${next}`;
  return combined.length <= MAX_MEMORY_LOG_BYTES ? combined : combined.slice(-MAX_MEMORY_LOG_BYTES);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
