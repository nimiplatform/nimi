/// <reference types="vite/client" />

declare module '*.json' {
  const value: Record<string, unknown>;
  export default value;
}

// Tauri v2 global — used by nimi-kit/telemetry for environment detection
declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: (command: string, payload?: unknown) => Promise<unknown>;
      };
    };
    __NIMI_HTML_BOOT_ID__?: string;
    __NIMI_RENDERER_ENV__?: Record<string, string>;
    __NIMI_RENDERER_DEBUG_LOGS__?: unknown[];
    __NIMI_RENDERER_DEBUG_LOGS_LATEST__?: unknown;
  }
}
