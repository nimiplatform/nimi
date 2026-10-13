import { useTranslation } from 'react-i18next';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, OverlayShell, ScrollArea } from '@nimiplatform/kit/ui';
import { X } from 'lucide-react';
import type { WorldDetailData, WorldHistoryBundle, WorldSemanticData } from './world-detail-types.js';
import { worldReadingEntries, type WorldReadingEntry } from './world-detail-reading-model.js';

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
  const entries = worldReadingEntries(world, semantic, history);
  const sections: WorldReadingEntry['section'][] = ['description', 'rules', 'systems', 'levels', 'taboos', 'topology', 'causality', 'languages', 'history'];
  return (
    <OverlayShell
      open kind="drawer" size="sm" onClose={onClose}
      data-testid="world-detail-reader"
      panelClassName="flex flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col px-0 py-0"
      title={(
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <NimiText as="span" role="section-title">{t('WorldDetail.discovery.reader')}</NimiText>
            <NimiText role="helper" className="mt-1 break-words">{world.name}</NimiText>
          </div>
          <IconButton tone="ghost" icon={<X size={18} />} aria-label={t('Common.close')} onClick={onClose} />
        </div>
      )}
    >
      <ScrollArea className="min-h-0 flex-1" contentClassName="space-y-6 px-6 pb-8 pt-4" data-testid="world-detail-reader-scroll">
        {loading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : incomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={onRetry ? <Button tone="secondary" size="sm" onClick={onRetry}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
        {sections.map((section) => {
          const items = entries.filter((entry) => entry.section === section);
          const causality = section === 'causality' ? semantic.causality : null;
          if (!items.length && !causality) return null;
          return (
            <section key={section} className="space-y-3" data-reading-section={section}>
              <NimiText role="section-title">{t(`WorldDetail.discovery.reading.${section}`)}</NimiText>
              {items.map((entry) => (
                <div key={entry.id} className="space-y-2 border-b border-[var(--nimi-border-subtle)] pb-4 last:border-0 last:pb-0">
                  {entry.text.map((text, index) => <NimiText key={index} role="body" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</NimiText>)}
                </div>
              ))}
              {causality?.karmaEnabled != null ? <NimiText role="body">{t('WorldDetail.discovery.karma')}: {t(causality.karmaEnabled ? 'WorldDetail.discovery.yes' : 'WorldDetail.discovery.no')}</NimiText> : null}
              {causality?.fateWeight != null ? <NimiText role="body">{t('WorldDetail.discovery.fateWeight')}: {causality.fateWeight}</NimiText> : null}
            </section>
          );
        })}
      </ScrollArea>
    </OverlayShell>
  );
}
