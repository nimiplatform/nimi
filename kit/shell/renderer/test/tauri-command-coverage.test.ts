import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  BridgeError,
  installNimiShellRuntimeBridge,
  invoke,
  invokeTauri,
} from '../src/bridge/index.js';
import { TAURI_STANDARD_COMMAND_ALIASES } from '../src/bridge/tauri-api.js';

type TauriInternals = {
  invoke: (command: string, payload?: unknown) => Promise<unknown>;
  transformCallback: () => number;
  unregisterCallback: () => void;
  convertFileSrc: (fileUrl: string) => string;
};

type TauriCoverageGlobal = typeof globalThis & {
  __NIMI_TAURI_RUNTIME__?: unknown;
  window?: { __TAURI_INTERNALS__?: TauriInternals; __NIMI_TAURI_RUNTIME__?: unknown };
};

const testGlobal = globalThis as TauriCoverageGlobal;

function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (current !== dirname(current)) {
    if (existsSync(resolve(current, 'kit/shell/tauri/src/command_registration.rs'))) {
      return current;
    }
    current = dirname(current);
  }
  throw new Error('Unable to locate the repository root for the Tauri command registration');
}

const REGISTERED_TAURI_COMMANDS = new Set(
  [...readFileSync(resolve(findRepoRoot(), 'kit/shell/tauri/src/command_registration.rs'), 'utf8')
    .matchAll(/command_name: "([a-z0-9_]+)"/gu)].map((match) => match[1]),
);

const STANDARD_COMMANDS_WITHOUT_TAURI = Object.values(NIMI_STANDARD_SHELL_COMMANDS)
  .filter((command) => !TAURI_STANDARD_COMMAND_ALIASES[command]);

function installNativeTauri(): Array<{ command: string; payload: unknown }> {
  const calls: Array<{ command: string; payload: unknown }> = [];
  testGlobal.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return { command };
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      convertFileSrc: (fileUrl) => `asset://local/${fileUrl}`,
    },
  };
  expect(installNimiShellRuntimeBridge()).toEqual({ installed: true, host: 'tauri' });
  return calls;
}

afterEach(() => {
  delete testGlobal.__NIMI_TAURI_RUNTIME__;
  delete testGlobal.window;
});

describe('Tauri standard shell coverage', () => {
  it('aliases standard operations only to commands the shared Tauri crate registers', () => {
    expect(REGISTERED_TAURI_COMMANDS.size).toBeGreaterThan(0);
    for (const [standardCommand, tauriCommand] of Object.entries(TAURI_STANDARD_COMMAND_ALIASES)) {
      expect(REGISTERED_TAURI_COMMANDS.has(tauriCommand), `${standardCommand} -> ${tauriCommand}`).toBe(true);
    }
  });

  it('fails standard operations the Tauri crate does not carry as capability-unavailable without invoking Tauri', async () => {
    const calls = installNativeTauri();
    for (const operation of [
      'local-app.conversationOpen',
      'local-app.agentWorkStart',
      'local-app.integrationInvoke',
      'local-app.scenarioJobSubmit',
      'local-app.textTurnStream',
      'local-app.aiRealtimeOpen',
      'storage.assetMediaOpen',
      'avatar.hostHandoff',
      'agent-center.resourcePackImport',
      'artifacts.readRuntimeBytes',
      'config.get',
    ] as const) {
      expect(STANDARD_COMMANDS_WITHOUT_TAURI).toContain(NIMI_STANDARD_SHELL_COMMANDS[operation]);
    }
    for (const command of STANDARD_COMMANDS_WITHOUT_TAURI) {
      await expect(invokeTauri(command, { payload: {} })).rejects.toMatchObject({
        envelope: {
          code: 'capability-unavailable',
          reasonCode: 'tauri-standard-shell-operation-unsupported',
          actionHint: 'use_electron_standard_shell_host',
          source: 'tauri',
          details: { command },
        },
      });
    }
    expect(calls).toEqual([]);

    const conversationOpen = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationOpen'];
    const failure = await invoke(conversationOpen, { payload: {} }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BridgeError);
    expect(failure).toMatchObject({
      command: conversationOpen,
      code: 'capability-unavailable',
      reasonCode: 'tauri-standard-shell-operation-unsupported',
      source: 'tauri',
    });
    expect(calls).toEqual([]);
  });

  it('keeps carried standard, App-owned and native Tauri commands on their existing path', async () => {
    const calls = installNativeTauri();
    await invokeTauri(NIMI_STANDARD_SHELL_COMMANDS['local-app.textGenerateCandidate'], { payload: { messages: [] } });
    await invokeTauri(NIMI_STANDARD_SHELL_COMMANDS['storage.assetStat'], { payload: { relativePath: 'a.bin' } });
    await invokeTauri('acme_widget_export_report', { ok: true });
    await invokeTauri('runtime_account_session_status', {});
    await invokeTauri('log_renderer_event', { level: 'info' });
    expect(calls.map((call) => call.command)).toEqual([
      'local_app_text_generate_candidate',
      'local_app_asset_stat',
      'acme_widget_export_report',
      'runtime_account_session_status',
      'log_renderer_event',
    ]);
  });
});
