import type { StudioRunHistoryRecord } from '../../ai-studio-core/history.js';
import type { LabRendererCommandPort } from '../../renderer/contract.js';

export function worldTourHistoryManifest(record: StudioRunHistoryRecord): { manifestPath: string; archivePath: string } | null {
  const result = record.result;
  if (record.capabilityId !== 'world.generate' || !result?.ok || result.kind !== 'artifacts' || !result.jobId) return null;
  const archive = result.artifacts?.find((artifact) => artifact.mediaType === 'application/vnd.nimi.world+zip') ?? result.firstArtifact;
  const archivePath = `world-tour/${result.jobId}/world.zip`;
  if (archive?.mediaType !== 'application/vnd.nimi.world+zip' || archive.relativePath !== archivePath) return null;
  return { manifestPath: `world-tour/${result.jobId}/world.json`, archivePath };
}

export async function openWorldTourHistory(
  record: StudioRunHistoryRecord,
  commands: Pick<LabRendererCommandPort, 'resolveWorldTourFixture' | 'openWorldTourWindow'>,
) {
  const saved = worldTourHistoryManifest(record);
  if (!saved) throw new Error('world-tour-history-invalid');
  const fixture = await commands.resolveWorldTourFixture({ manifestPath: saved.manifestPath });
  if (fixture.manifestPath !== saved.manifestPath || fixture.archivePath !== saved.archivePath) {
    throw new Error('world-tour-history-manifest-mismatch');
  }
  return commands.openWorldTourWindow({ manifestPath: saved.manifestPath });
}
