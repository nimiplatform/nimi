import { chmod, copyFile, lstat, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { hashProductFile } from '../../../../scripts/lib/product-update-manifest.mjs';
import { runReleaseCommand, verifySignedMacOSCode } from './macos-release-process.mjs';

export const MACOS_SDCPP_VIDEO_LIBRARY = 'libstable-diffusion.dylib';
export const MACOS_SDCPP_VIDEO_LICENSES = ['stable-diffusion.cpp.txt', 'ggml.txt'];
const signingIdentifier = 'ai.nimi.runtime.sdcpp-video';

// @nimi-authority: rule.nimi.runtime.local-compute.r067
export async function prepareMacOSSDCPPVideoLibrary({ registryPath, directory, release }) {
  const registry = parse(await readFile(registryPath, 'utf8'));
  const candidates = registry.entries.filter((entry) =>
    entry.entry_id === 'macos-apple-silicon-stablediffusion-ggml-official-sdcpp'
      && entry.product_state === 'supported'
      && entry.package_format === 'direct_archive'
      && entry.host_match?.os === 'darwin'
      && entry.host_match?.arch === 'arm64'
      && entry.supported_model_families?.includes('hyperflow-h3-flash'));
  if (candidates.length !== 1) throw new Error('Expected one canonical Apple Silicon HyperFlow archive');
  const [source] = candidates;
  const url = new URL(source.archive_url);
  if (url.origin !== 'https://github.com' || !/^[a-f0-9]{64}$/u.test(source.archive_sha256)) {
    throw new Error('Apple Silicon HyperFlow archive is missing its pinned source identity');
  }

  await mkdir(directory);
  const archive = path.join(directory, 'sdcpp.zip');
  runReleaseCommand('/usr/bin/curl', [
    '--fail', '--location', '--silent', '--show-error', '--proto', '=https', '--proto-redir', '=https',
    '--retry', '3', '--max-time', '180', '--output', archive, url.href,
  ]);
  if (await hashProductFile(archive) !== source.archive_sha256) {
    throw new Error('Apple Silicon HyperFlow archive SHA-256 mismatch');
  }

  const extracted = path.join(directory, 'upstream');
  await mkdir(extracted);
  runReleaseCommand('/usr/bin/unzip', [
    '-q', archive, MACOS_SDCPP_VIDEO_LIBRARY, ...MACOS_SDCPP_VIDEO_LICENSES, '-d', extracted,
  ]);
  for (const name of [MACOS_SDCPP_VIDEO_LIBRARY, ...MACOS_SDCPP_VIDEO_LICENSES]) {
    if (!(await lstat(path.join(extracted, name))).isFile()) {
      throw new Error(`Apple Silicon HyperFlow archive member is not a regular file: ${name}`);
    }
  }
  const upstreamLibrary = path.join(extracted, MACOS_SDCPP_VIDEO_LIBRARY);
  const library = path.join(directory, MACOS_SDCPP_VIDEO_LIBRARY);
  const architectures = runReleaseCommand('/usr/bin/lipo', ['-archs', upstreamLibrary]).stdout.trim();
  if (architectures === 'arm64') {
    await copyFile(upstreamLibrary, library);
  } else {
    runReleaseCommand('/usr/bin/lipo', ['-thin', 'arm64', upstreamLibrary, '-output', library]);
  }
  await chmod(library, 0o755);
  runReleaseCommand('/usr/bin/codesign', [
    '--force', '--sign', release.applicationIdentity, '--timestamp', '--options', 'runtime',
    '--identifier', signingIdentifier, library,
  ]);
  verifySignedMacOSCode(library, signingIdentifier, release.teamId);
  return {
    archiveSHA256: source.archive_sha256,
    librarySHA256: await hashProductFile(library),
    library,
    licenseDirectory: extracted,
  };
}

export async function verifyBundledMacOSSDCPPVideoLibrary(library, identity, teamId) {
  verifySignedMacOSCode(library, signingIdentifier, teamId);
  if (await hashProductFile(library) !== identity.librarySHA256) {
    throw new Error('Bundled HyperFlow dylib changed after the Runtime build');
  }
}
