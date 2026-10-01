import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_DEVELOPMENT_PACKAGE_SCRIPTS = new Set(['build:electron', 'dev:renderer']);

export type LocalDevelopmentPackageScript = 'build:electron' | 'dev:renderer';

export function resolveLocalDevelopmentPackageScriptInvocation(
  script: LocalDevelopmentPackageScript,
  platform: NodeJS.Platform = process.platform,
): { readonly command: string; readonly args: readonly string[]; readonly shell: boolean } {
  if (!LOCAL_DEVELOPMENT_PACKAGE_SCRIPTS.has(script)) throw new Error('local-development-supervisor-required');
  if (platform === 'win32') {
    return { command: `corepack.cmd pnpm run ${script}`, args: [], shell: true };
  }
  return { command: 'corepack', args: ['pnpm', 'run', script], shell: false };
}

export function localDevelopmentToolEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'NO_COLOR', 'CI', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0 && !value.includes('\0')) output[key] = value;
  }
  return output;
}

// POSIX owner guard. A watcher reads the stdin pipe only Desktop can write
// (explicitly: a background list would otherwise read /dev/null);
// the script then execs the target, which keeps this pid and process group.
// When Desktop is gone the pipe ends and the watcher stops its own group,
// escalating after the budget a Desktop stop gives the tree; a group id is
// never reused while its members live, so nothing outside it is signalled.
// After an ordinary stop the watcher only outlives the target by that budget.
const POSIX_OWNER_GUARD_SCRIPT = [
  'exec 3<&0',
  "(trap '' TERM; cat >/dev/null 2>&1; kill -TERM 0 2>/dev/null; sleep \"$0\"; kill -KILL 0 2>/dev/null) <&3 3<&- &",
  'exec "$@" </dev/null 3<&-',
].join('\n');
const POSIX_OWNER_LOSS_GRACE_SECONDS = 5;

/** @internal Starts an invocation that ends with its Desktop owner on POSIX. */
export function spawnPosixOwnerGuardedProcess(
  invocation: { readonly command: string; readonly args: readonly string[] },
  cwd: string,
  environment: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  return spawn('/bin/sh', [
    '-c',
    POSIX_OWNER_GUARD_SCRIPT,
    String(POSIX_OWNER_LOSS_GRACE_SECONDS),
    invocation.command,
    ...invocation.args,
  ], {
    cwd,
    env: environment,
    detached: true,
    windowsHide: true,
    stdio: 'pipe',
  });
}

export function spawnLocalDevelopmentPackageScript(
  script: LocalDevelopmentPackageScript,
  cwd: string,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly nodeExecutable?: string;
    readonly guardianPath?: string;
    readonly sourceEnvironment?: NodeJS.ProcessEnv;
  } = {},
): ChildProcessWithoutNullStreams {
  const platform = options.platform ?? process.platform;
  const invocation = resolveLocalDevelopmentPackageScriptInvocation(script, platform);
  const environment = localDevelopmentToolEnvironment(options.sourceEnvironment ?? process.env);
  if (platform !== 'win32') {
    return spawnPosixOwnerGuardedProcess(invocation, cwd, environment);
  }
  const guardianPath = options.guardianPath
    ?? fileURLToPath(new URL('./local-development-process-guardian.js', import.meta.url));
  const encodedInvocation = Buffer.from(JSON.stringify(invocation), 'utf8').toString('base64url');
  // Development already requires Node/Corepack. Run the guardian in that
  // external Node, never in the trusted Home executable. Read the bundled
  // script here because ordinary Node cannot resolve files inside app.asar.
  const guardianSource = readFileSync(guardianPath, 'utf8');
  return spawn(options.nodeExecutable ?? 'node', ['--input-type=module', '--eval', guardianSource, encodedInvocation], {
    cwd,
    env: environment,
    detached: true,
    windowsHide: true,
    stdio: 'pipe',
  });
}

export async function assertLocalDevelopmentRendererOriginAvailable(origin: string): Promise<void> {
  const url = new URL(origin);
  const host = url.hostname === 'localhost'
    ? '127.0.0.1'
    : url.hostname.replace(/^\[|\]$/gu, '');
  const port = Number(url.port);
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
          reject(new Error('local-development-dev-server-port-in-use'));
          return;
        }
        reject(error);
      };
      server.once('error', onError);
      server.listen({ host, port, exclusive: true }, () => {
        server.off('error', onError);
        resolve();
      });
    });
  } finally {
    await closeProbeServer(server);
  }
}

export async function waitForLocalDevelopmentRenderer(
  origin: string,
  child: ChildProcessWithoutNullStreams,
  stopped: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (stopped()) return;
    if (child.exitCode !== null) throw new Error(`local-development-dev-server-exited-${child.exitCode}`);
    try {
      if (await probeLocalDevelopmentRenderer(origin)) {
        await delay(250);
        if (child.exitCode !== null) throw new Error(`local-development-dev-server-exited-${child.exitCode}`);
        return;
      }
    } catch {
      // Continue until the bounded readiness deadline.
    }
    await delay(350);
  }
  throw new Error('local-development-dev-server-unavailable');
}

export async function probeLocalDevelopmentRenderer(origin: string): Promise<boolean> {
  const allowedOrigin = new URL(origin).origin;
  const signal = AbortSignal.timeout(2_000);
  let url = new URL(origin);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, { redirect: 'manual', signal });
    await response.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(response.status)) return response.status < 500;
    const location = response.headers.get('location');
    if (!location) return false;
    url = new URL(location, url);
    if (url.origin !== allowedOrigin || url.username || url.password) return false;
  }
  return false;
}

export async function terminateLocalDevelopmentProcessTree(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const terminator = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), [
      '/pid', String(child.pid), '/t', '/f',
    ], { windowsHide: true, stdio: 'ignore' });
    const code = await waitForChildExit(terminator, 10_000);
    if (code !== 0) throw new Error('local-development-process-cleanup-failed');
    await waitForChildExit(child, 10_000);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  if (await waitForChildExit(child, 5_000, false) !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  if (await waitForChildExit(child, 5_000, false) === null) {
    throw new Error('local-development-process-cleanup-failed');
  }
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
  rejectOnError = true,
): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => finish(null), timeoutMs);
    const onExit = (code: number | null) => finish(code ?? 0);
    const onError = (error: Error) => rejectOnError ? fail(error) : finish(null);
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const finish = (code: number | null) => { cleanup(); resolve(code); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function closeProbeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
