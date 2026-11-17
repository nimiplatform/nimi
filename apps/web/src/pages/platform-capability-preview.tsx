import type { ReactNode } from 'react';
import {
  AudioLines, Captions, Clapperboard, Crosshair, FileText, Image, Mic, Music2, Radio, ScanText, Split,
} from 'lucide-react';
import type { LandingLocale } from '../landing/i18n/locale.js';
import { CAPABILITY_SAMPLES, type CapabilityId } from './platform-capability-samples.js';

const SAMPLE_ICONS = {
  'text.generate': FileText,
  'text.embed': ScanText,
  'image.generate': Image,
  'video.generate': Clapperboard,
  'vision.locate': Crosshair,
  'realtime.interact': Radio,
  'audio.synthesize': AudioLines,
  'audio.transcribe': Captions,
  'music.generate': Music2,
  'voice.create': Mic,
  'audio.separate': Split,
} as const;

const SAMPLE_COPY = {
  zh: {
    input: '测试输入',
    output: '记录结果',
    unavailable: { image: '原图未收录', video: '原始视频未收录', audio: '原始音频未收录' },
  },
  en: {
    input: 'Test input',
    output: 'Recorded result',
    unavailable: { image: 'Original image unavailable', video: 'Original video unavailable', audio: 'Original audio unavailable' },
  },
} as const;

export function PlatformCapabilityPreview({
  capability,
  locale,
  title,
  sourceLabel,
  headingId,
  routeCounts,
}: {
  capability: CapabilityId;
  locale: LandingLocale;
  title?: string;
  sourceLabel?: string;
  headingId?: string;
  routeCounts?: ReactNode;
}) {
  const sample = CAPABILITY_SAMPLES[capability];
  const Icon = SAMPLE_ICONS[capability];
  const copy = SAMPLE_COPY[locale];
  const hasFooterMeta = Boolean(sample.facts?.length || sample.unavailableMedia);

  return (
    <div className="public-capability-sample" data-sample={capability}>
      <div className="public-capability-sample-input">
        {title ? (
          <header className="public-capability-sample-header">
            <span className="public-capability-sample-icon" aria-hidden="true"><Icon size={18} /></span>
            <div className="public-capability-sample-title">
              <h3 id={headingId} aria-live="polite">{title}</h3>
              {sourceLabel && <span>{sourceLabel}</span>}
            </div>
          </header>
        ) : (
          <span className="public-capability-sample-icon" aria-hidden="true"><Icon size={20} /></span>
        )}
        <div className="public-capability-sample-prompt">
          <h4>{copy.input}</h4>
          <p>{sample.input[locale]}</p>
        </div>
        {routeCounts && (
          <div className="public-capability-sample-footer">
            {routeCounts}
          </div>
        )}
      </div>
      <div className="public-capability-sample-result">
        <div className="public-capability-sample-output">
          <h4>{copy.output}</h4>
          <p>{sample.result[locale]}</p>
          {sample.excerpt && <blockquote lang={sample.excerpt.lang}>{sample.excerpt.text}</blockquote>}
        </div>
        {hasFooterMeta && (
          <div className="public-capability-sample-meta">
            {sample.facts && (
              <dl className="public-capability-sample-facts">
                {sample.facts.map(({ label, value }) => (
                  <div key={label.en}>
                    <dt>{label[locale]}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {sample.unavailableMedia && (
              <p className="public-capability-sample-note">{copy.unavailable[sample.unavailableMedia]}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
