import { installNimiShellRuntimeBridge as installInjectedBridge } from './runtime-bridge.js';
// Explicit adapter for Apps using the independent Tauri toolchain.
import { convertFileSrc as tauriConvertFileSrc, invoke as tauriCoreInvoke, isTauri, type InvokeArgs } from '@tauri-apps/api/core';
import { listen as tauriEventListen } from '@tauri-apps/api/event';
import {
  resolveTauriInvokeCommand,
  resolveTauriInvokePayload,
  resolveTauriInvokeResult,
  type NimiShellRuntimeBridgeResult,
  type NimiShellRuntimeHook,
  type ShellEventUnsubscribe,
  type TauriRuntimeGlobal,
} from '../bridge/tauri-api.js';

function shellGlobal(): TauriRuntimeGlobal {
  return globalThis as TauriRuntimeGlobal;
}

function hasNativeTauriRuntime(): boolean {
  const value = shellGlobal();
  const windowRecord = value.window && typeof value.window === 'object'
    ? value.window as unknown as Record<string, unknown>
    : undefined;
  const globalRecord = value as Record<string, unknown>;
  return (
    isTauri()
    || hasNativeTauriInvoke(windowRecord?.__TAURI_INTERNALS__)
    || hasNativeTauriInvoke(globalRecord.__TAURI_INTERNALS__)
  );
}

function hasNativeTauriInvoke(candidate: unknown): boolean {
  return Boolean(
    candidate
    && typeof candidate === 'object'
    && typeof (candidate as { invoke?: unknown }).invoke === 'function',
  );
}

function createNimiShellRuntimeHook(): NimiShellRuntimeHook {
  return {
    invoke: async (command, payload) => {
      const tauriCommand = resolveTauriInvokeCommand(command);
      return resolveTauriInvokeResult(tauriCommand, await tauriCoreInvoke(
        tauriCommand,
        resolveTauriInvokePayload(tauriCommand, payload) as InvokeArgs | undefined,
      ));
    },
    listen: async (eventName, handler): Promise<ShellEventUnsubscribe> => {
      const unsubscribe = await tauriEventListen(eventName, (event) => handler(event));
      return unsubscribe;
    },
    convertFileSrc: (fileUrl) => tauriConvertFileSrc(fileUrl),
  };
}

export function installNimiShellRuntimeBridge(): NimiShellRuntimeBridgeResult {
  const injected = installInjectedBridge();
  if (injected.installed || !hasNativeTauriRuntime()) return injected;
  const value = shellGlobal();
  const hook = createNimiShellRuntimeHook();
  value.__NIMI_TAURI_RUNTIME__ = hook;
  if (value.window && typeof value.window === 'object') {
    value.window.__NIMI_TAURI_RUNTIME__ = hook;
  }
  return { installed: true, host: 'tauri' };
}
