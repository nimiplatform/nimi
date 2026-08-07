import { spawn, type ChildProcess } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

const RUNTIME_EXECUTABLE_ENVIRONMENT = 'NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE';
const HOST_EXECUTABLE_ENVIRONMENT = 'NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_HOST_EXECUTABLE';
const DESKTOP_SOCKET_FILENAME = 'runtime-desktop.sock';
const SOCKET_WAIT_TIMEOUT_MS = 20_000;
const SOCKET_WAIT_INTERVAL_MS = 25;
const RESTART_DELAY_MS = 100;

export type DesktopLocalDevelopmentRuntimeCoordinator = {
  stop(): Promise<void>;
};

export async function startDesktopLocalDevelopmentRuntime(input: {
  readonly homeDirectory: string;
  readonly hostExecutable: string;
}): Promise<DesktopLocalDevelopmentRuntimeCoordinator> {
  if (process.platform !== 'darwin' || process.geteuid?.() === 0) {
    throw new Error('source-local-development-runtime-principal-invalid');
  }
  const runtimeExecutable = requireCurrentUserExecutable(
    process.env[RUNTIME_EXECUTABLE_ENVIRONMENT],
    'source-local-development-runtime-executable-invalid',
  );
  const hostExecutable = requireCurrentUserExecutable(
    input.hostExecutable,
    'source-local-development-runtime-host-invalid',
  );
  if (process.env[HOST_EXECUTABLE_ENVIRONMENT] !== hostExecutable) {
    throw new Error('source-local-development-runtime-host-invalid');
  }
  const homeDirectory = requireCanonicalDirectory(input.homeDirectory);
  const realmUrl = process.env.NIMI_REALM_URL;
  if (realmUrl !== 'http://127.0.0.1:3002') {
    throw new Error('source-local-development-realm-url-invalid');
  }
  const socketPath = path.join(
    homeDirectory,
    'Library',
    'Application Support',
    'Nimi',
    'RuntimeLocalDevelopment',
    'run',
    DESKTOP_SOCKET_FILENAME,
  );
  let child: ChildProcess | undefined;
  let stopped = false;
  let restartTimer: NodeJS.Timeout | undefined;
  let generation = 0;

  const launch = (): ChildProcess => {
    if (stopped || child) throw new Error('source-local-development-runtime-launch-invalid');
    generation += 1;
    const launchedGeneration = generation;
    const launched = spawn(runtimeExecutable, ['serve'], {
      cwd: path.dirname(runtimeExecutable),
      env: {
        HOME: homeDirectory,
        LANG: process.env.LANG || 'en_US.UTF-8',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        TMPDIR: process.env.TMPDIR || '/private/tmp',
        [HOST_EXECUTABLE_ENVIRONMENT]: hostExecutable,
        NIMI_REALM_URL: realmUrl,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child = launched;
    launched.once('exit', () => {
      if (child === launched) child = undefined;
      if (stopped || generation !== launchedGeneration) return;
      restartTimer = setTimeout(() => {
        restartTimer = undefined;
        if (!stopped && !child) launch();
      }, RESTART_DELAY_MS);
      restartTimer.unref();
    });
    return launched;
  };

  const terminateOnProcessExit = (): void => {
    stopped = true;
    child?.kill('SIGKILL');
  };
  process.once('exit', terminateOnProcessExit);
  const initial = launch();
  try {
    await waitForOwnerSocket(socketPath, initial);
  } catch (error) {
    process.removeListener('exit', terminateOnProcessExit);
    throw error;
  }

  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      process.removeListener('exit', terminateOnProcessExit);
      generation += 1;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = undefined;
      }
      const owned = child;
      child = undefined;
      if (!owned || owned.exitCode !== null || owned.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => {
          if (owned.exitCode === null && owned.signalCode === null) owned.kill('SIGKILL');
        }, 3_000);
        force.unref();
        owned.once('exit', () => {
          clearTimeout(force);
          resolve();
        });
        if (!owned.kill('SIGTERM')) {
          clearTimeout(force);
          resolve();
        }
      });
    },
  };
}

function requireCurrentUserExecutable(value: unknown, reason: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.trim() !== value) {
    throw new Error(reason);
  }
  const canonical = realpathSync(value);
  const metadata = lstatSync(value);
  const uid = process.geteuid?.();
  if (canonical !== value || !metadata.isFile() || metadata.isSymbolicLink()
    || uid === undefined || uid === 0 || metadata.uid !== uid || (metadata.mode & 0o022) !== 0) {
    throw new Error(reason);
  }
  return canonical;
}

function requireCanonicalDirectory(value: string): string {
  if (!path.isAbsolute(value) || value.trim() !== value || realpathSync(value) !== value) {
    throw new Error('source-local-development-runtime-home-invalid');
  }
  const metadata = lstatSync(value);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('source-local-development-runtime-home-invalid');
  }
  return value;
}

async function waitForOwnerSocket(socketPath: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + SOCKET_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('source-local-development-runtime-exited-before-ready');
    }
    try {
      const parent = lstatSync(path.dirname(socketPath));
      const endpoint = lstatSync(socketPath);
      const uid = process.geteuid?.();
      if (uid !== undefined && uid !== 0
        && parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === uid
        && (parent.mode & 0o777) === 0o700
        && endpoint.isSocket() && !endpoint.isSymbolicLink() && endpoint.uid === uid
        && (endpoint.mode & 0o777) === 0o600) {
        return;
      }
    } catch {
      // The child owns endpoint publication; absence remains not-ready.
    }
    await new Promise((resolve) => setTimeout(resolve, SOCKET_WAIT_INTERVAL_MS));
  }
  child.kill('SIGTERM');
  throw new Error('source-local-development-runtime-socket-timeout');
}
