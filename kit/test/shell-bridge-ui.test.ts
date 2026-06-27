import { afterEach, describe, expect, test, vi } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  confirmDialog,
  focusMainWindow,
  normalizeShellExternalUrl,
  openExternalUrl,
  startWindowDrag,
} from '../shell/renderer/src/bridge/index.js';

type TestGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
  };
};

function testGlobal(): TestGlobal {
  return globalThis as TestGlobal;
}

afterEach(() => {
  delete testGlobal().__NIMI_TAURI_TEST__;
  vi.restoreAllMocks();
});

describe('shell renderer UI bridge primitives', () => {
  test('normalizes browser-safe external URLs and rejects unsupported schemes', () => {
    expect(normalizeShellExternalUrl('https://nimi.ai/path')).toBe('https://nimi.ai/path');
    expect(() => normalizeShellExternalUrl('file:///tmp/nope')).toThrow(/Only http\/https/);
    expect(() => normalizeShellExternalUrl('')).toThrow(/URL is required/);
  });

  test('openExternalUrl fails closed outside a standard shell host', async () => {
    await expect(openExternalUrl('/docs')).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'renderer-standard-shell-host-unavailable',
    });
  });

  test('Tauri UI commands invoke shared shell bridge commands', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    testGlobal().__NIMI_TAURI_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl']) return { opened: true };
        if (command === 'confirm_dialog') return { confirmed: true };
        return {};
      },
    };

    await expect(openExternalUrl('https://nimi.ai')).resolves.toEqual({ opened: true });
    await expect(confirmDialog({ title: 'Delete', description: 'Confirm?' })).resolves.toEqual({
      confirmed: true,
    });
    await expect(startWindowDrag()).resolves.toBeUndefined();
    await expect(focusMainWindow()).resolves.toBeUndefined();

    expect(calls.map((call) => call.command)).toEqual([
      NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl'],
      'confirm_dialog',
      'start_window_drag',
      'focus_main_window',
    ]);
  });
});
