/** App-owned references from the submitted inputs and every saved output role. */
export function studioResultAssetReferences(value: unknown): readonly Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok === false) return [];
  const result = value as Record<string, unknown>;
  const references: Record<string, unknown>[] = [];
  const add = (item: unknown) => {
    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).relativePath === 'string') {
      references.push(item as Record<string, unknown>);
    }
  };
  const nested = (key: string) => result[key] && typeof result[key] === 'object' ? result[key] as Record<string, unknown> : {};
  add(result.sourceImage); add(result.preview); add(result.document);
  add(result.firstArtifact);
  if (Array.isArray(result.artifacts)) result.artifacts.forEach(add);
  const transcription = nested('musicTranscription');
  add(transcription.sourceAudio);
  if (Array.isArray(transcription.scores)) transcription.scores.forEach(add);
  const separation = nested('audioSeparation');
  add(separation.sourceAudio); add(separation.vocals); add(separation.background);
  if (Array.isArray(separation.instrumentParts)) separation.instrumentParts.forEach(part => add(part?.artifact));
  const conversion = nested('voiceConversion');
  add(conversion.sourceVocal); add(conversion.targetVoice); add(conversion.vocal);
  const generation = nested('musicGeneration');
  add(generation.generatedScore);
  if (typeof generation.mixRelativePath === 'string') add({ relativePath: generation.mixRelativePath });
  return references;
}

export function studioResultAssetPaths(value: unknown): string[] {
  return [...new Set(studioResultAssetReferences(value).map(item => item.relativePath as string))];
}
