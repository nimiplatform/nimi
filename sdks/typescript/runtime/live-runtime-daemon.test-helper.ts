import { spawn, spawnSync } from 'node:child_process';

function daemonHasExited(daemon: ReturnType<typeof spawn>): boolean {
  return daemon.exitCode !== null || daemon.signalCode !== null;
}

function daemonExitError(
  code: number | null,
  signal: NodeJS.Signals | null,
): Error {
  return new Error(
    `runtime daemon exited before ready: code=${String(code)} signal=${String(signal)}`,
  );
}

function waitForDaemonExit(daemon: ReturnType<typeof spawn>): Promise<'exit' | 'error'> {
  if (daemonHasExited(daemon)) {
    return Promise.resolve('exit');
  }
  return new Promise((resolvePromise) => {
    const onExit = () => {
      daemon.off('error', onError);
      resolvePromise('exit');
    };
    const onError = () => {
      daemon.off('exit', onExit);
      resolvePromise('error');
    };
    daemon.once('exit', onExit);
    daemon.once('error', onError);
  });
}

export async function waitForRuntimeDaemonReadyOrExit(
  daemon: ReturnType<typeof spawn>,
  ready: Promise<void>,
): Promise<void> {
  if (daemonHasExited(daemon)) {
    throw daemonExitError(daemon.exitCode, daemon.signalCode);
  }

  await new Promise<void>((resolvePromise, reject) => {
    const cleanup = () => {
      daemon.off('exit', onExit);
      daemon.off('error', onError);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(daemonExitError(code, signal));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new Error(`runtime daemon failed before ready: ${error.message}`));
    };

    daemon.once('exit', onExit);
    daemon.once('error', onError);
    if (daemonHasExited(daemon)) {
      onExit(daemon.exitCode, daemon.signalCode);
      return;
    }

    void ready.then(
      () => {
        cleanup();
        resolvePromise();
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export async function terminateRuntimeDaemon(daemon: ReturnType<typeof spawn>): Promise<void> {
  if (daemonHasExited(daemon)) {
    return;
  }

  const exited = waitForDaemonExit(daemon);
  if (process.platform === 'win32' && daemon.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(daemon.pid), '/T', '/F'], { stdio: 'ignore' });
    if (daemonHasExited(daemon)) {
      return;
    }
    await Promise.race([
      exited,
      new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), 8_000)),
    ]);
    return;
  }

  const killGroup = (signal: NodeJS.Signals) => {
    if (daemon.pid === undefined) return;
    try {
      process.kill(-daemon.pid, signal);
    } catch {
      // The process group may already be gone.
    }
    try {
      process.kill(daemon.pid, signal);
    } catch {
      // The process may already be gone.
    }
  };

  killGroup('SIGTERM');
  const settled = await Promise.race([
    exited,
    new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), 8_000)),
  ]);
  if (settled === 'timeout') {
    killGroup('SIGKILL');
  }
}
