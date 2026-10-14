import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, OverlayShell, ScrollArea, Surface } from '@nimiplatform/kit/ui';
import { BookOpen, Globe, Hourglass, Languages, Layers, Network, Orbit, ScrollText, ShieldAlert, X } from 'lucide-react';
import type { WorldDetailData, WorldHistoryBundle, WorldSemanticData } from './world-detail-types.js';
import { worldReadingEntries, type WorldReadingEntry } from './world-detail-reading-model.js';
import { worldTimeDisplay } from './world-detail-paper-model.js';
import { formatLocaleDateTime } from '../../i18n/index.js';

type ReadingSection = WorldReadingEntry['section'];

const SECTION_ORDER: ReadingSection[] = ['description', 'rules', 'systems', 'levels', 'taboos', 'topology', 'causality', 'languages', 'history'];

const SECTION_ICONS: Record<ReadingSection, ReactNode> = {
  description: <BookOpen size={15} />,
  rules: <ScrollText size={15} />,
  systems: <Network size={15} />,
  levels: <Layers size={15} />,
  taboos: <ShieldAlert size={15} />,
  topology: <Globe size={15} />,
  causality: <Orbit size={15} />,
  languages: <Languages size={15} />,
  history: <Hourglass size={15} />,
};

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
  const sectionRefs = useRef(new Map<ReadingSection, HTMLElement>());
  const entries = worldReadingEntries(world, semantic, history);
  const sections = SECTION_ORDER.map((section) => {
    const items = entries.filter((entry) => entry.section === section);
    const causality = section === 'causality' ? semantic.causality : null;
    const causalityFacts = causality
      ? [
          causality.karmaEnabled != null ? { id: 'karma', label: t('WorldDetail.discovery.karma'), value: t(causality.karmaEnabled ? 'WorldDetail.discovery.yes' : 'WorldDetail.discovery.no') } : null,
          causality.fateWeight != null ? { id: 'fateWeight', label: t('WorldDetail.discovery.fateWeight'), value: String(causality.fateWeight) } : null,
        ].filter((fact): fact is { id: string; label: string; value: string } => Boolean(fact))
      : [];
    return { section, items, causalityFacts };
  }).filter(({ items, causalityFacts }) => items.length > 0 || causalityFacts.length > 0);

  const scrollToSection = (section: ReadingSection) => {
    const node = sectionRefs.current.get(section);
    if (!node) return;
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const headerMeta = [...new Set([world.genre, world.era, worldTimeDisplay(world.time, formatLocaleDateTime)].filter(Boolean))].join(' · ');

  return (
    <OverlayShell
      open kind="drawer" size="sm" onClose={onClose}
      data-testid="world-detail-reader"
      panelClassName="flex flex-col bg-[var(--nimi-surface-canvas)]"
      contentClassName="flex min-h-0 flex-1 flex-col px-0 py-0"
      title={(
        <div className="flex items-start gap-3">
          {world.bannerUrl && !bannerFailed ? (
            <img
              src={world.bannerUrl}
              alt=""
              className="h-11 w-11 shrink-0 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] object-cover"
              onError={() => setBannerFailed(true)}
              data-testid="world-detail-reader-banner"
            />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]">
              <BookOpen size={20} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <NimiText as="span" role="overline">{t('WorldDetail.discovery.reader')}</NimiText>
            <NimiText role="section-title" className="mt-1 line-clamp-1 break-words" title={world.name}>{world.name}</NimiText>
            {headerMeta ? <NimiText role="caption" className="mt-0.5 line-clamp-1" title={headerMeta}>{headerMeta}</NimiText> : null}
          </div>
          <IconButton tone="ghost" icon={<X size={18} />} aria-label={t('Common.close')} onClick={onClose} className="-mr-2 -mt-1 shrink-0" />
        </div>
      )}
    >
      {sections.length > 1 ? (
        <div className="shrink-0 border-b border-[var(--nimi-border-subtle)] px-6 py-3">
          <nav className="flex gap-1.5 overflow-x-auto" aria-label={t('WorldDetail.discovery.reader')}>
            {sections.map(({ section }) => (
              <Button
                key={section}
                tone="ghost"
                size="sm"
                className="shrink-0 rounded-[var(--nimi-radius-full)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]"
                onClick={() => scrollToSection(section)}
              >
                {t(`WorldDetail.discovery.reading.${section}`)}
              </Button>
            ))}
          </nav>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1" contentClassName="space-y-7 px-6 pb-8 pt-5" data-testid="world-detail-reader-scroll">
        {loading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : incomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={onRetry ? <Button tone="secondary" size="sm" onClick={onRetry}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
        {sections.map(({ section, items, causalityFacts }) => (
          <section
            key={section}
            ref={(node) => {
              if (node) sectionRefs.current.set(section, node);
              else sectionRefs.current.delete(section);
            }}
            className="space-y-3 scroll-mt-4"
            data-reading-section={section}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]">
                {SECTION_ICONS[section]}
              </span>
              <NimiText role="section-title" className="min-w-0 flex-1">{t(`WorldDetail.discovery.reading.${section}`)}</NimiText>
              <NimiText role="caption" className="shrink-0">{t('WorldDetail.discovery.readingEntryCount', { count: items.length + (causalityFacts.length ? 1 : 0) })}</NimiText>
            </div>
            <div className="space-y-2.5">
              {items.map((entry) => (
                <Surface key={entry.id} as="article" tone="card" padding="md" className="space-y-2 shadow-none">
                  {entry.text.map((text, index) => <NimiText key={index} role="body" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</NimiText>)}
                </Surface>
              ))}
              {causalityFacts.length ? (
                <Surface tone="card" padding="md" className="space-y-2 shadow-none">
                  {causalityFacts.map((fact) => (
                    <div key={fact.id} className="flex items-baseline justify-between gap-4">
                      <NimiText role="caption">{fact.label}</NimiText>
                      <NimiText role="label" className="text-right">{fact.value}</NimiText>
                    </div>
                  ))}
                </Surface>
              ) : null}
            </div>
          </section>
        ))}
      </ScrollArea>
    </OverlayShell>
  );
}
