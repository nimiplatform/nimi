import { useAIStudioHost } from './host-context.js';
import { ArtifactMediaResult } from './section-ai-testing-output.js';
import type { StudioAudioSeparation } from './runtime-types.js';

export function AudioSeparationNotice({ value }: { readonly value?: StudioAudioSeparation }) {
  const host = useAIStudioHost(); const { translate: t } = host;
  if (!value) return null;
  return <section className="space-y-3" aria-label={t('AudioSeparate.result')}>
    <p className="text-sm opacity-70">{t('AudioSeparate.derivation')}</p>
    <ArtifactMediaResult artifact={value.sourceAudio} fallbackLabel={t('AudioSeparate.source')} />
    <ArtifactMediaResult artifact={value.vocals} fallbackLabel={t('AudioSeparate.vocals')} />
    <ArtifactMediaResult artifact={value.background} fallbackLabel={t('AudioSeparate.background')} />
    {value.instrumentParts?.map(part => <ArtifactMediaResult key={part.artifact.relativePath} artifact={part.artifact}
      fallbackLabel={t(`AudioSeparate.parts.${part.kind}`)} />)}
  </section>;
}
