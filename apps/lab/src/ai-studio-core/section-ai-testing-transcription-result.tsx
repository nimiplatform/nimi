import { useEffect, useState } from 'react';
import { Button, TextareaField } from '@nimiplatform/kit/ui';
import { useAIStudioHost } from './host-context.js';
import { ArtifactMediaResult } from './section-ai-testing-output.js';
import type { StudioMusicTranscription } from './runtime-types.js';

export function MusicTranscriptionNotice({ value }: { readonly value?: StudioMusicTranscription }) {
  const host = useAIStudioHost(); const { translate: t } = host;
  const [selected, setSelected] = useState(''); const [body, setBody] = useState(''); const [error, setError] = useState('');
  const scores = value?.scores;
  const timelinePath = value?.timelineRelativePath;
  useEffect(() => {
    let active = true; setBody(''); setError('');
    if (selected) void (async () => {
      const timeline = selected === timelinePath;
      const score = scores?.find(item => item.relativePath === selected);
      if (!timeline && score?.format !== 'abc') return;
      const read = await host.sdk.assets.read({ relativePath: selected });
      const iterator = read.body[Symbol.asyncIterator]();
      const expectedMime = timeline ? 'application/vnd.nimi.music-timeline+json' : 'text/vnd.abc';
      const limit = timeline ? 16777216 : 1048576;
      try {
        if (read.asset.mediaType !== expectedMime || read.asset.sizeBytes < 1 || read.asset.sizeBytes > limit) throw new Error(t('Music.scoreTooLarge'));
        const bytes = new Uint8Array(read.asset.sizeBytes); let offset = 0;
        for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
          if (offset + chunk.length > bytes.length) throw new Error(t('Music.scoreTooLarge'));
          bytes.set(chunk, offset); offset += chunk.length;
        }
        if (offset !== bytes.length) throw new Error(t('Music.scoreIncomplete'));
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (active) setBody(text);
      } finally { await iterator.return?.(); }
    })().catch((cause: unknown) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [selected, timelinePath, scores, host, t]);
  if (!value) return null;
  return <section className="space-y-3" aria-label={t('Transcription.result')}>
    <p>{t('Transcription.estimate')}</p>
    <p>{t(`Transcription.completeness.${value.completeness}`)}</p>
    <p>{t('Transcription.range', { start: (value.inputRange.startFrame / value.sourceInfo.sampleRateHz).toFixed(3),
      end: (value.inputRange.endFrame / value.sourceInfo.sampleRateHz).toFixed(3), hz: value.sourceInfo.sampleRateHz })}</p>
    <ArtifactMediaResult artifact={value.sourceAudio} fallbackLabel={t('Transcription.source')} />
    <div className="flex flex-wrap gap-2">
      {value.scores.map(score => <Button key={score.relativePath} onClick={() => {
        if (score.format === 'abc') setSelected(selected === score.relativePath ? '' : score.relativePath);
        else void host.sdk.assets.reveal(score.relativePath).catch((cause: unknown) => setError(String(cause)));
      }}>{t(`Transcription.parts.${score.part}`)} · {score.format.toUpperCase()}</Button>)}
      {timelinePath ? <Button onClick={() => setSelected(selected === timelinePath ? '' : timelinePath)}>{t('Transcription.timeline')}</Button> : null}
    </div>
    {body ? <>
      <TextareaField value={body} readOnly textareaClassName="min-h-48 max-h-96 font-mono" aria-label={t('Transcription.result')} />
      <Button onClick={() => void host.app.commands.exportText({ filename: selected === timelinePath ? 'music-timeline.json' : 'transcribed-score.abc', body })
        .catch((cause: unknown) => setError(String(cause)))}>{t('Transcription.export')}</Button>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
