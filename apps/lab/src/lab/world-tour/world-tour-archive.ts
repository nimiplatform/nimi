import { unzipSync } from 'fflate';
import { isJsonObject } from '@nimiplatform/sdk/types';
import { getLabLocalAppClient } from '../../shell/local-app-runtime-platform.js';

export type WorldTourArchive = {
  displayName: string;
  splatBytes: Uint8Array;
  metricScaleFactor: number;
  groundPlaneOffset: number;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
export function parseWorldTourArchive(bytes: Uint8Array): WorldTourArchive {
  const files = unzipSync(bytes);
  const metadata = files['world.json'];
  if (!metadata) throw new Error('world-tour-metadata-missing');
  const value: unknown = JSON.parse(new TextDecoder().decode(metadata));
  if (!isJsonObject(value)
    || value.splatCoordinateSystem !== 'opencv'
    || typeof value.metricScaleFactor !== 'number' || !Number.isFinite(value.metricScaleFactor) || value.metricScaleFactor <= 0
    || typeof value.groundPlaneOffset !== 'number' || !Number.isFinite(value.groundPlaneOffset)
    || typeof value.splatPath !== 'string' || !files[value.splatPath]?.byteLength) {
    throw new Error('world-tour-metadata-invalid');
  }
  return {
    displayName: typeof value.displayName === 'string' ? value.displayName : '',
    splatBytes: files[value.splatPath]!,
    metricScaleFactor: value.metricScaleFactor,
    groundPlaneOffset: value.groundPlaneOffset,
  };
}

export async function readWorldTourArchive(relativePath: string): Promise<WorldTourArchive> {
  const result = await getLabLocalAppClient().storage.assets.read({ relativePath });
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of result.body) { chunks.push(chunk); length += chunk.byteLength; }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return parseWorldTourArchive(bytes);
}
