import { buildNimiPlatformProjection } from '@nimiplatform/kit/shell/capabilities';
import { NimiElectronShellHostError } from './types.js';
import { errorMessage } from './errors.js';
import { normalizeText } from './paths.js';

export function resolveElectronPlatformProjection(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Record<string, unknown> {
  const projectionId = normalizeText(payload.projectionId);
  try {
    return buildNimiPlatformProjection({ projectionId }) as unknown as Record<string, unknown>;
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes('unsupported platform projection')) {
      throw new NimiElectronShellHostError({
        code: 'not-found',
        message: `Electron platform projection was not found: ${projectionId || '<missing>'}`,
        reasonCode: 'electron-platform-projection-not-found',
        actionHint: 'use_admitted_standard_platform_projection_id',
        details: { command, projectionId },
      });
    }
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron platform projection failed: ${message}`,
      reasonCode: 'electron-platform-projection-failed',
      actionHint: 'check_platform_projection_catalog',
      details: { command, projectionId, cause: message },
    });
  }
}
