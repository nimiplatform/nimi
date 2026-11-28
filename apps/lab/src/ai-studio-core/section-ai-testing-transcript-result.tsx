import type { NimiLocalAppSpeechTranscript } from '@nimiplatform/sdk/app';
import { Button } from '@nimiplatform/kit/ui';
import { useAIStudioHost } from './host-context.js';
import { downloadTextFile, TextStudioOutputBody } from './section-ai-testing-output.js';

const MAX_VISIBLE_ROWS = 400;

export function SpeechTranscriptResultView({
  text,
  transcription,
}: {
  readonly text: string;
  readonly transcription?: NimiLocalAppSpeechTranscript;
}) {
  const host = useAIStudioHost();
  const { translate: t } = host;
  const diarization = transcription?.diarization;
  const words = transcription?.words ?? [];
  const visibleWords = words.slice(0, MAX_VISIBLE_ROWS);
  return (
    <section className="studio-result__rich" aria-label={t('StudioResults.transcript.title')}>
      <TextStudioOutputBody text={text} />
      {transcription ? (
        <Button size="sm" tone="secondary" onClick={() => void downloadTextFile(
          host, 'speech-transcript.json', JSON.stringify(transcription, null, 2),
        )}>
          {t('StudioResults.transcript.exportComplete')}
        </Button>
      ) : null}
      {transcription?.language ? <p className="studio-result__hint">{t('StudioResults.transcript.detectedLanguage', { language: transcription.language })}</p> : null}
      {diarization?.status === 'no-speakers' ? <p>{t('StudioResults.transcript.noSpeakers')}</p> : null}
      {diarization?.status === 'diarized' ? (
        <details className="studio-annotation" open>
          <summary>{t('StudioResults.transcript.speakerIntervals', { count: diarization.intervals.length })}</summary>
          <table className="studio-annotation__tokens">
            <thead><tr><th>{t('StudioResults.transcript.speaker')}</th><th>{t('StudioResults.transcript.start')}</th><th>{t('StudioResults.transcript.end')}</th></tr></thead>
            <tbody>{diarization.intervals.slice(0, MAX_VISIBLE_ROWS).map((interval, index) => (
              <tr key={index}><td>{interval.speakerId}</td><td>{interval.startSeconds.toFixed(3)}</td><td>{interval.endSeconds.toFixed(3)}</td></tr>
            ))}</tbody>
          </table>
          {diarization.intervals.length > MAX_VISIBLE_ROWS ? <p>{t('StudioResults.transcript.moreIntervals', { count: MAX_VISIBLE_ROWS })}</p> : null}
        </details>
      ) : null}
      {words.length > 0 ? (
        <details className="studio-annotation" open>
          <summary>{t('StudioResults.transcript.wordTimes', { count: words.length })}</summary>
          <p className="studio-result__hint">{t('StudioResults.transcript.timeHint')}</p>
          <table className="studio-annotation__tokens">
            <thead><tr><th>#</th><th>{t('StudioResults.transcript.word')}</th><th>{t('StudioResults.transcript.start')}</th><th>{t('StudioResults.transcript.end')}</th></tr></thead>
            <tbody>{visibleWords.map((word, index) => (
              <tr key={`${index}:${word.startSeconds}`}><td>{index + 1}</td><td>{word.text}</td><td>{word.startSeconds.toFixed(3)}</td><td>{word.endSeconds.toFixed(3)}</td></tr>
            ))}</tbody>
          </table>
          {visibleWords.length < words.length ? <p className="studio-result__hint">{t('StudioResults.transcript.truncatedView', { shown: visibleWords.length, total: words.length })}</p> : null}
        </details>
      ) : null}
    </section>
  );
}
