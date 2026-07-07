import type { NimiElectronStandardShellHost } from './types.js';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { normalizeRequiredToken, resolveElectronStandardLocalAssetPath } from './paths.js';

export async function resolveElectronStandardLocalAssetUrl(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<{ readonly path: string; readonly url: string }> {
  const protocolHost = host?.localAssetProtocolHost;
  if (!protocolHost) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const filePath = await resolveElectronStandardLocalAssetPath(host, payload, command);
  await protocolHost.registerReadableFile(filePath);
  const url = normalizeRequiredToken(protocolHost.resolveLocalAssetUrl(filePath), 'url');
  return { path: filePath, url };
}
