import { MediaImage } from '@nimiplatform/kit/features/media';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, OverlayShell, ScrollArea, Timeline, TimelineGroup } from '@nimiplatform/kit/ui';
import { BookOpen, X } from 'lucide-react';
import type { WorldDetailData, WorldHistoryBundle, WorldSemanticData } from './world-detail-types.js';
import { worldReadingEntries, worldReadingProseBlocks, type WorldReadingEntry, type WorldReadingSection } from './world-detail-reading-model.js';
import { worldTimeDisplay } from './world-detail-paper-model.js';
import { formatLocaleDateTime } from '../../i18n/index.js';

const SECTION_ORDER: WorldReadingSection[] = ['description', 'rules', 'systems', 'levels', 'taboos', 'topology', 'causality', 'languages', 'history'];

// Long-form reading measure: 14px body text on a ~1.85 line height keeps CJK
// paragraphs comfortable without inventing per-theme values.
const READER_BODY_STYLE = { lineHeight: 1.85 } as const;

function ReaderParagraph({ text, preWrap }: { text: string; preWrap?: boolean }) {
  return (
    <NimiText
      role="body"
      style={READER_BODY_STYLE}
      className={preWrap ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'break-words [overflow-wrap:anywhere]'}
    >
      {text}
    </NimiText>
  );
}

function ReaderEntryTitle({ text }: { text: string }) {
  return <NimiText as="h3" role="card-title" className="break-words">{text}</NimiText>;
}

// The description section reads as continuous prose: source line structure is
// preserved, isolated short lines introducing a paragraph become content headings.
function ReaderProseEntry({ entry }: { entry: WorldReadingEntry }) {
  return (
    <div className="space-y-4">
      {entry.body.flatMap((text, textIndex) => worldReadingProseBlocks(text).map((block, blockIndex) => (
        block.kind === 'heading'
          ? <NimiText key={`${textIndex}-${blockIndex}`} as="h3" role="card-title" className="break-words pt-2">{block.text}</NimiText>
          : <ReaderParagraph key={`${textIndex}-${blockIndex}`} text={block.text} />
      )))}
    </div>
  );
}

function ReaderEntry({ entry }: { entry: WorldReadingEntry }) {
  return (
    <article>
      {entry.title ? <ReaderEntryTitle text={entry.title} /> : null}
      {entry.body.length ? (
        <div className={`space-y-4 ${entry.title ? 'mt-3' : ''}`}>
          {entry.body.map((text, index) => <ReaderParagraph key={index} text={text} preWrap />)}
        </div>
      ) : null}
    </article>
  );
}

type HistoryChunk =
  | { kind: 'timeline'; items: WorldReadingEntry[] }
  | { kind: 'entry'; entry: WorldReadingEntry };

// Dated events keep their supplied order and render on one quiet timeline;
// undated entries fall back to the regular reading layout in place.
function ReaderHistoryEntries({ entries }: { entries: WorldReadingEntry[] }) {
  const chunks: HistoryChunk[] = [];
  entries.forEach((entry) => {
    if (entry.time) {
      const last = chunks[chunks.length - 1];
      if (last && last.kind === 'timeline') last.items.push(entry);
      else chunks.push({ kind: 'timeline', items: [entry] });
    } else {
      chunks.push({ kind: 'entry', entry });
    }
  });
  return (
    <div className="space-y-6">
      {chunks.map((chunk, chunkIndex) => chunk.kind === 'timeline' ? (
        <Timeline key={`timeline-${chunkIndex}`}>
          {chunk.items.map((entry, itemIndex) => (
            <TimelineGroup key={entry.id} date={entry.time} tone="neutral" isLast={itemIndex === chunk.items.length - 1}>
              {entry.title ? <ReaderEntryTitle text={entry.title} /> : null}
              {entry.body.length ? (
                <div className={`space-y-4 ${entry.title ? 'mt-0.5' : ''}`}>
                  {entry.body.map((text, index) => <ReaderParagraph key={index} text={text} preWrap />)}
                </div>
              ) : null}
            </TimelineGroup>
          ))}
        </Timeline>
      ) : (
        <ReaderEntry key={chunk.entry.id} entry={chunk.entry} />
      ))}
    </div>
  );
}

function ReaderCausalityFacts({ facts }: { facts: { id: string; label: string; value: string }[] }) {
  return (
    <div className="divide-y divide-[var(--nimi-border-subtle)]">
      {facts.map((fact) => (
        <div key={fact.id} className="flex items-baseline justify-between gap-6 py-3 first:pt-0 last:pb-0">
          <NimiText role="body" style={READER_BODY_STYLE}>{fact.label}</NimiText>
          <NimiText role="body" className="text-right text-[var(--nimi-text-primary)]">{fact.value}</NimiText>
        </div>
      ))}
    </div>
  );
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r011
export function WorldDetailReader({ world, semantic, history, loading, incomplete, onRetry, onClose }: {
  world: WorldDetailData;
  semantic: WorldSemanticData;
  history: WorldHistoryBundle;
  loading?: boolean;
  incomplete?: boolean;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [bannerFailed, setBannerFailed] = useState(false);
  const sectionRefs = useRef(new Map<WorldReadingSection, HTMLElement>());
  const spyLockedRef = useRef(false);
  const viewportCleanupRef = useRef<(() => void) | undefined>(undefined);
  const entries = useMemo(() => worldReadingEntries(world, semantic, history), [world, semantic, history]);
  const sections = useMemo(() => SECTION_ORDER.map((section) => {
    const items = entries.filter((entry) => entry.section === section);
    const causality = section === 'causality' ? semantic.causality : null;
    const causalityFacts = causality
      ? [
          causality.karmaEnabled != null ? { id: 'karma', label: t('WorldDetail.discovery.karma'), value: t(causality.karmaEnabled ? 'WorldDetail.discovery.yes' : 'WorldDetail.discovery.no') } : null,
          causality.fateWeight != null ? { id: 'fateWeight', label: t('WorldDetail.discovery.fateWeight'), value: String(causality.fateWeight) } : null,
        ].filter((fact): fact is { id: string; label: string; value: string } => Boolean(fact))
      : [];
    return { section, items, causalityFacts };
  }).filter(({ items, causalityFacts }) => items.length > 0 || causalityFacts.length > 0), [entries, semantic, t]);
  const [activeSection, setActiveSection] = useState<WorldReadingSection | null>(sections[0]?.section ?? null);

  useEffect(() => {
    setActiveSection((previous) => (
      previous && sections.some(({ section }) => section === previous) ? previous : sections[0]?.section ?? null
    ));
  }, [sections]);

  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  // The drawer panel mounts through a portal after this component's own
  // effects, so the scroll viewport arrives via callback ref instead.
  const updateActiveSection = useCallback((viewport: HTMLDivElement) => {
    const ordered = sectionsRef.current;
    if (!ordered.length) return;
    if (spyLockedRef.current) return;
    if (viewport.scrollHeight <= viewport.clientHeight + 1) return;
    const viewportTop = viewport.getBoundingClientRect().top;
    const activationLine = viewportTop + Math.min(Math.max(viewport.clientHeight * 0.4, 72), 320);
    let current: WorldReadingSection | null = null;
    sectionRefs.current.forEach((node, section) => {
      if (node.getBoundingClientRect().top <= activationLine) current = section;
    });
    // Short content cannot scroll the last section up to the activation line,
    // so the end of the scroll range reads as the last section.
    if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2) {
      current = ordered[ordered.length - 1]?.section ?? current;
    }
    if (current) setActiveSection((previous) => (previous === current ? previous : current));
  }, []);

  const attachViewport = useCallback((node: HTMLDivElement | null) => {
    viewportCleanupRef.current?.();
    viewportCleanupRef.current = undefined;
    if (!node) return;
    const root = node.parentElement ?? node;
    let frame = 0;
    const handleScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => updateActiveSection(node));
    };
    // A tab pick holds its highlight until the user scrolls by hand.
    const unlockSpy = () => {
      spyLockedRef.current = false;
    };
    const handlePointerDown = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-orientation="vertical"]')) unlockSpy();
    };
    node.addEventListener('scroll', handleScroll, { passive: true });
    root.addEventListener('wheel', unlockSpy, { passive: true, capture: true });
    root.addEventListener('touchstart', unlockSpy, { passive: true, capture: true });
    root.addEventListener('keydown', unlockSpy, { capture: true });
    root.addEventListener('pointerdown', handlePointerDown, { capture: true });
    updateActiveSection(node);
    viewportCleanupRef.current = () => {
      node.removeEventListener('scroll', handleScroll);
      root.removeEventListener('wheel', unlockSpy, { capture: true });
      root.removeEventListener('touchstart', unlockSpy, { capture: true });
      root.removeEventListener('keydown', unlockSpy, { capture: true });
      root.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, [updateActiveSection]);

  useEffect(() => () => viewportCleanupRef.current?.(), []);

  const selectSection = (section: WorldReadingSection) => {
    setActiveSection(section);
    // Hold the picked tab until the user takes over the scrolling.
    spyLockedRef.current = true;
    const node = sectionRefs.current.get(section);
    if (!node) return;
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const headerMeta = [world.genre, worldTimeDisplay(world.time, formatLocaleDateTime) || world.era].filter(Boolean).join(' · ');

  return (
    <OverlayShell
      open kind="drawer" size="sm" onClose={onClose}
      data-testid="world-detail-reader"
      panelClassName="flex flex-col bg-[var(--nimi-surface-card)]"
      contentClassName="flex min-h-0 flex-1 flex-col px-0 py-0"
      title={(
        <div className="flex items-start gap-3 px-2 pt-4">
          {(world.bannerMedia || world.bannerUrl) && !bannerFailed ? (
            <MediaImage
              delivery={world.bannerMedia} externalUrl={world.bannerUrl} purpose="avatar" sizes="44px"
              alt=""
              className="h-11 w-11 shrink-0 rounded-[var(--nimi-radius-md)] object-cover"
              onUnavailable={() => setBannerFailed(true)}
              data-testid="world-detail-reader-banner"
            />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]">
              <BookOpen size={20} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <NimiText role="section-title" className="mt-1 line-clamp-1 break-words" title={world.name}>{world.name}</NimiText>
            {headerMeta ? <NimiText role="caption" className="mt-0.5 line-clamp-1" title={headerMeta}>{headerMeta}</NimiText> : null}
          </div>
          <IconButton tone="ghost" icon={<X size={18} />} aria-label={t('Common.close')} onClick={onClose} className="-mt-1 shrink-0" />
        </div>
      )}
    >
      {sections.length > 1 ? (
        <div className="shrink-0 border-b border-[var(--nimi-border-subtle)] px-8">
          <nav className="flex gap-6 overflow-x-auto" aria-label={t('WorldDetail.discovery.reader')}>
            {sections.map(({ section }) => {
              const active = section === activeSection;
              return (
                <button
                  key={section}
                  type="button"
                  data-testid={`world-detail-reader-tab-${section}`}
                  aria-current={active ? 'location' : undefined}
                  onClick={() => selectSection(section)}
                  className={`relative shrink-0 whitespace-nowrap pb-2.5 pt-1 text-[length:var(--nimi-type-body-size)] transition-colors duration-[var(--nimi-motion-fast)] ${active ? 'font-semibold text-[var(--nimi-text-primary)]' : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)]'}`}
                >
                  {t(`WorldDetail.discovery.reading.${section}`)}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[var(--nimi-action-primary-bg)] transition-opacity duration-[var(--nimi-motion-fast)] ${active ? 'opacity-100' : 'opacity-0'}`}
                  />
                </button>
              );
            })}
          </nav>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1" contentClassName="space-y-8 px-8 pb-10 pt-6" viewportRef={attachViewport} data-testid="world-detail-reader-scroll">
        {loading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : incomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={onRetry ? <Button tone="secondary" size="sm" onClick={onRetry}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
        {sections.map(({ section, items, causalityFacts }) => (
          <section
            key={section}
            ref={(node) => {
              if (node) sectionRefs.current.set(section, node);
              else sectionRefs.current.delete(section);
            }}
            className="scroll-mt-6"
            data-reading-section={section}
          >
            <NimiText as="h2" role="overline">{t(`WorldDetail.discovery.reading.${section}`)}</NimiText>
            <div className="mt-4">
              {section === 'description' ? (
                <div className="space-y-6">
                  {items.map((entry) => <ReaderProseEntry key={entry.id} entry={entry} />)}
                </div>
              ) : section === 'history' ? (
                <ReaderHistoryEntries entries={items} />
              ) : (
                <div className="space-y-6">
                  {items.map((entry) => <ReaderEntry key={entry.id} entry={entry} />)}
                  {causalityFacts.length ? <ReaderCausalityFacts facts={causalityFacts} /> : null}
                </div>
              )}
            </div>
          </section>
        ))}
      </ScrollArea>
    </OverlayShell>
  );
}
