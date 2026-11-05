import { useState } from 'react';
import { ArrowUpRight, Check, Clipboard, Code2, Package, PanelsTopLeft } from 'lucide-react';
import { Button } from '@nimiplatform/kit/ui';
import type { StoryText } from '../../content/story-copy.js';
import type { LandingLinks } from '../../config/landing-links.js';
import { CREATE_APP_COMMAND, kitExample, SDK_EXAMPLE } from '../../content/story-model.js';
import { StoryHeading, StoryLink } from './story-shared.js';

export function StoryBuilder({ t, links }: { t: StoryText; links: LandingLinks }) {
  const [mode, setMode] = useState<'sdk' | 'kit' | 'tools'>('kit');
  const [clicked, setClicked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = async () => {
    setCopyError(false);
    try { await navigator.clipboard.writeText(CREATE_APP_COMMAND); setCopied(true); } catch { setMode('tools'); setCopyError(true); }
  };
  return <section id="developers" className="story-section story-builder" aria-labelledby="builder-heading" data-story-scene><div className="story-container">
    <StoryHeading t={t} section="builder" />
    <div className="story-build-workbench">
      <div className="story-build-editor"><div className="story-build-tabs" role="group" aria-label={t('common.build')}>{(['sdk', 'kit', 'tools'] as const).map((key, i) => { const Icon = [Code2, PanelsTopLeft, Package][i]!; return <button type="button" key={key} aria-pressed={mode === key} onClick={() => setMode(key)}><Icon size={16} />{t(`builder.${key}`)}</button>; })}</div><pre><code>{mode === 'sdk' ? SDK_EXAMPLE : mode === 'kit' ? kitExample(t('builder.sampleAction'), t('builder.sampleResult')) : CREATE_APP_COMMAND}</code></pre></div>
      <div className="story-build-preview"><small>{t('builder.preview')}</small><img src="/logo.svg" alt="Nimi" /><h3>{t(`builder.${mode}`)}</h3><p>{t(`builder.${mode}Detail`)}</p>{mode === 'kit' ? <><Button tone="primary" onClick={() => setClicked(!clicked)}>{t('builder.sampleAction')}</Button>{clicked && <p role="status">{t('builder.sampleResult')}</p>}</> : <span className="story-build-package">{mode === 'sdk' ? '@nimiplatform/sdk' : '@nimiplatform/app-tools'}</span>}</div>
    </div>
    <div className="story-builder-actions"><StoryLink href={links.createGuideUrl} primary>{t('builder.guide')}</StoryLink><button type="button" className="story-link" onClick={copy}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{t(copied ? 'builder.copiedCommand' : 'builder.copyCommand')}</button><a className="story-link" href={links.githubUrl}>{t('builder.source')}<ArrowUpRight size={16} /></a></div>
    {copyError && <p role="status">{t('builder.copyError')}</p>}<details className="story-builder-note"><summary>{t('common.details')}</summary><p>{t('builder.note')}</p></details>
  </div></section>;
}
