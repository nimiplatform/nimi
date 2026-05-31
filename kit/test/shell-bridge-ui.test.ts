import { afterEach, describe, expect, test, vi } from 'vitest';
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

  test('openExternalUrl falls back to browser window outside Tauri', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(window);

    await expect(openExternalUrl('/docs')).resolves.toEqual({ opened: true });

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/localhost:3000\/docs$/),
      '_blank',
      'noopener,noreferrer',
    );
  });

  test('Tauri UI commands invoke shared shell bridge commands', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    testGlobal().__NIMI_TAURI_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        if (command === 'open_external_url') return { opened: true };
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
      'open_external_url',
      'confirm_dialog',
      'start_window_drag',
      'focus_main_window',
    ]);
  });
});
