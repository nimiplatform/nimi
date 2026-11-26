import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MediaImage } from '@nimiplatform/kit/features/media';
import { DialogDescription, DialogTitle, OverlayShell } from '@nimiplatform/kit/ui';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import type { SourceDetailVisualItem } from './source-detail-model.js';

function resolveVisualLabel(
  item: SourceDetailVisualItem,
  t: (key: string, options?: { defaultValue?: string }) => string,
  language: string,
): string {
  const roleKey = item.purpose || item.kind;
  const knownRoles: Record<string, string> = {
    portrait: 'Full portrait',
    scene_moment: 'Story moment',
    full_body_turnaround: 'Turnaround sheet',
    face_neutral: 'Neutral face',
    avatar: 'Avatar',
    referenceImage: 'Reference',
  };
  if (Object.hasOwn(knownRoles, roleKey)) {
    return t(`SourceDetail.worldCharacter.galleryRole.${roleKey}`, {
      defaultValue: knownRoles[roleKey],
    });
  }
  const isZh = language.startsWith('zh');
  if (isZh && item.label) {
    return item.label;
  }
  return item.label || roleKey;
}

function visualAspectClass(item: SourceDetailVisualItem): string {
  const role = item.purpose || item.kind;
  if (role === 'full_body_turnaround') return 'aspect-[3/2]';
  if (role === 'face_neutral' || role === 'avatar') return 'aspect-square';
  if (item.width && item.height) {
    const ratio = item.width / item.height;
    if (ratio > 1.2) return 'aspect-[3/2]';
    if (ratio >= 0.85) return 'aspect-square';
  }
  return 'aspect-[2/3]';
}

export function CharacterVisualGallery({
  characterName,
  items,
}: {
  characterName: string;
  items: readonly SourceDetailVisualItem[];
}) {
  const { t, i18n } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  useEffect(() => {
    setActiveIndex(null);
  }, [characterName, items.length]);

  if (items.length === 0) return null;

  const activeItem = activeIndex !== null ? items[activeIndex] ?? null : null;
  const lastLightboxRef = useRef<{ item: SourceDetailVisualItem; index: number } | null>(null);
  if (activeItem && activeIndex !== null) {
    lastLightboxRef.current = { item: activeItem, index: activeIndex };
  }
  const renderedItem = activeItem ?? lastLightboxRef.current?.item ?? null;
  const renderedIndex = activeIndex ?? lastLightboxRef.current?.index ?? 0;
  const renderedLabel = renderedItem ? resolveVisualLabel(renderedItem, t, language) : null;
  const move = (step: -1 | 1) => {
    setActiveIndex((current) => current === null ? null : (current + step + items.length) % items.length);
  };

  return (
    <section
      data-testid="world-character-visual-gallery"
      className="mt-6 border-t border-[var(--nimi-border-subtle)] pt-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
            {t('SourceDetail.worldCharacter.galleryTitle', { defaultValue: 'Character gallery' })}
          </h2>
          <span className="text-xs font-medium text-[var(--nimi-text-muted)]">
            {t('SourceDetail.worldCharacter.galleryCount', {
              count: items.length,
              defaultValue: `${items.length} visuals`,
            })}
          </span>
        </div>
      </div>

      <div className="mt-3.5 flex items-stretch gap-3.5 overflow-x-auto pb-2">
        {items.map((item, index) => {
          const label = resolveVisualLabel(item, t, language);
          const purpose = item.delivery?.images.some((set) => set.purpose === 'detail')
            ? 'detail'
            : item.delivery?.images.some((set) => set.purpose === 'hero')
              ? 'hero'
              : 'avatar';
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`world-character-gallery-item-${item.purpose ?? item.kind}`}
              aria-label={t('SourceDetail.worldCharacter.galleryOpenImage', {
                label,
                defaultValue: `Inspect full image: ${label}`,
              })}
              onClick={() => setActiveIndex(index)}
              className={`group relative h-[280px] shrink-0 overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] text-left shadow-xs transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.985] motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)] sm:h-[310px] ${visualAspectClass(item)}`}
            >
              <MediaImage
                delivery={item.delivery}
                externalUrl={item.externalUrl}
                purpose={purpose}
                sizes="(min-width: 1024px) 480px, 80vw"
                alt={`${characterName} · ${label}`}
                className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transform-none motion-reduce:transition-none"
              />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/72 via-black/28 to-transparent px-3 pb-2.5 pt-8">
                <span className="truncate text-xs font-semibold text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.65)]">
                  {label}
                </span>
                <Expand
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-white/85 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </span>
            </button>
          );
        })}
      </div>

      <OverlayShell
        open={activeItem !== null}
        onClose={() => setActiveIndex(null)}
        data-testid="world-character-gallery-lightbox"
        className="bg-black/88"
        panelClassName="w-max max-w-[calc(100vw-3rem)] border-0 bg-transparent shadow-none"
        contentClassName="p-0"
      >
        {renderedItem ? (
          <div
            onKeyDown={(event) => {
              if (items.length < 2 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
              event.preventDefault();
              move(event.key === 'ArrowLeft' ? -1 : 1);
            }}
            className="flex max-h-[90vh] flex-col items-center gap-3"
          >
            <div className="flex w-full items-center justify-between gap-4 text-white">
              <div className="flex items-baseline gap-2.5">
                <DialogTitle className="flex items-baseline gap-2.5">
                  <span className="text-sm font-semibold">{characterName}</span>
                  <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white/90">
                    {renderedLabel}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-white/65 tabular-nums">
                  {renderedIndex + 1} / {items.length}
                </DialogDescription>
              </div>
              <button
                type="button"
                data-testid="world-character-gallery-lightbox-close"
                aria-label={t('SourceDetail.worldCharacter.galleryClose', { defaultValue: 'Close preview' })}
                onClick={() => setActiveIndex(null)}
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white transition-[background-color,transform] hover:bg-white/25 active:scale-[0.95] motion-reduce:transform-none focus-visible:outline-2 focus-visible:outline-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="relative flex items-center justify-center">
              {items.length > 1 ? (
                <button
                  type="button"
                  data-testid="world-character-gallery-lightbox-prev"
                  aria-label={t('SourceDetail.worldCharacter.galleryPrev', { defaultValue: 'Previous image' })}
                  onClick={() => move(-1)}
                  className="mr-3 inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white transition-[background-color,transform] hover:bg-white/25 active:scale-[0.95] motion-reduce:transform-none focus-visible:outline-2 focus-visible:outline-white"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden />
                </button>
              ) : null}

              <div className="flex items-center justify-center overflow-hidden rounded-2xl shadow-2xl">
                <MediaImage
                  delivery={renderedItem.delivery}
                  externalUrl={renderedItem.externalUrl}
                  purpose={
                    renderedItem.delivery?.images.some((set) => set.purpose === 'hero')
                      ? 'hero'
                      : renderedItem.delivery?.images.some((set) => set.purpose === 'detail')
                        ? 'detail'
                        : 'avatar'
                  }
                  sizes="85vw"
                  width={renderedItem.width ?? undefined}
                  height={renderedItem.height ?? undefined}
                  loading="eager"
                  alt={`${characterName} · ${renderedLabel}`}
                  className="h-auto max-h-[78vh] w-auto max-w-[82vw] rounded-2xl object-contain"
                />
              </div>

              {items.length > 1 ? (
                <button
                  type="button"
                  data-testid="world-character-gallery-lightbox-next"
                  aria-label={t('SourceDetail.worldCharacter.galleryNext', { defaultValue: 'Next image' })}
                  onClick={() => move(1)}
                  className="ml-3 inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white transition-[background-color,transform] hover:bg-white/25 active:scale-[0.95] motion-reduce:transform-none focus-visible:outline-2 focus-visible:outline-white"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </OverlayShell>
    </section>
  );
}
