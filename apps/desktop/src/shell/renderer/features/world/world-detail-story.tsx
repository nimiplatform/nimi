import { useState, type CSSProperties, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Maximize2 } from 'lucide-react';
import { MediaImage } from '@nimiplatform/kit/features/media';
import { IconButton, NimiText } from '@nimiplatform/kit/ui';
import { WorldStoryMarkdown } from './world-story-markdown.js';
import type { worldIllustrations } from './world-detail-illustrations.js';
import { WorldIllustrationViewer } from './world-illustration-viewer.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.r013
export function WorldDetailStory({ worldName, story, showExcerpt, hasReading, illustrations, onReadWorld }: {
  worldName: string;
  story: string;
  showExcerpt: boolean;
  hasReading: boolean;
  illustrations: ReturnType<typeof worldIllustrations>;
  onReadWorld: () => void;
}) {
  const { t } = useTranslation();
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [loadedRatios, setLoadedRatios] = useState<Record<string, number>>({});
  const visible = illustrations.filter((item) => !unavailable.has(item.id));
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0];
  const illustrationAlt = (id: string) => t('WorldDetail.discovery.illustrationAlt', {
    name: worldName, index: illustrations.findIndex((item) => item.id === id) + 1,
  });
  const hideIllustration = (id: string) => setUnavailable((previous) => new Set(previous).add(id));
  const recordRatio = (id: string, event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (!naturalHeight) return;
    const ratio = naturalWidth / naturalHeight;
    setLoadedRatios((previous) => previous[id] === ratio ? previous : { ...previous, [id]: ratio });
  };
  // Reserve one column for the whole gallery. Unknown external dimensions are
  // learned from its small thumbnails, rather than changing on every selection.
  const galleryRatio = visible.length ? Math.max(...visible.map((item) => item.ratio ?? loadedRatios[item.id] ?? 1)) : 1;
  const selectedRatio = selected ? selected.ratio ?? loadedRatios[selected.id] ?? 1 : 1;
  const openViewer = () => setViewerOpen(true);

  if (!hasReading && !selected) return null;

  return (
    <section data-testid="world-detail-story" style={{ '--world-illustration-ratio': galleryRatio } as CSSProperties}
      className={'world-detail-story relative overflow-hidden rounded-[14px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_66%,transparent)] ' + (selected ? 'world-detail-story--illustrated' : '') + (selectedRatio > 1 ? ' world-detail-story--landscape' : '')}>
      {selected ? <div className="relative min-w-0" data-testid="world-detail-illustrations">
        <div className="world-illustration-stage flex items-center justify-center">
          <div className="relative max-w-full" style={{ width: `calc(var(--world-illustration-height) * ${selectedRatio})`, aspectRatio: selectedRatio }}>
            <button type="button" onClick={openViewer} aria-haspopup="dialog"
              aria-label={t('WorldDetail.discovery.enlargeIllustration', { name: illustrationAlt(selected.id) })}
              data-testid="world-illustration-open"
              className="block h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--nimi-action-primary-bg)]">
              <MediaImage key={selected.id} delivery={selected.delivery} externalUrl={selected.url} purpose="detail" sizes="auto, 640px"
                alt={illustrationAlt(selected.id)} className="world-illustration-image h-full w-full object-contain"
                onLoad={(event) => recordRatio(selected.id, event)} onUnavailable={() => hideIllustration(selected.id)} />
            </button>
            <IconButton tone="secondary" size="sm" icon={<Maximize2 size={16} />} onClick={openViewer} aria-haspopup="dialog"
              aria-label={t('WorldDetail.discovery.enlarge')} title={t('WorldDetail.discovery.enlarge')} data-testid="world-illustration-enlarge"
              className="absolute top-3 right-3 z-10 rounded-full border-white/15 bg-black/45 text-white shadow-none hover:border-white/30 hover:bg-black/60 hover:shadow-none" />
          </div>
        </div>
        {visible.length > 1 ? <div className="world-illustration-thumbnails flex gap-2 overflow-x-auto px-3 pt-3 pb-1" data-testid="world-illustration-thumbnails">
          {visible.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)}
            aria-label={illustrationAlt(item.id)} aria-pressed={item.id === selected.id}
            className={'h-12 w-[72px] shrink-0 overflow-hidden rounded-md border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-action-primary-bg)] ' + (item.id === selected.id ? 'border-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-subtle)]')}>
            <MediaImage delivery={item.delivery} externalUrl={item.url} purpose="detail" sizes="72px" loading="eager" alt="" className="h-full w-full object-contain"
              onLoad={(event) => recordRatio(item.id, event)} onUnavailable={() => hideIllustration(item.id)} />
          </button>)}
        </div> : null}
      </div> : null}
      <div className="world-detail-story-copy relative flex min-h-0 min-w-0 flex-col justify-center px-6 py-7 @min-[760px]:py-8 @min-[1120px]:pr-12">
        <NimiText as="h2" role="overline" className="mb-4 shrink-0 tracking-[0.24em]">{t('WorldDetail.discovery.story')}</NimiText>
        {showExcerpt ? <div className="min-h-0 max-w-[720px] overflow-hidden"><WorldStoryMarkdown content={story} excerpt /></div> : null}
        {hasReading ? <button type="button" onClick={onReadWorld} data-testid="world-detail-open-reader"
          className="group mt-5 flex w-fit shrink-0 items-center gap-4 border-b border-[var(--nimi-action-primary-bg)] pb-1.5 text-sm font-semibold text-[var(--nimi-action-primary-bg)] transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nimi-action-primary-bg)]">
          {t('WorldDetail.discovery.readWorld')}<ArrowRight size={17} strokeWidth={1.7} className="transition-transform group-hover:translate-x-1 motion-reduce:transition-none" />
        </button> : null}
      </div>
      {selected ? <WorldIllustrationViewer open={viewerOpen} selected={selected} illustrations={visible} illustrationAlt={illustrationAlt}
        onSelect={setSelectedId} onClose={() => setViewerOpen(false)} onUnavailable={hideIllustration} /> : null}
    </section>
  );
}
