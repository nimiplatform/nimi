// 16:9 static screenshot gallery + lightbox with explicit visible image-load error fallback.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042c

import { useEffect, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Expand, ImageOff, Images, RotateCw, X } from 'lucide-react';
import { Button, IconButton } from '@nimiplatform/kit/ui';
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
    if (!lightboxOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightboxOpen(false);
      } else if (event.key === 'ArrowRight' && slides.length > 1) {
        setActiveIndex((idx) => (idx + 1) % slides.length);
      } else if (event.key === 'ArrowLeft' && slides.length > 1) {
        setActiveIndex((idx) => (idx - 1 + slides.length) % slides.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen, slides.length]);

  if (slides.length === 0) return null;

  const activeSlide = slides[Math.min(activeIndex, slides.length - 1)]!;
  const attempt = retryCount[activeSlide.url] ?? 0;
  const activeFailed = failedKeys[activeSlide.url] === attempt;
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
              className="block h-full w-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--nimi-action-primary-bg)]"
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
                className={`relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
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

      {lightboxOpen && !activeFailed ? (() => {
        const lightbox = (
          <div
            data-testid="apps-media-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={activeSlide.caption || appName}
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 p-8 backdrop-blur-sm"
            onClick={() => setLightboxOpen(false)}
          >
            <IconButton
              data-testid="apps-media-lightbox-close"
              icon={<X className="h-5 w-5" aria-hidden="true" />}
              tone="secondary"
              aria-label={t('Apps.storefront.galleryClose')}
              className="fixed right-6 top-6 z-10"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxOpen(false);
              }}
            />
            <div className="relative flex max-h-[86vh] max-w-[88vw] flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <img
                src={srcWithRetry(activeSlide.url, attempt)}
                alt={activeSlide.caption || appName}
                className="max-h-[78vh] max-w-[86vw] rounded-xl object-contain shadow-2xl"
              />
              {activeSlide.caption ? (
                <p className="max-w-2xl text-center text-sm text-white/90">{activeSlide.caption}</p>
              ) : null}
            </div>
          </div>
        );
        return typeof document !== 'undefined' ? createPortal(lightbox, document.body) : lightbox;
      })() : null}
    </section>
  );
}
