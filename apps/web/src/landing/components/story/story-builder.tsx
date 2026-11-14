import { useState } from 'react';
import { Check, Clipboard, Code2, Package, PanelsTopLeft, Sparkles } from 'lucide-react';
import type { StoryText } from '../../content/story-copy.js';
import type { LandingLinks } from '../../config/landing-links.js';
import { CREATE_APP_COMMAND, kitExample, SDK_EXAMPLE, VERCEL_AI_EXAMPLE } from '../../content/story-model.js';
import { StoryHeading, StoryLink } from './story-shared.js';

const examples = [
  { id: 'sdk', Icon: Code2 },
  { id: 'vercel', Icon: Sparkles },
  { id: 'kit', Icon: PanelsTopLeft },
  { id: 'tools', Icon: Package },
] as const;

export function StoryBuilder({ t, links }: { t: StoryText; links: LandingLinks }) {
  const [mode, setMode] = useState<(typeof examples)[number]['id']>('sdk');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CREATE_APP_COMMAND);
      setCopyStatus('copied');
    } catch {
      setMode('tools');
      setCopyStatus('error');
    }
  };

  const code = mode === 'sdk' ? SDK_EXAMPLE
    : mode === 'vercel' ? VERCEL_AI_EXAMPLE
    : mode === 'kit' ? kitExample(t('builder.sampleAction'), t('builder.sampleResult'))
    : CREATE_APP_COMMAND;

  return <section id="developers" className="story-section story-builder" aria-labelledby="builder-heading" data-story-scene>
    <div className="story-container story-builder-layout">
      <div className="story-builder-intro">
        <StoryHeading t={t} section="builder" />
        <div className="story-builder-actions">
          <StoryLink href={links.createGuideUrl} primary>{t('builder.guide')}</StoryLink>
          <button type="button" className="story-button story-button-outline" onClick={copy}>
            {copyStatus === 'copied' ? <Check size={16} /> : <Clipboard size={16} />}
            {t(copyStatus === 'copied' ? 'builder.copiedCommand' : 'builder.copyCommand')}
          </button>
          <StoryLink href={links.githubUrl}>{t('builder.source')}</StoryLink>
        </div>
        {copyStatus === 'error' && <p role="status">{t('builder.copyError')}</p>}
      </div>
      <div className="story-build-editor">
        <div className="story-build-tabs" role="group" aria-label={t('builder.examples')}>
          {examples.map(({ id, Icon }) => (
            <button type="button" key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>
              <Icon size={16} aria-hidden="true" />
              {t(`builder.${id}`)}
            </button>
          ))}
        </div>
        <pre><code>{code}</code></pre>
      </div>
    </div>
  </section>;
}
