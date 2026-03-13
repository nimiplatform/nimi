interface TauriInternals {
  core: {
    invoke<T = unknown>(command: string, payload?: Record<string, unknown>): Promise<T>;
  };
  event: {
    listen<T = unknown>(
      event: string,
      handler: (event: { payload: T }) => void,
    ): Promise<() => void>;
  };
}

interface Window {
  __TAURI__?: TauriInternals;
}
