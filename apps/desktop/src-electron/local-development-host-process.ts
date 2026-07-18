import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

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
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'NO_COLOR', 'CI']) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0 && !value.includes('\0')) output[key] = value;
  }
  return output;
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
      const response = await fetch(origin, { redirect: 'error', signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) {
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
