import { invoke as tauriCoreInvoke, isTauri, type InvokeArgs } from '@tauri-apps/api/core';
import { listen as tauriEventListen } from '@tauri-apps/api/event';

type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriEventUnsubscribe = () => void;
type TauriEventListen = (
  eventName: string,
  handler: (event: { event?: string; id?: number; payload: unknown }) => void,
) => Promise<TauriEventUnsubscribe>;
type TauriTestHook = {
  invoke?: TauriInvoke;
  listen?: (
    eventName: string,
    handler: (event: { event?: string; id?: number; payload: unknown }) => void,
  ) => Promise<TauriEventUnsubscribe | undefined> | TauriEventUnsubscribe | undefined;
};
type NimiShellRuntimeHook = {
  invoke: TauriInvoke;
  listen: TauriEventListen;
};

type TauriRuntimeGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: TauriTestHook;
  __NIMI_TAURI_RUNTIME__?: NimiShellRuntimeHook;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  window?: {
    __NIMI_TAURI_TEST__?: TauriTestHook;
    __NIMI_TAURI_RUNTIME__?: NimiShellRuntimeHook;
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
  };
};

/** Result of {@link installNimiShellRuntimeBridge}. Typed instead of a bare
 *  boolean so callers and guards can branch on the precise outcome and the
 *  non-Tauri case is an explicit skip, never a thrown pseudo-error. */
export type NimiShellRuntimeBridgeResult =
  | { installed: true }
  | { installed: false; reason: 'non-tauri-environment' };

function tauriGlobal(): TauriRuntimeGlobal {
  return globalThis as TauriRuntimeGlobal;
}

function testHook(): TauriTestHook | undefined {
  const value = tauriGlobal();
  return value.__NIMI_TAURI_TEST__ || value.window?.__NIMI_TAURI_TEST__;
}

function testInvoke(): TauriInvoke | undefined {
  return testHook()?.invoke;
}

export function hasTauriRuntime(): boolean {
  const value = tauriGlobal();
  return Boolean(
    testInvoke()
      || testHook()?.listen
      || isTauri()
      || value.__TAURI_INTERNALS__
      || value.__TAURI_IPC__
      || value.window?.__TAURI_INTERNALS__
      || value.window?.__TAURI_IPC__,
  );
}

export async function invokeTauri<T>(command: string, payload: unknown = {}): Promise<T> {
  const invoke = testInvoke();
  if (invoke) {
    return await invoke(command, payload) as T;
  }
  return await tauriCoreInvoke<T>(command, payload as InvokeArgs | undefined);
}

// The single authoritative runtime-transport hook for every Nimi Tauri app.
// invoke prefers the test hook (deterministic tests), else the Tauri core API;
// listen prefers the test hook, else the Tauri event API, and normalizes the
// result to a guaranteed unsubscribe — a test hook that fails to return one is a
// contract violation, not a silently-swallowed stream.
function createNimiShellRuntimeHook(): NimiShellRuntimeHook {
  return {
    invoke: async (command, payload) => {
      const invoke = testInvoke();
      if (invoke) {
        return await invoke(command, payload);
      }
      return await tauriCoreInvoke(command, payload as InvokeArgs | undefined);
    },
    listen: async (eventName, handler) => {
      const listen = testHook()?.listen;
      if (listen) {
        const unsubscribe = await Promise.resolve(listen(eventName, handler));
        if (typeof unsubscribe !== 'function') {
          throw new Error(`Tauri event listener for "${eventName}" did not return an unsubscribe function`);
        }
        return unsubscribe;
      }
      return await tauriEventListen(eventName, (event) => handler(event));
    },
  };
}

/**
 * Install the scoped Nimi shell runtime-transport bridge
 * (`globalThis/window.__NIMI_TAURI_RUNTIME__ = { invoke, listen }`) that the
 * `@nimiplatform/sdk` tauri-ipc transport resolves for unary `invoke` and
 * streaming event `listen`.
 *
 * This is the single platform bootstrap owner for the renderer runtime
 * transport: Desktop, the tester, and every scaffolded Nimi Tauri app must call
 * this rather than installing their own hook. Unary invoke resolves via the
 * always-present Tauri core, but event `listen` only reaches the SDK through
 * this hook (or `withGlobalTauri`), so without it `openStream` paths
 * (`chat.stream`, media jobs) fail closed with `SDK_RUNTIME_TAURI_LISTEN_MISSING`.
 *
 * `withGlobalTauri` stays false: only `invoke` + event `listen` are exposed to
 * the renderer, never the entire Tauri API. Outside a Tauri webview this is a
 * typed no-op (`{ installed: false, reason: 'non-tauri-environment' }`) — never a
 * thrown error.
 */
export function installNimiShellRuntimeBridge(): NimiShellRuntimeBridgeResult {
  if (!hasTauriRuntime()) {
    return { installed: false, reason: 'non-tauri-environment' };
  }
  const value = tauriGlobal();
  const hook = createNimiShellRuntimeHook();
  value.__NIMI_TAURI_RUNTIME__ = hook;
  if (value.window && typeof value.window === 'object') {
    value.window.__NIMI_TAURI_RUNTIME__ = hook;
  }
  return { installed: true };
}
