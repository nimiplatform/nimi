import { ArrowUpRight, ChevronDown } from 'lucide-react';
import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import { demoChapters } from '../content/demo-tour.js';
import { useHeroDemoSession } from './hero-demo-context.js';
import { HomeTourCaption } from './home-tour-caption.js';

export function HomeTourSection({ index, content, links }: {
  index: number; content: LandingContent; links: LandingLinks;
}) {
  const { section, preview } = useHeroDemoSession();
  const chapter = demoChapters[index]!;
  const copy = content[chapter.copy];
  const href = {
    worlds: links.worldsUrl + '#worlds', capabilities: links.modelsUrl, riskControl: links.riskControlUrl,
    create: links.createAppUrl, continuity: undefined, developers: links.createGuideUrl,
  }[chapter.copy];
  return (
    <section id={chapter.id} aria-labelledby={chapter.id + '-title'} className="screen-section home-tour-section"
      data-preview-open={section === index + 2 && preview ? '' : undefined}>
      <div className="tour-layout">
        <header className="tour-heading">
          <h2 id={chapter.id + '-title'}>{copy.title.split('\n').map(line => <span key={line}>{line}</span>)}</h2>
          <div className="tour-introduction">
            <p>{copy.intro}</p>
            {(chapter.copy === 'riskControl' || chapter.copy === 'create') && <small>{copy.note}</small>}
            <div className="tour-resources">
              {copy.detailsLabel && <details>
                <summary>{copy.detailsLabel}<ChevronDown size={13} aria-hidden="true" /></summary>
                <div>{chapter.copy === 'riskControl' ? <><p>{content.riskControl.scope}</p><p>{content.riskControl.limit}</p></> :
                  <p>{chapter.copy === 'capabilities' ? content.capabilities.costNote : copy.note}</p>}</div>
              </details>}
              {href && copy.cta && <a href={href}>{copy.cta}<ArrowUpRight size={14} aria-hidden="true" /></a>}
              {chapter.copy === 'developers' && <a href={links.githubUrl}>{content.developers.source}<ArrowUpRight size={14} aria-hidden="true" /></a>}
            </div>
          </div>
        </header>
        <div className="tour-stage" data-home-slot={chapter.id} />
        {section === index + 2 && <HomeTourCaption copy={copy} controls={content.guide} />}
      </div>
    </section>
  );
}
