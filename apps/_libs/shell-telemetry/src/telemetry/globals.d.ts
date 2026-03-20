import type { JsonObject } from './types.js';

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: (command: string, payload?: unknown) => Promise<unknown>;
      };
    };
    __NIMI_HTML_BOOT_ID__?: string;
    __NIMI_RENDERER_ENV__?: Record<string, string>;
    __NIMI_RENDERER_DEBUG_LOGS__?: JsonObject[];
    __NIMI_RENDERER_DEBUG_LOGS_LATEST__?: JsonObject;
  }
}
