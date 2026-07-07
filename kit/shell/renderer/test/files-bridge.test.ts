import { describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  BridgeError,
  exportShellSaveFile,
  floatingWindowBeginManualDrag,
  floatingWindowClose,
  floatingWindowConstrainToVisibleArea,
  floatingWindowHide,
  floatingWindowMoveManualDrag,
  floatingWindowSetAlwaysOnTop,
  floatingWindowSetBounds,
  floatingWindowSetIgnoreCursorEvents,
  openShellFileDialog,
  revealShellFile,
  writeShellArtifact,
} from '../src/bridge/index.js';
import { TAURI_STANDARD_COMMAND_ALIASES } from '../src/bridge/tauri-api.js';

type RendererFilesTestGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
};

async function withElectronInvoke<T>(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const root = globalThis as RendererFilesTestGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  root.__NIMI_ELECTRON_TEST__ = { invoke, listen: () => () => undefined };
  try {
    return await run();
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
  }
}

describe('renderer file surface bridge', () => {
  it('invokes catalog-derived commands with nested standard payloads', async () => {
    const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
    await withElectronInvoke(async (command, payload) => {
      calls.push({ command, payload });
      if (command === NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open']) {
        return { canceled: false, paths: ['/data/selected.png'] };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']) {
        return { revealed: true, path: '/data/selected.png' };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['export.saveFile']) {
        return { artifactPath: '/exports/report.txt', filename: 'report.txt', byteSize: 6, mimeType: 'text/plain' };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['artifacts.write']) {
        return { path: '/data/artifacts/report.json', byteSize: 11, mimeType: 'application/json' };
      }
      throw new Error(`unexpected command ${command}`);
    }, async () => {
      await expect(openShellFileDialog({
        kind: 'file',
        title: 'Pick',
        filters: [{ name: 'Images', extensions: ['png'] }],
        multiple: false,
      })).resolves.toEqual({ canceled: false, paths: ['/data/selected.png'] });
      await expect(revealShellFile('/data/selected.png')).resolves.toEqual({
        revealed: true,
        path: '/data/selected.png',
      });
      await expect(exportShellSaveFile({
        filename: 'report.txt',
        mimeType: 'text/plain',
        dataBase64: 'cmVwb3J0',
      })).resolves.toEqual({
        artifactPath: '/exports/report.txt',
        filename: 'report.txt',
        byteSize: 6,
        mimeType: 'text/plain',
      });
      await expect(writeShellArtifact({
        relativePath: 'artifacts/report.json',
        mimeType: 'application/json',
        dataBase64: 'eyJvayI6dHJ1ZX0=',
      })).resolves.toEqual({
        path: '/data/artifacts/report.json',
        byteSize: 11,
        mimeType: 'application/json',
      });
    });

    expect(calls.map((call) => call.command)).toEqual([
      NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
      NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
      NIMI_STANDARD_SHELL_COMMANDS['export.saveFile'],
      NIMI_STANDARD_SHELL_COMMANDS['artifacts.write'],
    ]);
    expect(calls[0]?.payload).toEqual({
      payload: {
        kind: 'file',
        title: 'Pick',
        filters: [{ name: 'Images', extensions: ['png'] }],
        multiple: false,
      },
    });
    expect(calls[1]?.payload).toEqual({ payload: { path: '/data/selected.png' } });
    expect(calls[2]?.payload).toEqual({
      payload: { filename: 'report.txt', mimeType: 'text/plain', dataBase64: 'cmVwb3J0' },
    });
    expect(calls[3]?.payload).toEqual({
      payload: { relativePath: 'artifacts/report.json', mimeType: 'application/json', dataBase64: 'eyJvayI6dHJ1ZX0=' },
    });
  });

  it('normalizes structured host errors into BridgeError envelopes', async () => {
    await withElectronInvoke(async () => {
      throw {
        name: 'NimiElectronShellHostError',
        message: 'Electron standard shell capability is unavailable for command: nimi.shell.export.saveFile',
        code: 'capability-unavailable',
        reasonCode: 'electron-standard-capability-unavailable',
        actionHint: 'provide_electron_standard_shell_capability_handler',
        source: 'electron',
        envelope: {
          code: 'capability-unavailable',
          reasonCode: 'electron-standard-capability-unavailable',
          actionHint: 'provide_electron_standard_shell_capability_handler',
          source: 'electron',
        },
      };
    }, async () => {
      const error = await exportShellSaveFile({
        filename: 'report.txt',
        dataBase64: 'cmVwb3J0',
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BridgeError);
      const bridgeError = error as BridgeError;
      expect(bridgeError.command).toBe(NIMI_STANDARD_SHELL_COMMANDS['export.saveFile']);
      expect(bridgeError.code).toBe('capability-unavailable');
      expect(bridgeError.reasonCode).toBe('electron-standard-capability-unavailable');
      expect(bridgeError.envelope).toMatchObject({
        code: 'capability-unavailable',
        source: 'electron',
      });
    });
  });

  it('fails closed on malformed host results instead of synthesizing values', async () => {
    await withElectronInvoke(async () => ({ canceled: false, paths: 'not-an-array' }), async () => {
      await expect(openShellFileDialog({ kind: 'file' })).rejects.toThrow(/paths must be an array/u);
    });
    await withElectronInvoke(async () => ({ revealed: false, path: '/x' }), async () => {
      await expect(revealShellFile('/x')).rejects.toThrow(/revealed must be true/u);
    });
    await withElectronInvoke(async () => ({ path: '/x', byteSize: 'many' }), async () => {
      await expect(writeShellArtifact({ relativePath: 'artifacts/x', dataBase64: 'eA==' })).rejects.toThrow(/byteSize/u);
    });
  });
});

describe('renderer floating-window bridge', () => {
  it('invokes all eight catalog-derived floating-window commands with contract payloads', async () => {
    const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
    let manualDragOrigin: unknown;
    let constrainResult: unknown;
    await withElectronInvoke(async (command, payload) => {
      calls.push({ command, payload });
      if (command === NIMI_STANDARD_SHELL_COMMANDS['floating-window.beginManualDrag']) {
        return { mode: 'manual', originX: 12, originY: 34 };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['floating-window.constrainToVisibleArea']) {
        return { constrained: true };
      }
      return {};
    }, async () => {
      await floatingWindowSetBounds({ x: 1, y: 2, width: 300, height: 400 });
      await floatingWindowSetIgnoreCursorEvents(true, { forward: true });
      await floatingWindowSetAlwaysOnTop(true);
      await floatingWindowHide();
      await floatingWindowClose();
      manualDragOrigin = await floatingWindowBeginManualDrag();
      await floatingWindowMoveManualDrag({ originX: 12, originY: 34, totalDeltaX: 7, totalDeltaY: -8 });
      constrainResult = await floatingWindowConstrainToVisibleArea(0.2);
    });

    expect(calls.map((call) => call.command)).toEqual([
      NIMI_STANDARD_SHELL_COMMANDS['floating-window.setBounds'],
      NIMI_STANDARD_SHELL_COMMANDS['floating-window.setIgnoreCursorEvents'],
      NIMI_STANDARD_SHELL_COMMANDS['floating-window.setAlwaysOnTop'],
      NIMI_STANDARD_SHELL_COMMANDS['floating-window.hide'],
      NIMI_STANDARD_SHELL_COMMANDS['floating-window.close'],
      NIMI_STANDARD_SHELL_COMMANDS['floating-window.beginManualDrag'],
      NIMI_STANDARD_SHELL_COMMANDS['floating-window.moveManualDrag'],
      NIMI_STANDARD_SHELL_COMMANDS['floating-window.constrainToVisibleArea'],
    ]);
    expect(calls[0]?.payload).toEqual({ payload: { x: 1, y: 2, width: 300, height: 400 } });
    expect(calls[1]?.payload).toEqual({ payload: { ignore: true, forward: true } });
    expect(calls[2]?.payload).toEqual({ payload: { alwaysOnTop: true } });
    expect(calls[3]?.payload).toEqual({ payload: {} });
    expect(calls[5]?.payload).toEqual({ payload: {} });
    expect(calls[6]?.payload).toEqual({ payload: { originX: 12, originY: 34, totalDeltaX: 7, totalDeltaY: -8 } });
    expect(calls[7]?.payload).toEqual({ payload: { minVisibleRatio: 0.2 } });
    expect(manualDragOrigin).toEqual({ mode: 'manual', originX: 12, originY: 34 });
    expect(constrainResult).toEqual({ constrained: true });
  });

  it('omits forward from setIgnoreCursorEvents when not provided', async () => {
    const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
    await withElectronInvoke(async (command, payload) => {
      calls.push({ command, payload });
      return {};
    }, async () => {
      await floatingWindowSetIgnoreCursorEvents(false);
    });
    expect(calls[0]?.payload).toEqual({ payload: { ignore: false } });
  });

  it('sends only the provided bounds fields', async () => {
    const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
    await withElectronInvoke(async (command, payload) => {
      calls.push({ command, payload });
      return {};
    }, async () => {
      await floatingWindowSetBounds({ width: 640, height: 480 });
    });
    expect(calls[0]?.payload).toEqual({ payload: { width: 640, height: 480 } });
  });

  it('rejects empty bounds and non-integer fields before invoking the host', async () => {
    let invoked = false;
    await withElectronInvoke(async () => {
      invoked = true;
      return {};
    }, async () => {
      await expect(floatingWindowSetBounds({})).rejects.toThrow(/at least one/u);
      await expect(floatingWindowSetBounds({ x: 1.5 })).rejects.toThrow(/x must be an integer/u);
      await expect(floatingWindowMoveManualDrag({
        originX: 0,
        originY: 0,
        totalDeltaX: 1.2,
        totalDeltaY: 0,
      })).rejects.toThrow(/totalDeltaX must be an integer/u);
      await expect(floatingWindowConstrainToVisibleArea(Number.NaN)).rejects.toThrow(/minVisibleRatio/u);
    });
    expect(invoked).toBe(false);
  });

  it('rejects malformed beginManualDrag and constrain result envelopes', async () => {
    await withElectronInvoke(async (command) => {
      if (command === NIMI_STANDARD_SHELL_COMMANDS['floating-window.beginManualDrag']) {
        return { mode: 'wobble', originX: 1, originY: 2 };
      }
      return { constrained: 'yes' };
    }, async () => {
      await expect(floatingWindowBeginManualDrag()).rejects.toThrow(/mode must be/u);
      await expect(floatingWindowConstrainToVisibleArea(0.2)).rejects.toThrow(/constrained must be a boolean/u);
    });
  });
});

describe('Tauri standard command aliases for file surfaces', () => {
  it('maps the new commands to snake_case Tauri command names', () => {
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open']]).toBe('file_dialog_open');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']]).toBe('file_reveal_reveal');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['export.saveFile']]).toBe('export_save_file');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['artifacts.write']]).toBe('artifacts_write');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['floating-window.setBounds']]).toBe('floating_window_set_bounds');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['floating-window.setIgnoreCursorEvents']]).toBe('floating_window_set_ignore_cursor_events');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['floating-window.setAlwaysOnTop']]).toBe('floating_window_set_always_on_top');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['floating-window.hide']]).toBe('floating_window_hide');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['floating-window.close']]).toBe('floating_window_close');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['floating-window.beginManualDrag']]).toBe('floating_window_begin_manual_drag');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['floating-window.moveManualDrag']]).toBe('floating_window_move_manual_drag');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['floating-window.constrainToVisibleArea']]).toBe('floating_window_constrain_to_visible_area');
  });
});
