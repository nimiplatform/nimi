import { ArrowUpRight, ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StoryText } from '../../content/story-copy.js';
import { PublicSiteLink } from '../../../pages/public-site-shell.js';

export function StoryHeading({ t, section, children }: { t: StoryText; section: 'experience' | 'worlds' | 'showcase' | 'integrations' | 'builder'; children?: ReactNode }) {
  const title = t(`${section}.title`);
  const hasIntro = section !== 'experience';
  return <header className="story-heading">
    {section === 'builder' && <span className="story-eyebrow">{t('builder.eyebrow')}</span>}
    <h2 id={`${section}-heading`}>{title.split(/(?<=，)/).map((phrase, index) => <span key={index}>{phrase}</span>)}</h2>
    {hasIntro && <p>{t(`${section}.body`)}</p>}
    {children}
  </header>;
}
export function StoryLink({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  const isInternal = href.startsWith('/');
  return (
    <PublicSiteLink className={primary ? 'story-button' : 'story-link'} to={href}>
      {children}
      {primary ? <ArrowRight size={17} /> : isInternal ? <ArrowRight size={16} /> : <ArrowUpRight size={16} />}
    </PublicSiteLink>
  );
}
