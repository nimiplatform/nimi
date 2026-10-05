import { useAIStudioHost } from './host-context.js';
import { ArtifactMediaResult } from './section-ai-testing-output.js';
import type { StudioAudioSeparation } from './runtime-types.js';
import { audioSeparationRequestFromParameters } from './audio-separation-request.js';

export function AudioSeparationNotice({ value, submittedParameters }: {
  readonly value?: StudioAudioSeparation;
  readonly submittedParameters?: Readonly<Record<string, unknown>>;
}) {
  const host = useAIStudioHost(); const { translate: t } = host;
  if (!value) return null;
  const request = value.request ?? audioSeparationRequestFromParameters(submittedParameters);
  const rangeKey = request?.kind === 'range'
    ? request.endSeconds === undefined ? 'AudioSeparate.processedRangeToEnd' : 'AudioSeparate.processedRange'
    : request?.kind === 'full-source' ? 'AudioSeparate.processedFullSource' : 'AudioSeparate.processedRangeUnknown';
  return <section className="space-y-3" aria-label={t('AudioSeparate.result')}>
    <p className="studio-result__plain" data-audio-separation-range>{t(rangeKey, request?.kind === 'range'
      ? { start: request.startSeconds, end: request.endSeconds } : undefined)}</p>
    <p className="text-sm opacity-70">{t('AudioSeparate.derivation')}</p>
    <ArtifactMediaResult artifact={value.sourceAudio} fallbackLabel={t('AudioSeparate.source')} mediaLabel={t('AudioSeparate.source')} />
    <ArtifactMediaResult artifact={value.vocals} fallbackLabel={t('AudioSeparate.vocals')} mediaLabel={t('AudioSeparate.vocals')} />
    <ArtifactMediaResult artifact={value.background} fallbackLabel={t('AudioSeparate.background')} mediaLabel={t('AudioSeparate.background')} />
    {value.instrumentParts?.map(part => <ArtifactMediaResult key={part.artifact.relativePath} artifact={part.artifact}
      fallbackLabel={t(`AudioSeparate.parts.${part.kind}`)} mediaLabel={t(`AudioSeparate.parts.${part.kind}`)} />)}
  </section>;
}
