import type { RuntimeTransportConfig } from './runtime/types.js';

export function detectTauriTransport(): RuntimeTransportConfig | null {
  const globalRecord = globalThis as {
    __NIMI_TAURI_TEST__?: unknown;
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
    window?: {
      __NIMI_TAURI_TEST__?: unknown;
      __TAURI__?: unknown;
      __TAURI_INTERNALS__?: unknown;
      __TAURI_IPC__?: unknown;
    };
  };
  const tauriRuntime = (
    globalRecord.__NIMI_TAURI_TEST__
    || globalRecord.__TAURI_INTERNALS__
    || globalRecord.__TAURI_IPC__
    || globalRecord.__TAURI__
    || globalRecord.window?.__NIMI_TAURI_TEST__
    || globalRecord.window?.__TAURI_INTERNALS__
    || globalRecord.window?.__TAURI_IPC__
    || globalRecord.window?.__TAURI__
  );
  if (!tauriRuntime) {
    return null;
  }
  return {
    type: 'tauri-ipc',
    commandNamespace: 'runtime_bridge',
    eventNamespace: 'runtime_bridge',
  };
}
