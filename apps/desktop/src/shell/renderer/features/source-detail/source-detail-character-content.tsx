import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Info } from 'lucide-react';
import type { SourceDetailData } from './source-detail-model.js';
import { uniqueStrings } from './source-detail-world-character-labels.js';

// Clamp only the reading preview; the complete authored text remains available.
export function CharacterProfileText({ text, lines = 4, testId, className = '' }: {
  text: string;
  lines?: number;
  testId?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, lines, expanded]);
  return <div className="min-w-0">
    <p ref={ref} id={id} data-testid={testId}
      className={`whitespace-pre-wrap break-words text-[15px] leading-7 text-[var(--nimi-text-secondary)] ${className}`}
      style={expanded ? undefined : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines, overflow: 'hidden' }}>
      {text}
    </p>
    {overflows ? <button type="button" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}
      className="mt-1.5 rounded text-sm font-medium text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
      {expanded ? t('SourceDetail.worldCharacter.readLess') : t('SourceDetail.worldCharacter.readMore')}
    </button> : null}
  </div>;
}

export function characterAboutParagraphs(source: SourceDetailData) {
  // Narrative and public card summary are different authored fields. A full
  // narrative takes precedence over the short discovery card introduction.
  const intro = source.characterProfile.narrativeSummary?.trim()
    || source.entity?.summary?.trim() || source.bio?.trim();
  const headerLine = source.characterProfile.role?.trim() || source.characterProfile.profileLine?.trim();
  const disposition = source.characterProfile.disposition?.trim();
  return [
    { id: 'character-introduction', text: intro === headerLine ? null : intro },
    { id: 'character-disposition', text: disposition === intro ? null : disposition },
  ].filter((item): item is { id: string; text: string } => Boolean(item.text));
}

export function characterAppearanceDetails(source: SourceDetailData) {
  return uniqueStrings([
    source.characterProfile.bodyDescription,
    source.characterProfile.lifeStageDescription !== source.characterProfile.ageDescription
      ? source.characterProfile.lifeStageDescription : null,
    source.characterProfile.interaction?.tone,
    source.characterProfile.interaction?.cadence,
  ]);
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r033
export function CharacterProfileSections({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const profile = source.characterProfile;
  const paragraphs = characterAboutParagraphs(source);
  const drives = uniqueStrings(profile.drives ?? []);
  const topics = uniqueStrings(profile.knowledgeTopics);
  const rules = uniqueStrings([...profile.knowledgeConstraints, ...(profile.boundaries ?? [])]);
  return <>
    {paragraphs.length ? <section data-testid="world-character-about-section">
      <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
        {t('SourceDetail.worldCharacter.aboutTitle', { name: source.displayName })}
      </h2>
      <div className="mt-4 grid gap-3">
        {paragraphs.map(item => <CharacterProfileText key={item.id} testId={item.id} text={item.text} />)}
      </div>
    </section> : null}
    {drives.length ? <section data-testid="world-character-drives-section" className="border-t border-[var(--nimi-border-subtle)] pt-5">
      <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">{t('SourceDetail.worldCharacter.drivesTitle')}</h2>
      <div className="mt-3 grid gap-2">{drives.map(text => <CharacterProfileText key={text} text={text} />)}</div>
    </section> : null}
    {topics.length || rules.length ? <section data-testid="world-character-knowledge-section" className="border-t border-[var(--nimi-border-subtle)] pt-5">
      {topics.length ? <>
        <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">{t('SourceDetail.worldCharacter.knowledgeTitle')}</h2>
        <ul className="mt-3 grid gap-1 text-[15px] leading-7 text-[var(--nimi-text-secondary)]">
          {topics.map(topic => <li key={topic}>{topic}</li>)}
        </ul>
      </> : null}
      {rules.length ? <aside data-testid="world-character-guidance" className={`${topics.length ? 'mt-4' : ''} flex items-start gap-3 rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,transparent)] px-4 py-3`}>
        <Info aria-hidden className="mt-1 h-4 w-4 shrink-0 text-[var(--nimi-action-primary-bg)]" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('SourceDetail.worldCharacter.guidanceTitle')}</h3>
          <div className="mt-1 grid gap-2">{rules.map(text => <CharacterProfileText key={text} text={text} />)}</div>
        </div>
      </aside> : null}
    </section> : null}
  </>;
}

export function CharacterAppearanceDisclosure({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const details = characterAppearanceDetails(source);
  if (!details.length) return null;
  return <details data-testid="world-character-appearance-disclosure" className="group text-[var(--nimi-text-secondary)]">
    <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] [&::-webkit-details-marker]:hidden">
      {t('SourceDetail.worldCharacter.appearanceVoiceTitle')}
      <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />
    </summary>
    <div className="mt-3 grid gap-2">{details.map(text => <CharacterProfileText key={text} text={text} />)}</div>
  </details>;
}
