import { useEffect, useState } from 'react';
import { Button, TextareaField } from '@nimiplatform/kit/ui';
import { useAIStudioHost } from './host-context.js';
import { ArtifactMediaResult } from './section-ai-testing-output.js';
import type { StudioMusicTranscription } from './runtime-types.js';

export function MusicTranscriptionNotice({ value }: { readonly value?: StudioMusicTranscription }) {
  const host = useAIStudioHost(); const { translate: t } = host;
  const [selected, setSelected] = useState(''); const [body, setBody] = useState(''); const [error, setError] = useState('');
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [exportedPath, setExportedPath] = useState('');
  const scores = value?.scores;
  const timelinePath = value?.timelineRelativePath;
  useEffect(() => {
    let active = true; setBody(''); setFileBytes(null); setExportedPath(''); setError('');
    if (selected) void (async () => {
      const timeline = selected === timelinePath;
      const score = scores?.find(item => item.relativePath === selected);
      if (!timeline && !score) return;
      const midi = score?.format === 'midi';
      const read = await host.sdk.assets.read({ relativePath: selected });
      const iterator = read.body[Symbol.asyncIterator]();
      const expectedMime = timeline ? 'application/vnd.nimi.music-timeline+json' : midi ? 'audio/midi' : 'text/vnd.abc';
      const limit = timeline || midi ? 16777216 : 1048576;
      try {
        if (read.asset.mediaType !== expectedMime || read.asset.sizeBytes < 1 || read.asset.sizeBytes > limit) throw new Error(t('Music.scoreTooLarge'));
        const bytes = new Uint8Array(read.asset.sizeBytes); let offset = 0;
        for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
          if (offset + chunk.length > bytes.length) throw new Error(t('Music.scoreTooLarge'));
          bytes.set(chunk, offset); offset += chunk.length;
        }
        if (offset !== bytes.length) throw new Error(t('Music.scoreIncomplete'));
        if (active) {
          setFileBytes(bytes);
          if (!midi) setBody(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        }
      } finally { await iterator.return?.(); }
    })().catch((cause: unknown) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [selected, timelinePath, scores, host, t]);
  async function exportSelected() {
    if (!fileBytes) return;
    const timeline = selected === timelinePath;
    const midi = scores?.some(score => score.relativePath === selected && score.format === 'midi');
    const filename = timeline ? 'music-timeline.json' : midi ? 'estimated-notes.mid' : 'transcribed-score.abc';
    const mediaType = timeline ? 'application/vnd.nimi.music-timeline+json' : midi ? 'audio/midi' : 'text/vnd.abc';
    const bytes = fileBytes;
    async function* chunks() { yield bytes; }
    const saved = await host.sdk.assets.write({ relativePath: `studio/music/exports/${crypto.randomUUID()}/${filename}`,
      body: chunks(), mediaType, overwrite: false });
    await host.sdk.assets.reveal(saved.relativePath);
    setExportedPath(saved.relativePath);
  }
  if (!value) return null;
  return <section className="space-y-3" aria-label={t('Transcription.result')}>
    <p>{t('Transcription.estimate')}</p>
    <p>{t(`Transcription.completeness.${value.completeness}`)}</p>
    <p>{t('Transcription.range', { start: (value.inputRange.startFrame / value.sourceInfo.sampleRateHz).toFixed(3),
      end: (value.inputRange.endFrame / value.sourceInfo.sampleRateHz).toFixed(3), hz: value.sourceInfo.sampleRateHz })}</p>
    <ArtifactMediaResult artifact={value.sourceAudio} fallbackLabel={t('Transcription.source')} />
    <div className="flex flex-wrap gap-2">
      {value.scores.map(score => <Button key={score.relativePath} onClick={() => {
        setSelected(selected === score.relativePath ? '' : score.relativePath);
      }}>{t(`Transcription.parts.${score.part}`)} · {score.format.toUpperCase()}</Button>)}
      {timelinePath ? <Button onClick={() => setSelected(selected === timelinePath ? '' : timelinePath)}>{t('Transcription.timeline')}</Button> : null}
    </div>
    {fileBytes && scores?.some(score => score.relativePath === selected && score.format === 'midi') ? <div className="space-y-2">
      <p>{t('Transcription.midiTimeBasis', { start: (value.inputRange.startFrame / value.sourceInfo.sampleRateHz).toFixed(3) })}</p>
      <Button onClick={() => void exportSelected().catch((cause: unknown) => setError(String(cause)))}>{t('Transcription.exportMidi')}</Button>
      <Button onClick={() => void host.sdk.assets.reveal(selected).catch((cause: unknown) => setError(String(cause)))}>{t('Transcription.showFile')}</Button>
    </div> : null}
    {body ? <>
      <TextareaField value={body} readOnly textareaClassName="min-h-48 max-h-96 font-mono" aria-label={t('Transcription.result')} />
      <Button onClick={() => void exportSelected()
        .catch((cause: unknown) => setError(String(cause)))}>{t('Transcription.export')}</Button>
    </> : null}
    {exportedPath ? <p>{t('Transcription.exported', { path: exportedPath })}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
