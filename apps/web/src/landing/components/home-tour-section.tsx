import { ArrowUpRight, ChevronDown, KeyRound, ScanLine, ShieldCheck } from 'lucide-react';
import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { demoChapters } from '../content/demo-tour.js';
import { useHeroDemoSession } from './hero-demo-context.js';
import { HomeTourCaption } from './home-tour-caption.js';

export function HomeTourSection({ index, content, links }: {
  index: number; content: LandingContent; links: LandingLinks;
}) {
  const { section, preview, current, resumeStep, selectGuideStep, setPlaying } = useHeroDemoSession();
  const chapter = demoChapters[index]!;
  const copy = content[chapter.copy];
  const activeStop = chapter.stops[resumeStep];
  const choiceVisible = activeStop?.preview
    ? preview?.appId === activeStop.preview.appId
    : !preview && current.surface === activeStop?.destination.surface && current.target === activeStop?.destination.target;
  const href = {
    worlds: links.worldsUrl + '#worlds', capabilities: links.modelsUrl, riskControl: links.riskControlUrl,
    create: links.appsUrl, continuity: undefined, developers: links.createGuideUrl,
  }[chapter.copy];
  return (
    <section id={chapter.id} aria-labelledby={chapter.id + '-title'} className="screen-section home-tour-section"
      data-preview-open={section === index + 2 && preview && !chapter.embeddedApps ? '' : undefined}>
      <div className="tour-layout">
        <header className="tour-heading">
          <h2 id={chapter.id + '-title'}>{copy.title.split('\n').map(line => <span key={line}>{line}</span>)}</h2>
          <div className="tour-introduction">
            <p>{copy.intro}</p>
            <div className="tour-resources">
              {copy.detailsLabel && <details>
                <summary>{copy.detailsLabel}<ChevronDown size={13} aria-hidden="true" /></summary>
                <div>{chapter.copy === 'riskControl' ? <><p>{content.riskControl.scope}</p><p>{content.riskControl.limit}</p><p>{content.riskControl.note}</p></> :
                  <p>{chapter.copy === 'capabilities' ? content.capabilities.costNote : copy.details ?? copy.note}</p>}</div>
              </details>}
              {href && copy.cta && <a href={href}>{copy.cta}<ArrowUpRight size={14} aria-hidden="true" /></a>}
              {chapter.copy === 'developers' && <a href={links.githubUrl}>{content.developers.source}<ArrowUpRight size={14} aria-hidden="true" /></a>}
            </div>
          </div>
          {copy.choices && <div className="ecosystem-choices" role="group" aria-label={copy.title.replace('\n', ' ')}>
            {copy.choices.map((label, step) => <button key={label} type="button"
              aria-pressed={section === index + 2 && resumeStep === step && choiceVisible}
              onClick={() => { setPlaying(false); selectGuideStep(step); }}>{label}</button>)}
          </div>}
          {chapter.copy === 'continuity' && <p className="ecosystem-scope">{copy.note}</p>}
          {chapter.copy === 'riskControl' && <div className="security-overview">
            <div className="security-topics" role="group" aria-label={content.riskControl.topicsLabel}>
              {content.riskControl.topics.map((title, step) => {
                const Icon = [ShieldCheck, KeyRound, ScanLine][step]!;
                return <button key={title} type="button" aria-pressed={section === index + 2 && resumeStep === step}
                  onClick={() => { setPlaying(false); selectGuideStep(step); }}>
                  <Icon size={18} aria-hidden="true" /><span>{title}</span>
                  {step === 2 && <small>{content.riskControl.previewLabel}</small>}
                </button>;
              })}
            </div>
            {section === index + 2 && resumeStep === 2 && <p className="security-checkpoints">{content.riskControl.checkpoints}</p>}
          </div>}
        </header>
        <div className="tour-stage" data-home-slot={chapter.id} />
        {section === index + 2 && <HomeTourCaption copy={copy} controls={content.guide} />}
      </div>
    </section>
  );
}
