import { unzipSync } from 'fflate';
import { isJsonObject } from '@nimiplatform/sdk/types';
import type { NimiLocalAppAssetsClient } from '@nimiplatform/sdk/app';

type WorldTourArchiveBase = {
  displayName: string;
  splatBytes: Uint8Array;
  splatCoordinateSystem: 'opencv' | 'spz-rub';
  colliderBytes?: Uint8Array;
  colliderIssue?: string;
  archiveSha256?: string;
};
export type WorldTourArchive = WorldTourArchiveBase & (
  | { calibrationState: 'calibrated'; metricScaleFactor: number; groundPlaneOffset: number }
  | { calibrationState: 'uncalibrated'; metricScaleFactor?: never; groundPlaneOffset?: never }
);

const MAX_WORLD_ARCHIVE_BYTES = 256 * 1024 * 1024;

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
// Both admitted archive shapes become an explicit internal calibration union.
export function parseWorldTourArchive(bytes: Uint8Array): WorldTourArchive {
  if (bytes.length > MAX_WORLD_ARCHIVE_BYTES) throw new Error('world-tour-archive-too-large');
  const files = unzipSync(bytes, { filter: file => {
    if (file.originalSize > MAX_WORLD_ARCHIVE_BYTES) throw new Error('world-tour-archive-too-large');
    return true;
  } });
  const metadata = files['world.json'];
  if (!metadata) throw new Error('world-tour-metadata-missing');
  const value: unknown = JSON.parse(new TextDecoder().decode(metadata));
  if (!isJsonObject(value)
    || (value.splatCoordinateSystem !== 'opencv' && value.splatCoordinateSystem !== 'spz-rub')
    || typeof value.splatPath !== 'string' || !files[value.splatPath]?.byteLength) {
    throw new Error('world-tour-metadata-invalid');
  }
  const uncalibrated = value.calibrationState === 'uncalibrated';
  if (uncalibrated ? value.metricScaleFactor !== undefined || value.groundPlaneOffset !== undefined :
    (value.calibrationState !== undefined && value.calibrationState !== 'calibrated') ||
    typeof value.metricScaleFactor !== 'number' || !Number.isFinite(value.metricScaleFactor) || value.metricScaleFactor <= 0 ||
    typeof value.groundPlaneOffset !== 'number' || !Number.isFinite(value.groundPlaneOffset)) throw new Error('world-tour-metadata-invalid');
  return {
    displayName: typeof value.displayName === 'string' ? value.displayName : '',
    splatBytes: files[value.splatPath]!,
    splatCoordinateSystem: value.splatCoordinateSystem,
    ...(uncalibrated ? { calibrationState: 'uncalibrated' as const } : { calibrationState: 'calibrated' as const, metricScaleFactor: value.metricScaleFactor as number, groundPlaneOffset: value.groundPlaneOffset as number }),
    ...(typeof value.colliderPath === 'string' && files[value.colliderPath]?.byteLength ? { colliderBytes: files[value.colliderPath] } : { colliderIssue: 'missing' }),
  };
}

export async function readWorldTourArchive(relativePath: string, assets: Pick<NimiLocalAppAssetsClient, 'read'>): Promise<WorldTourArchive> {
  const result = await assets.read({ relativePath });
  if (result.asset.sizeBytes > MAX_WORLD_ARCHIVE_BYTES) throw new Error('world-tour-archive-too-large');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of result.body) { length += chunk.byteLength; if (length > MAX_WORLD_ARCHIVE_BYTES) throw new Error('world-tour-archive-too-large'); chunks.push(chunk); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ...parseWorldTourArchive(bytes), archiveSha256: result.asset.sha256 };
}
