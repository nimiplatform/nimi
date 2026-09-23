import { useAIStudioHost } from './host-context.js';
import { ArtifactMediaResult } from './section-ai-testing-output.js';
import type { StudioVoiceConversion } from './runtime-types.js';

export function VoiceConversionNotice({ value }: { readonly value?: StudioVoiceConversion }) {
  const host = useAIStudioHost(); const { translate: t } = host;
  if (!value) return null;
  const delta = value.durationDeltaMs;
  return <section className="space-y-3" aria-label={t('VoiceConvert.result')}>
    <p>{t('VoiceConvert.lengthRelation', { relation: t(`VoiceConvert.length.${value.lengthRelation}`), delta: `${delta > 0 ? '+' : ''}${delta}` })}</p>
    <p>{t('VoiceConvert.sourceFacts', { hz: value.sourceInfo.sampleRateHz, channels: value.sourceInfo.channels, durationMs: value.sourceInfo.durationMs })}</p>
    <p>{t('VoiceConvert.vocalFacts', { hz: value.vocalInfo.sampleRateHz, channels: value.vocalInfo.channels, durationMs: value.vocalInfo.durationMs })}</p>
    <p>{t('VoiceConvert.range', { start: (value.inputRange.startFrame / value.sourceInfo.sampleRateHz).toFixed(3),
      end: (value.inputRange.endFrame / value.sourceInfo.sampleRateHz).toFixed(3), hz: value.sourceInfo.sampleRateHz })}</p>
    <p className="text-sm opacity-70">{t('VoiceConvert.derivation')}</p>
    <ArtifactMediaResult artifact={value.sourceVocal} fallbackLabel={t('VoiceConvert.source')} />
    {value.targetVoice ? <ArtifactMediaResult artifact={value.targetVoice} fallbackLabel={t('VoiceConvert.target')} /> : null}
    <ArtifactMediaResult artifact={value.vocal} fallbackLabel={t('VoiceConvert.result')} />
  </section>;
}
