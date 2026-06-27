import type { NimiElectronStandardShellHost } from './types.js';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { normalizeRequiredToken, resolveElectronStandardLocalAssetPath } from './paths.js';

export async function resolveElectronStandardLocalAssetUrl(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<{ readonly path: string; readonly url: string }> {
  const resolver = host?.resolveLocalAssetUrl;
  if (!resolver) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const filePath = await resolveElectronStandardLocalAssetPath(host, payload, command);
  const url = normalizeRequiredToken(await resolver(filePath), 'url');
  return { path: filePath, url };
}
