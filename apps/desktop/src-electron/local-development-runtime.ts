import { spawn, type ChildProcess } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

const MACOS_RUNTIME_EXECUTABLE_ENVIRONMENT = 'NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE';
const MACOS_DESKTOP_EXECUTABLE_ENVIRONMENT = 'NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_HOST_EXECUTABLE';
const WINDOWS_RUNTIME_EXECUTABLE_ENVIRONMENT = 'NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE';
const WINDOWS_DESKTOP_EXECUTABLE_ENVIRONMENT = 'NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_DESKTOP_EXECUTABLE';
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
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    throw new Error('source-local-development-runtime-platform-invalid');
  }
  if (process.platform === 'darwin' && process.geteuid?.() === 0) {
    throw new Error('source-local-development-runtime-principal-invalid');
  }
  const runtimeEnvironment = process.platform === 'darwin'
    ? MACOS_RUNTIME_EXECUTABLE_ENVIRONMENT
    : WINDOWS_RUNTIME_EXECUTABLE_ENVIRONMENT;
  const desktopEnvironment = process.platform === 'darwin'
    ? MACOS_DESKTOP_EXECUTABLE_ENVIRONMENT
    : WINDOWS_DESKTOP_EXECUTABLE_ENVIRONMENT;
  const runtimeExecutable = requireCurrentUserExecutable(
    process.env[runtimeEnvironment],
    'source-local-development-runtime-executable-invalid',
  );
  const hostExecutable = requireCurrentUserExecutable(
    input.hostExecutable,
    'source-local-development-runtime-host-invalid',
  );
  if (!sameCanonicalPath(process.env[desktopEnvironment], hostExecutable)) {
    throw new Error('source-local-development-runtime-host-invalid');
  }
  const homeDirectory = requireCanonicalDirectory(input.homeDirectory);
  const realmUrl = process.env.NIMI_REALM_URL;
  if (realmUrl !== 'http://127.0.0.1:3002') {
    throw new Error('source-local-development-realm-url-invalid');
  }
  const socketPath = process.platform === 'darwin'
    ? path.join(
      homeDirectory,
      'Library',
      'Application Support',
      'Nimi',
      'RuntimeLocalDevelopment',
      'run',
      DESKTOP_SOCKET_FILENAME,
    )
    : '';
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
      env: runtimeChildEnvironment({
        desktopEnvironment,
        homeDirectory,
        hostExecutable,
        realmUrl,
        runtimeEnvironment,
        runtimeExecutable,
      }),
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: false,
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
    if (process.platform === 'darwin') {
      await waitForOwnerSocket(socketPath, initial);
    } else {
      await waitForInitialProcessStability(initial);
    }
  } catch (error) {
    process.removeListener('exit', terminateOnProcessExit);
    stopped = true;
    initial.kill('SIGKILL');
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

function runtimeChildEnvironment(input: {
  readonly desktopEnvironment: string;
  readonly homeDirectory: string;
  readonly hostExecutable: string;
  readonly realmUrl: string;
  readonly runtimeEnvironment: string;
  readonly runtimeExecutable: string;
}): NodeJS.ProcessEnv {
  if (process.platform === 'darwin') {
    return {
      HOME: input.homeDirectory,
      LANG: process.env.LANG || 'en_US.UTF-8',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: process.env.TMPDIR || '/private/tmp',
      [input.desktopEnvironment]: input.hostExecutable,
      [input.runtimeEnvironment]: input.runtimeExecutable,
      NIMI_REALM_URL: input.realmUrl,
    };
  }
  const systemRoot = requiredWindowsEnvironment('SystemRoot');
  const localAppData = requiredWindowsEnvironment('LOCALAPPDATA');
  return {
    LOCALAPPDATA: localAppData,
    USERPROFILE: input.homeDirectory,
    SystemRoot: systemRoot,
    TEMP: process.env.TEMP || path.join(localAppData, 'Temp'),
    TMP: process.env.TMP || process.env.TEMP || path.join(localAppData, 'Temp'),
    PATH: process.env.PATH || path.join(systemRoot, 'System32'),
    [input.desktopEnvironment]: input.hostExecutable,
    [input.runtimeEnvironment]: input.runtimeExecutable,
    NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT: '1',
    NIMI_REALM_URL: input.realmUrl,
  };
}

function requiredWindowsEnvironment(name: 'LOCALAPPDATA' | 'SystemRoot'): string {
  const value = process.env[name];
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.trim() !== value) {
    throw new Error('source-local-development-runtime-environment-invalid');
  }
  return value;
}

function requireCurrentUserExecutable(value: unknown, reason: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.trim() !== value) {
    throw new Error(reason);
  }
  const canonical = realpathSync(value);
  const metadata = lstatSync(value);
  if (!sameCanonicalPath(canonical, value) || !metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(reason);
  }
  if (process.platform === 'darwin') {
    const uid = process.geteuid?.();
    if (uid === undefined || uid === 0 || metadata.uid !== uid || (metadata.mode & 0o022) !== 0) {
      throw new Error(reason);
    }
  } else if (path.extname(canonical).toLowerCase() !== '.exe') {
    throw new Error(reason);
  }
  return canonical;
}

function requireCanonicalDirectory(value: string): string {
  if (!path.isAbsolute(value) || value.trim() !== value) {
    throw new Error('source-local-development-runtime-home-invalid');
  }
  const canonical = realpathSync(value);
  const metadata = lstatSync(value);
  if (!sameCanonicalPath(canonical, value) || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('source-local-development-runtime-home-invalid');
  }
  return canonical;
}

function sameCanonicalPath(left: unknown, right: string): boolean {
  if (typeof left !== 'string') return false;
  return process.platform === 'win32'
    ? path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
    : left === right;
}

async function waitForInitialProcessStability(child: ChildProcess): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error('source-local-development-runtime-exited-before-ready');
  }
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
