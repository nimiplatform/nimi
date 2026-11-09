import type { NimiLocalAppAssetsClient } from '@nimiplatform/sdk/app';
import { readNimiAppAssetBlob as readLabWebAssetBlob } from '@nimiplatform/kit/core/app-asset-media';

// A browser request is not confirmation that the user saved a file to disk.
// @nimi-authority: rule.nimi.platform.app-ecosystem.lab-web-carrier
export function requestLabWebDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  try {
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Let the click's navigation task consume the URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return { destination: 'browser-download' as const, filename, byteSize: blob.size };
}

export async function downloadLabWebAsset(assets: Pick<NimiLocalAppAssetsClient, 'read'>, relativePath: string) {
  const blob = await readLabWebAssetBlob(assets, relativePath);
  return requestLabWebDownload(relativePath.split('/').at(-1)!, blob);
}
