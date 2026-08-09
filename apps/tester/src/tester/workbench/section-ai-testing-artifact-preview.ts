export type StudioArtifactPreviewSource = {
  relativePath?: string;
  mediaType?: string;
  sha256?: string;
  displayName?: string;
  previewSource?: 'managed-asset';
  sizeBytes?: number;
};

export type StudioArtifactRenderBranch =
  | 'image'
  | 'audio'
  | 'video'
  | 'metadata-only'
  | 'unsupported'
  | 'none';

// Single pure projection shared by current and persisted result renderers.
// Playback exists only for managed assets; source artifact URLs and bodies are
// never treated as persistent media truth.
export function studioArtifactRenderBranch(
  artifact?: StudioArtifactPreviewSource,
): StudioArtifactRenderBranch {
  if (!artifact) return 'none';
  if (artifact.previewSource !== 'managed-asset' || !artifact.relativePath?.trim()) return 'metadata-only';
  const mimeType = artifact.mediaType?.trim().toLowerCase() ?? '';
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
