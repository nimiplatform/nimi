import {
  parseNimiDesktopOpenRendererRequest,
  parseNimiDesktopOpenResult,
  type NimiDesktopOpenRendererRequest,
  type NimiDesktopOpenResult,
} from '@nimiplatform/kit/core/desktop-open';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { invokeChecked } from './invoke.js';
import type { JsonObject } from './types.js';

export async function openDesktopIntent(request: unknown): Promise<NimiDesktopOpenResult> {
  const payload = parseNimiDesktopOpenRendererRequest(request);
  return invokeChecked(
    NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
    { payload: payload as unknown as JsonObject },
    parseNimiDesktopOpenResult,
  );
}

export type { NimiDesktopOpenRendererRequest, NimiDesktopOpenResult };
