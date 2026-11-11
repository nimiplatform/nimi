import { ArrowUpRight, ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StoryText } from '../../content/story-copy.js';

export function StoryHeading({ t, section, children }: { t: StoryText; section: 'experience' | 'worlds' | 'showcase' | 'integrations' | 'devices' | 'builder'; children?: ReactNode }) {
  const title = t(`${section}.title`);
  const hasIntro = section !== 'experience';
  return <header className="story-heading">
    {hasIntro && <span className="story-eyebrow">{t(`${section}.eyebrow`)}</span>}
    <h2 id={`${section}-heading`}>{title.split(/(?<=，)/).map((phrase, index) => <span key={index}>{phrase}</span>)}</h2>
    {hasIntro && <p>{t(`${section}.body`)}</p>}
    {children}
  </header>;
}
export function StoryLink({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  return <a className={primary ? 'story-button' : 'story-link'} href={href}>{children}{primary ? <ArrowRight size={17} /> : <ArrowUpRight size={16} />}</a>;
}
