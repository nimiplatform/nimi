import type { ReactNode } from 'react';
import {
  AudioLines,
  Captions,
  Clapperboard,
  Crosshair,
  FileText,
  Fingerprint,
  GitBranch,
  Image,
  Languages,
  ListMusic,
  Maximize2,
  Mic,
  Music2,
  Radio,
  ScanFace,
  ScanText,
  Sparkles,
  Split,
  Video,
  WandSparkles,
} from 'lucide-react';
import type { LandingLocale } from '../landing/i18n/locale.js';
import { PlatformCapabilityAudioStage } from './platform-capability-audio-stages.js';
import { CAPABILITY_SAMPLES, type CapabilityId } from './platform-capability-samples.js';
import { PHASE1_RICH_CAPABILITIES, PlatformCapabilityRichStage } from './platform-capability-stages.js';

export const SAMPLE_ICONS = {
  'text.generate': FileText,
  'text.embed': ScanText,
  'text.decide': GitBranch,
  'text.annotate': Languages,
  'image.generate': Image,
  'image.upscale': Maximize2,
  'image.face_swap': ScanFace,
  'vision.locate': Crosshair,
  'video.generate': Clapperboard,
  'video.upscale': Sparkles,
  'video.face_swap': Video,
  'realtime.interact': Radio,
  'audio.synthesize': AudioLines,
  'audio.transcribe': Captions,
  'voice.create': Mic,
  'audio.speaker.embed': Fingerprint,
  'audio.separate': Split,
  'audio.voice.convert': WandSparkles,
  'music.generate': Music2,
  'music.transcribe': ListMusic,
} as const satisfies Record<CapabilityId, typeof FileText>;

const SAMPLE_COPY = {
  zh: {
    useCase: '适用场景',
    input: '输入场景',
    output: '实际效果',
    usedByLabel: '生态代表应用',
  },
  en: {
    useCase: 'Where it helps',
    input: 'What you do',
    output: 'What happens',
    usedByLabel: 'Used in Nimi Apps',
  },
} as const;

export function PlatformCapabilityPreview({
  capability,
  locale,
  title,
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
  const isPhase1VisualOrText = PHASE1_RICH_CAPABILITIES.has(capability);

  return (
    <div className="platform-lab-stage is-rich-stage" data-sample={capability}>
      {/* Top Toolbar: Capability Name & Engine Counts */}
      <header className="platform-lab-head">
        <div className="platform-lab-title-group">
          <span className="platform-sensory-stage-icon" aria-hidden="true"><Icon size={18} /></span>
          {title && <h3 id={headingId} aria-live="polite">{title}</h3>}
        </div>
        {routeCounts && (
          <div className="platform-lab-head-controls">
            <div className="platform-sensory-stage-routes">
              {routeCounts}
            </div>
          </div>
        )}
      </header>

      {/* Upper Area: Full-Width Rich Interactive Showcase across all 20 Capabilities */}
      <div className="platform-lab-hero-stage">
        {isPhase1VisualOrText ? (
          <PlatformCapabilityRichStage capability={capability} locale={locale} />
        ) : (
          <PlatformCapabilityAudioStage capability={capability} locale={locale} />
        )}
      </div>

      {/* Lower Area: Corresponding Human Explanation + Ecosystem Apps & Specs */}
      <div className="platform-lab-explanation">
        <p className="platform-sensory-stage-tagline">{sample.tagline[locale]}</p>

        {sample.useCase ? (
          <div className="platform-sensory-story-col platform-lab-usecase">
            <h4>{copy.useCase}</h4>
            <p>{sample.useCase[locale]}</p>
          </div>
        ) : (
          <div className="platform-lab-story-grid">
            <div className="platform-sensory-story-col">
              <h4>{copy.input}</h4>
              <p>{sample.input[locale]}</p>
            </div>
            <div className="platform-sensory-story-col is-output">
              <h4>{copy.output}</h4>
              <p>{sample.result[locale]}</p>
            </div>
          </div>
        )}

        <footer className="platform-sensory-stage-foot">
          <div className="platform-sensory-apps">
            <span>{copy.usedByLabel}</span>
            <div className="platform-sensory-app-list">
              {sample.usedApps.map((app) => (
                <span key={app.name.en} className="platform-sensory-app-chip">
                  <img src={app.icon} alt="" width={16} height={16} loading="lazy" />
                  {app.name[locale]}
                </span>
              ))}
            </div>
          </div>
          {sample.facts && (
            <dl className="platform-sensory-facts">
              {sample.facts.map((fact) => (
                <div key={fact.label.en}>
                  <dt>{fact.label[locale]}</dt>
                  <dd>{typeof fact.value === 'string' ? fact.value : fact.value[locale]}</dd>
                </div>
              ))}
            </dl>
          )}
        </footer>
      </div>
    </div>
  );
}
