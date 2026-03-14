const DEFAULT_DESKTOP_VERSION = '0.1.0';

export const DESKTOP_VERSION_FALLBACK = String(
  (import.meta as { env?: Record<string, string> }).env?.VITE_NIMI_DESKTOP_VERSION || '',
).trim() || DEFAULT_DESKTOP_VERSION;
