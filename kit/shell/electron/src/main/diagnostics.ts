import type { NimiElectronIpcMainInvokeEvent } from './types.js';
import { normalizeText } from './paths.js';

export function rendererOriginFromUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol === 'file:') return 'file://';
  // Node does not know Electron's registered standard schemes. Match the
  // exact scheme and host that Electron reports, never the opaque "null" origin.
  return parsed.origin === 'null' && parsed.host
    ? `${parsed.protocol}//${parsed.host}`
    : parsed.origin;
}

export function resolveElectronRendererOrigin(event: NimiElectronIpcMainInvokeEvent): string {
  const explicitOrigin = normalizeText(event.senderFrame?.origin);
  if (explicitOrigin) {
    return explicitOrigin;
  }
  const url = normalizeText(event.senderFrame?.url);
  if (!url) {
    return '';
  }
  try {
    return rendererOriginFromUrl(url);
  } catch {
    return '';
  }
}
export function resolveElectronDiagnosticsRendererEntryProbe(input: {
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly appId: string;
}): Record<string, unknown> {
  const stage = normalizeText(input.payload.stage) || 'renderer-entry-probe';
  return {
    ok: true,
    source: 'electron',
    appId: input.appId,
    stage,
    origin: resolveElectronRendererOrigin(input.event),
    url: normalizeText(input.event.senderFrame?.url),
    hasSender: Boolean(input.event.sender),
  };
}
