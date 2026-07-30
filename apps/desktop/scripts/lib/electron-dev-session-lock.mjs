import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';

function sessionFingerprint(profileRoot, platform) {
  const normalized = platform === 'win32'
    ? path.resolve(profileRoot).toLowerCase()
    : path.resolve(profileRoot);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function createSessionError(message, reasonCode, actionHint) {
  const error = new Error(`[desktop-dev-session] ${message}`);
  error.reasonCode = reasonCode;
  error.actionHint = actionHint;
  return error;
}

export function resolveDesktopDevSessionEndpoint(profileRoot, platform = process.platform) {
  if (platform !== 'win32') {
    throw createSessionError(
      `Desktop Electron dev session lock is not implemented for ${platform}`,
      'desktop-dev-session-platform-unsupported',
      'run_the_supported_windows_desktop_dev_lane',
    );
  }
  return {
    kind: 'pipe',
    path: `\\\\.\\pipe\\nimi-desktop-dev-${sessionFingerprint(profileRoot, platform)}`,
  };
}

function listen(server, endpoint) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint.path);
  });
}

export async function acquireDesktopDevSessionLock(profileRoot, options = {}) {
  const endpoint = resolveDesktopDevSessionEndpoint(profileRoot, options.platform);
  const owner = {
    pid: process.pid,
    createdAt: new Date().toISOString(),
    profileRoot: path.resolve(profileRoot),
  };
  const server = net.createServer((socket) => {
    socket.end(`${JSON.stringify(owner)}\n`);
  });

  try {
    await listen(server, endpoint);
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      throw createSessionError(
        'another Desktop Electron dev session is active for this profile',
        'desktop-dev-session-active',
        'stop_the_existing_desktop_dev_session',
      );
    }
    throw error;
  }

  server.unref();
  let released = false;
  return {
    endpoint,
    async release() {
      if (released) {
        return;
      }
      released = true;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
