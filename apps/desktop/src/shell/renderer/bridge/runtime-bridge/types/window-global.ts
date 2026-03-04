declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: (command: string, payload?: unknown) => Promise<unknown>;
      };
      event?: {
        listen?: (
          eventName: string,
          handler: (event: { event: string; id?: number; payload: unknown }) => void,
        ) => Promise<(() => void) | undefined> | (() => void) | undefined;
        emit?: (eventName: string, payload?: unknown) => Promise<void> | void;
      };
    };
    __NIMI_HTML_BOOT_ID__?: string;
  }
}

export {};
