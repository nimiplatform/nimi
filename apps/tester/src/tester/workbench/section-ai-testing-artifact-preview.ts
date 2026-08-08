export type StudioArtifactPreviewSource = {
  artifactId?: string;
  mimeType?: string;
  url?: string;
  displayName?: string;
  previewSource?: 'hosted-uri' | 'inline-bytes' | 'metadata-only';
  sizeBytes?: number;
};

export type StudioArtifactRenderBranch =
  | 'image'
  | 'audio'
  | 'video'
  | 'metadata-only'
  | 'unsupported'
  | 'none';

// Single pure projection shared by the current-result and persisted-history
// renderers. Legacy records did not persist previewSource, so a valid URL/MIME
// pair remains previewable; every artifact without usable bytes is explicit.
export function studioArtifactRenderBranch(
  artifact?: StudioArtifactPreviewSource,
): StudioArtifactRenderBranch {
  if (!artifact) return 'none';
  const url = artifact.url?.trim();
  if (artifact.previewSource === 'metadata-only' || !url) return 'metadata-only';
  const mimeType = artifact.mimeType?.trim().toLowerCase() ?? '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'unsupported';
}

export function hasStudioArtifactMedia(
  artifact?: StudioArtifactPreviewSource,
): boolean {
  const branch = studioArtifactRenderBranch(artifact);
  return branch === 'image' || branch === 'audio' || branch === 'video';
}
