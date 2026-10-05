import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, TextareaField } from '@nimiplatform/kit/ui';
import { useAIStudioHost } from './host-context.js';
import { ArtifactMediaResult } from './section-ai-testing-output.js';
import type { StudioMusicTranscription } from './runtime-types.js';

export function MusicTranscriptionNotice({ value, recordId }: { readonly value?: StudioMusicTranscription; readonly recordId: string }) {
  const host = useAIStudioHost(); const { translate: t } = host;
  const recordKey = value ? JSON.stringify([recordId, value.sourceAudio.relativePath, value.sourceAudio.sha256,
    value.inputRange, value.scores, value.timelineRelativePath]) : '';
  const [selection, setSelection] = useState<{ recordKey: string; path: string } | null>(null);
  const selected = selection?.recordKey === recordKey ? selection.path : '';
  const sourceKey = JSON.stringify([recordKey, selected]);
  type Loaded = { sourceKey: string; path: string; bytes: Uint8Array; body: string; filename: string; mediaType: string; midi: boolean };
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [feedback, setFeedback] = useState<{ sourceKey: string; error?: string; exportedPath?: string } | null>(null);
  const [exporting, setExporting] = useState('');
  const currentSource = useRef(sourceKey);
  useLayoutEffect(() => { currentSource.current = sourceKey; }, [sourceKey]);
  const scores = value?.scores;
  const timelinePath = value?.timelineRelativePath;
  // Render and actions gate on provenance before passive effects can run.
  const file = loaded?.sourceKey === sourceKey ? loaded : null;
  const body = file?.body ?? '';
  const error = feedback?.sourceKey === sourceKey ? feedback.error : '';
  const exportedPath = feedback?.sourceKey === sourceKey ? feedback.exportedPath : '';
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const timeline = selected === timelinePath;
    const score = scores?.find(item => item.relativePath === selected);
    if (!timeline && !score) return;
    const midi = score?.format === 'midi';
    const mediaType = timeline ? 'application/vnd.nimi.music-timeline+json' : midi ? 'audio/midi' : 'text/vnd.abc';
    const filename = timeline ? 'music-timeline.json' : midi ? 'estimated-notes.mid' : 'transcribed-score.abc';
    void (async () => {
      const read = await host.sdk.assets.read({ relativePath: selected });
      const iterator = read.body[Symbol.asyncIterator]();
      const limit = timeline || midi ? 16777216 : 1048576;
      try {
        if (read.asset.mediaType !== mediaType || read.asset.sizeBytes < 1 || read.asset.sizeBytes > limit) throw new Error(t('Music.scoreTooLarge'));
        const bytes = new Uint8Array(read.asset.sizeBytes); let offset = 0;
        for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
          if (offset + chunk.length > bytes.length) throw new Error(t('Music.scoreTooLarge'));
          bytes.set(chunk, offset); offset += chunk.length;
        }
        if (offset !== bytes.length) throw new Error(t('Music.scoreIncomplete'));
        const body = midi ? '' : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (active) setLoaded({ sourceKey, path: selected, bytes, body, filename, mediaType, midi });
      } finally { await iterator.return?.(); }
    })().catch((cause: unknown) => { if (active) setFeedback({ sourceKey, error: String(cause) }); });
    return () => { active = false; };
  }, [sourceKey, selected, timelinePath, scores, host, t]);
  async function exportSelected() {
    const snapshot = file;
    if (!snapshot || snapshot.sourceKey !== currentSource.current || exporting === snapshot.sourceKey) return;
    setExporting(snapshot.sourceKey);
    const bytes = snapshot.bytes;
    async function* chunks() { yield bytes; }
    try {
      const saved = await host.sdk.assets.write({ relativePath: `studio/music/exports/${crypto.randomUUID()}/${snapshot.filename}`,
        body: chunks(), mediaType: snapshot.mediaType, overwrite: false });
      setFeedback({ sourceKey: snapshot.sourceKey, exportedPath: saved.relativePath });
      try { await host.sdk.assets.reveal(saved.relativePath); }
      catch {
        setFeedback({ sourceKey: snapshot.sourceKey, exportedPath: saved.relativePath,
          error: t('Common.exportSavedRevealFailed', { path: saved.relativePath }) });
      }
    } catch { setFeedback({ sourceKey: snapshot.sourceKey, error: t('Common.exportFailed') }); }
    finally { setExporting(previous => previous === snapshot.sourceKey ? '' : previous); }
  }
  function choose(path: string) {
    setSelection({ recordKey, path: selected === path ? '' : path });
  }
  async function revealSelected() {
    const snapshot = file;
    if (!snapshot || snapshot.sourceKey !== currentSource.current) return;
    try { await host.sdk.assets.reveal(snapshot.path); }
    catch { setFeedback({ sourceKey: snapshot.sourceKey, error: t('Common.assetRevealFailed', { path: snapshot.path }) }); }
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
        choose(score.relativePath);
      }}>{t(`Transcription.parts.${score.part}`)} · {score.format.toUpperCase()}</Button>)}
      {timelinePath ? <Button onClick={() => choose(timelinePath)}>{t('Transcription.timeline')}</Button> : null}
    </div>
    {file?.midi ? <div className="space-y-2">
      <p>{t('Transcription.midiTimeBasis', { start: (value.inputRange.startFrame / value.sourceInfo.sampleRateHz).toFixed(3) })}</p>
      <Button disabled={exporting === sourceKey} onClick={() => void exportSelected()}>{t('Transcription.exportMidi')}</Button>
      <Button onClick={() => void revealSelected()}>{t('Transcription.showFile')}</Button>
    </div> : null}
    {body ? <>
      <TextareaField value={body} readOnly textareaClassName="min-h-48 max-h-96 font-mono" aria-label={t('Transcription.result')} />
      <Button disabled={exporting === sourceKey} onClick={() => void exportSelected()}>{t('Transcription.export')}</Button>
    </> : null}
    {exportedPath ? <p>{t('Transcription.exported', { path: exportedPath })}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
