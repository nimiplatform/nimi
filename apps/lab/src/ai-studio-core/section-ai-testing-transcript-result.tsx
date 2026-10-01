import type { NimiLocalAppSpeechTranscript } from '@nimiplatform/sdk/app';
import { useAIStudioHost } from './host-context.js';
import { TextStudioOutputBody } from './section-ai-testing-output.js';

const MAX_VISIBLE_WORDS = 400;

export function SpeechTranscriptResultView({
  text,
  transcription,
}: {
  readonly text: string;
  readonly transcription?: NimiLocalAppSpeechTranscript;
}) {
  const { translate: t } = useAIStudioHost();
  const words = transcription?.words ?? [];
  const visibleWords = words.slice(0, MAX_VISIBLE_WORDS);
  return (
    <section className="studio-result__rich" aria-label={t('StudioResults.transcript.title')}>
      <TextStudioOutputBody text={text} />
      {transcription?.language ? <p className="studio-result__hint">{t('StudioResults.transcript.detectedLanguage', { language: transcription.language })}</p> : null}
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
