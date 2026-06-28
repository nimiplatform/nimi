import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import {
  createElectronRuntimeBridgeCommandNames,
  type NimiElectronIpcMain,
} from '../src/main/index.js';

export class FakeIpcMain implements NimiElectronIpcMain {
  readonly handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown> | unknown>();

  handle(channel: string, listener: (event: unknown, payload: unknown) => Promise<unknown> | unknown): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  invoke(channel: string, event: unknown, payload: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`missing handler: ${channel}`);
    }
    return Promise.resolve(handler(event, payload));
  }
}

export function createInvokeEvent(origin = 'http://localhost:1430') {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  return {
    event: {
      senderFrame: { origin },
      sender: {
        send: (channel: string, payload: unknown) => {
          sent.push({ channel, payload });
        },
      },
    },
    sent,
  };
}

export function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

export async function withTempDir<T>(prefix: string, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-electron-shell-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function withEnvVars<T>(
  vars: Readonly<Record<string, string | undefined>>,
  run: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (address && typeof address === 'object') {
          resolve(address.port);
          return;
        }
        reject(new Error('missing free port address'));
      });
    });
  });
}

export async function fetchOkText(url: string): Promise<string> {
  const deadline = Date.now() + 2_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.text();
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'fetch failed'));
}

export async function invokeBridge(ipcMain: FakeIpcMain, event: unknown, message: unknown): Promise<unknown> {
  return unwrapBridgeResponse(await ipcMain.invoke('nimi:runtime:invoke', event, message));
}

function unwrapBridgeResponse(response: unknown): unknown {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('test bridge response must be an object');
  }
  const record = response as Record<string, unknown>;
  if (record.ok === true) {
    return record.value;
  }
  if (record.ok === false) {
    const errorRecord = record.error as Record<string, unknown>;
    const error = new Error(String(errorRecord?.message ?? 'bridge error')) as Error & Record<string, unknown>;
    Object.assign(error, errorRecord);
    throw error;
  }
  throw new Error('test bridge response missing ok discriminator');
}

export const STANDARD_COMMANDS = createElectronRuntimeBridgeCommandNames();
export const STANDARD_EVENT_NAMESPACE = 'nimi.shell.runtime';
