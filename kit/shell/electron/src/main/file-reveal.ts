import path from 'node:path';
import { createElectronCapabilityUnavailableError } from './errors.js';
import {
  canonicalElectronPathCandidate,
  canonicalElectronStandardRoot,
  fileExists,
  isSameOrChildPath,
  normalizeRequiredToken,
} from './paths.js';
import { NimiElectronShellHostError } from './types.js';
import type { NimiElectronStandardShellHost } from './types.js';
import { resolveElectronStandardDataRoot } from './data-root-binding.js';

export async function revealElectronShellFile(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<{ readonly revealed: true; readonly path: string }> {
  const revealInOs = host?.revealInOs;
  if (!revealInOs) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const rawPath = path.resolve(normalizeRequiredToken(payload.path, 'path'));
  const canonical = await canonicalElectronPathCandidate(rawPath);
  if (!await isElectronShellRevealablePath(host, canonical, command)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-path',
      message: `Electron file reveal path is outside admitted roots and the readable-file registry: ${canonical}`,
      reasonCode: 'electron-file-reveal-path-not-admitted',
      actionHint: 'reveal_only_paths_inside_admitted_shell_roots_or_readable_registry',
      details: { command, path: canonical },
    });
  }
  if (!await fileExists(canonical)) {
    throw new NimiElectronShellHostError({
      code: 'not-found',
      message: `Electron file reveal target was not found: ${canonical}`,
      reasonCode: 'electron-file-reveal-target-not-found',
      actionHint: 'materialize_file_before_revealing_it',
      details: { command, path: canonical },
    });
  }
  await revealInOs(canonical);
  return { revealed: true, path: canonical };
}

async function isElectronShellRevealablePath(
  host: NimiElectronStandardShellHost | undefined,
  canonical: string,
  command: string,
): Promise<boolean> {
  if (await host?.localAssetProtocolHost?.hasReadableFile(canonical)) {
    return true;
  }
  const roots: string[] = [];
  if (host?.standardDataRootBinding) {
    const dataRoot = await resolveElectronStandardDataRoot(host, command);
    roots.push(await canonicalElectronStandardRoot(dataRoot, command, 'standardDataRootBinding'));
  }
  for (const assetRoot of host?.localAssetRoots ?? []) {
    roots.push(await canonicalElectronStandardRoot(assetRoot, command, 'localAssetRoots'));
  }
  return roots.some((root) => isSameOrChildPath(root, canonical));
}
