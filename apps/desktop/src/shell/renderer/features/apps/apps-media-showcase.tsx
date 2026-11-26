// 16:9 static screenshot gallery + lightbox with explicit visible image-load error fallback.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042c

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Expand, ImageOff, Images, RotateCw, X } from 'lucide-react';
import { Button, DialogDescription, DialogTitle, IconButton, OverlayShell } from '@nimiplatform/kit/ui';
import type { ResolvedStorefrontGallerySlide } from './apps-storefront.js';

export interface AppsMediaShowcaseProps {
  readonly coverUrl?: string | null;
  readonly gallery: readonly ResolvedStorefrontGallerySlide[];
  readonly appName: string;
  readonly collapsedByDefault?: boolean;
}

export function AppsMediaShowcase({
  coverUrl,
  gallery,
  appName,
  collapsedByDefault = false,
}: AppsMediaShowcaseProps): ReactElement | null {
  const { t } = useTranslation();
  const slides: readonly ResolvedStorefrontGallerySlide[] = gallery.length > 0
    ? gallery
    : coverUrl
      ? [{ id: 'cover', url: coverUrl, caption: '' }]
      : [];

  const [expanded, setExpanded] = useState(!collapsedByDefault);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [failedKeys, setFailedKeys] = useState<Readonly<Record<string, number>>>({});
  const [retryCount, setRetryCount] = useState<Readonly<Record<string, number>>>({});

  useEffect(() => {
    setExpanded(!collapsedByDefault);
  }, [collapsedByDefault, appName]);

  useEffect(() => {
    if (activeIndex >= slides.length) setActiveIndex(0);
  }, [activeIndex, slides.length]);

  useEffect(() => {
    if (!lightboxOpen || slides.length <= 1) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveIndex((idx) => (idx + 1) % slides.length);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveIndex((idx) => (idx - 1 + slides.length) % slides.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen, slides.length]);

  const lastLightboxSlideRef = useRef<{
    slide: ResolvedStorefrontGallerySlide;
    attempt: number;
    index: number;
  } | null>(null);

  if (slides.length === 0) return null;

  const activeSlide = slides[Math.min(activeIndex, slides.length - 1)]!;
  const attempt = retryCount[activeSlide.url] ?? 0;
  const activeFailed = failedKeys[activeSlide.url] === attempt;
  const isLightboxOpen = lightboxOpen && !activeFailed;
  if (isLightboxOpen) {
    lastLightboxSlideRef.current = { slide: activeSlide, attempt, index: Math.min(activeIndex, slides.length - 1) };
  }
  const renderedLightbox = isLightboxOpen
    ? { slide: activeSlide, attempt, index: Math.min(activeIndex, slides.length - 1) }
    : lastLightboxSlideRef.current;
  const srcWithRetry = (url: string, count: number): string => (
    count > 0 ? `${url}${url.includes('?') ? '&' : '?'}retry=${count}` : url
  );

  const retryImage = (url: string): void => {
    setRetryCount((prev) => ({ ...prev, [url]: (prev[url] ?? 0) + 1 }));
  };

  if (collapsedByDefault && !expanded) {
    return (
      <div data-testid="apps-media-collapsed" className="mb-5">
        <Button
          tone="secondary"
          size="sm"
          data-testid="apps-media-expand"
          onClick={() => setExpanded(true)}
          leadingIcon={<Images className="h-4 w-4" aria-hidden="true" />}
        >
          {t('Apps.storefront.galleryExpand', { count: slides.length })}
        </Button>
      </div>
    );
  }

  return (
    <section data-testid="apps-media-showcase" aria-label={appName} className="mb-6 space-y-3">
      {collapsedByDefault ? (
        <div className="flex justify-end">
          <Button
            tone="ghost"
            size="sm"
            data-testid="apps-media-collapse"
            onClick={() => setExpanded(false)}
          >
            {t('Apps.storefront.galleryCollapse')}
          </Button>
        </div>
      ) : null}

      <div className="group relative overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,transparent)]">
        <div className="relative aspect-video w-full overflow-hidden bg-[color-mix(in_srgb,var(--nimi-surface-active)_55%,transparent)]">
          {activeFailed ? (
            <div
              data-testid="apps-media-error"
              role="status"
              className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center"
            >
              <ImageOff className="h-8 w-8 text-[color:var(--nimi-text-muted)]" aria-hidden="true" />
              <p className="text-sm font-medium text-[color:var(--nimi-text-secondary)]">
                {t('Apps.storefront.imageLoadFailed')}
              </p>
              <Button
                tone="secondary"
                size="sm"
                data-testid="apps-media-retry"
                leadingIcon={<RotateCw className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => retryImage(activeSlide.url)}
              >
                {t('Apps.storefront.imageRetry')}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="apps-media-zoom"
              aria-label={t('Apps.storefront.galleryZoom')}
              onClick={() => setLightboxOpen(true)}
              className="block h-full w-full cursor-zoom-in transition-transform duration-150 active:scale-[0.995] motion-reduce:transform-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              <img
                key={`${activeSlide.url}:${attempt}`}
                src={srcWithRetry(activeSlide.url, attempt)}
                alt={activeSlide.caption || appName}
                className="h-full w-full object-cover"
                onError={() => setFailedKeys((prev) => ({ ...prev, [activeSlide.url]: attempt }))}
              />
              <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Expand className="h-3.5 w-3.5" aria-hidden="true" />
                {t('Apps.storefront.galleryZoom')}
              </span>
            </button>
          )}

          {slides.length > 1 ? (
            <>
              <IconButton
                data-testid="apps-media-prev"
                icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
                tone="secondary"
                size="sm"
                aria-label={t('Apps.storefront.galleryPrev')}
                className="absolute left-3 top-1/2 -translate-y-1/2 bg-[color-mix(in_srgb,var(--nimi-surface-panel)_88%,transparent)] shadow-sm"
                onClick={() => setActiveIndex((idx) => (idx - 1 + slides.length) % slides.length)}
              />
              <IconButton
                data-testid="apps-media-next"
                icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
                tone="secondary"
                size="sm"
                aria-label={t('Apps.storefront.galleryNext')}
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-[color-mix(in_srgb,var(--nimi-surface-panel)_88%,transparent)] shadow-sm"
                onClick={() => setActiveIndex((idx) => (idx + 1) % slides.length)}
              />
            </>
          ) : null}
        </div>

        {activeSlide.caption ? (
          <div className="border-t border-[var(--nimi-border-subtle)] px-4 py-2.5 text-xs leading-5 text-[color:var(--nimi-text-secondary)]">
            {activeSlide.caption}
          </div>
        ) : null}
      </div>

      {slides.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={appName}>
          {slides.map((slide, index) => {
            const isSelected = index === activeIndex;
            const thumbAttempt = retryCount[slide.url] ?? 0;
            const thumbFailed = failedKeys[slide.url] === thumbAttempt;
            return (
              <button
                key={slide.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-testid={`apps-media-thumb-${slide.id}`}
                onClick={() => setActiveIndex(index)}
                className={`relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border-2 transition-[border-color,opacity,transform] duration-150 active:scale-[0.97] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-1 ${
                  isSelected
                    ? 'border-[var(--nimi-action-primary-bg)] ring-1 ring-[var(--nimi-action-primary-bg)]'
                    : 'border-[var(--nimi-border-subtle)] opacity-75 hover:opacity-100'
                }`}
              >
                {thumbFailed ? (
                  <span className="flex h-full w-full items-center justify-center bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)]">
                    <ImageOff className="h-4 w-4 text-[color:var(--nimi-text-muted)]" aria-hidden="true" />
                  </span>
                ) : (
                  <img
                    src={srcWithRetry(slide.url, thumbAttempt)}
                    alt={slide.caption || `${appName} ${index + 1}`}
                    className="h-full w-full object-cover"
                    onError={() => setFailedKeys((prev) => ({ ...prev, [slide.url]: thumbAttempt }))}
                  />
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      <OverlayShell
        open={isLightboxOpen}
        kind="dialog"
        size="full"
        onClose={() => setLightboxOpen(false)}
        data-testid="apps-media-lightbox"
        className="bg-black/88"
        panelClassName="w-max max-w-[calc(100vw-3rem)] border-0 bg-transparent shadow-none"
        contentClassName="p-0"
      >
        {renderedLightbox ? (
          <div className="flex max-h-[90vh] flex-col items-center gap-3">
            <div className="flex w-full items-center justify-between gap-4 text-white">
              <div className="flex items-baseline gap-2.5">
                <DialogTitle className="text-sm font-semibold text-white">
                  {appName}
                </DialogTitle>
                {slides.length > 1 ? (
                  <DialogDescription className="text-xs text-white/70 tabular-nums">
                    {renderedLightbox.index + 1} / {slides.length}
                  </DialogDescription>
                ) : (
                  <DialogDescription className="sr-only">
                    {renderedLightbox.slide.caption || appName}
                  </DialogDescription>
                )}
              </div>
              <IconButton
                data-testid="apps-media-lightbox-close"
                icon={<X className="h-4 w-4" aria-hidden="true" />}
                tone="secondary"
                size="sm"
                aria-label={t('Apps.storefront.galleryClose')}
                className="rounded-full border-0 bg-white/15 text-white hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={() => setLightboxOpen(false)}
              />
            </div>

            <div className="relative flex items-center justify-center">
              {slides.length > 1 ? (
                <IconButton
                  data-testid="apps-media-lightbox-prev"
                  icon={<ChevronLeft className="h-5 w-5" aria-hidden="true" />}
                  tone="secondary"
                  size="sm"
                  aria-label={t('Apps.storefront.galleryPrev')}
                  className="mr-3 shrink-0 rounded-full border-0 bg-white/15 text-white hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  onClick={() => setActiveIndex((idx) => (idx - 1 + slides.length) % slides.length)}
                />
              ) : null}

              <img
                src={srcWithRetry(renderedLightbox.slide.url, renderedLightbox.attempt)}
                alt={renderedLightbox.slide.caption || appName}
                className="max-h-[78vh] max-w-[82vw] rounded-xl object-contain shadow-2xl"
              />

              {slides.length > 1 ? (
                <IconButton
                  data-testid="apps-media-lightbox-next"
                  icon={<ChevronRight className="h-5 w-5" aria-hidden="true" />}
                  tone="secondary"
                  size="sm"
                  aria-label={t('Apps.storefront.galleryNext')}
                  className="ml-3 shrink-0 rounded-full border-0 bg-white/15 text-white hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  onClick={() => setActiveIndex((idx) => (idx + 1) % slides.length)}
                />
              ) : null}
            </div>

            {renderedLightbox.slide.caption ? (
              <p className="max-w-2xl text-center text-sm text-white/90">{renderedLightbox.slide.caption}</p>
            ) : null}
          </div>
        ) : null}
      </OverlayShell>
    </section>
  );
}
