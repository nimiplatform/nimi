import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, X, ZoomIn, ZoomOut } from 'lucide-react';
import { MediaImage } from '@nimiplatform/kit/features/media';
import { Button, IconButton, NimiText, OverlayShell, ScrollShell } from '@nimiplatform/kit/ui';
import type { WorldIllustration } from './world-detail-illustrations.js';

function IllustrationViewport({ illustration, alt, zoom, onZoomChange, onUnavailable }: {
  illustration: WorldIllustration;
  alt: string;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onUnavailable: () => void;
}) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousZoom = useRef(1);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const isZoomed = zoom > 1;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      const factor = zoom / previousZoom.current;
      viewport.scrollLeft = (viewport.scrollLeft + viewport.clientWidth / 2) * factor - viewport.clientWidth / 2;
      viewport.scrollTop = (viewport.scrollTop + viewport.clientHeight / 2) * factor - viewport.clientHeight / 2;
    }
    previousZoom.current = zoom;
    if (zoom <= 1) {
      dragRef.current = null;
      setDragging(false);
    }
  }, [zoom]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isZoomed || event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };
    setDragging(true);
    try {
      viewport.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore environments without pointer capture support.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX);
    viewport.scrollTop = drag.startScrollTop - (event.clientY - drag.startY);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    const viewport = viewportRef.current;
    if (viewport?.hasPointerCapture?.(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  };

  return <ScrollShell ref={viewportRef}
    className={`flex-1 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-action-primary-bg)] ${
      isZoomed ? (dragging ? 'cursor-grabbing select-none touch-none' : 'cursor-grab touch-none') : ''
    }`}
    tabIndex={0} role="region" aria-label={t('WorldDetail.discovery.imageViewport')} data-testid="world-illustration-viewport"
    data-zoom-pan-dragging={dragging ? 'true' : 'false'}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={endDrag}
    onPointerCancel={endDrag}
    onLostPointerCapture={endDrag}
    onDoubleClick={() => onZoomChange(zoom === 1 ? 2 : 1)}>
    <div className="world-illustration-viewer-canvas" style={{ '--world-illustration-zoom': zoom } as CSSProperties}>
      <MediaImage delivery={illustration.delivery} externalUrl={illustration.url} purpose="detail" sizes="auto, 1600px" loading="eager"
        alt={alt} className="block h-full w-full object-contain select-none" draggable={false} onUnavailable={onUnavailable} />
    </div>
  </ScrollShell>;
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r014
export function WorldIllustrationViewer({ open, selected, illustrations, illustrationAlt, onSelect, onClose, onUnavailable }: {
  open: boolean;
  selected: WorldIllustration;
  illustrations: readonly WorldIllustration[];
  illustrationAlt: (id: string) => string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onUnavailable: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const index = illustrations.findIndex((item) => item.id === selected.id);
  const alt = illustrationAlt(selected.id);
  const closeViewer = () => {
    setZoom(1);
    onClose();
  };
  const selectIllustration = (id: string) => {
    setZoom(1);
    onSelect(id);
  };
  return <OverlayShell open={open} kind="dialog" size="full" onClose={closeViewer}
    panelStyle={{ width: 'calc(100vw - 32px)', height: 'calc(100dvh - 32px)', maxHeight: 'none' }}
    panelClassName="flex flex-col overflow-hidden" contentClassName="flex min-h-0 flex-1 flex-col px-6 pt-1 pb-4"
    data-testid="world-illustration-viewer"
    title={<div className="flex min-w-0 items-center justify-between gap-3">
      <NimiText as="span" role="card-title" className="min-w-0 flex-1 truncate">{alt}</NimiText>
      <div className="flex shrink-0 items-center gap-1">
        <Button tone="ghost" size="sm" className="mr-1" onClick={() => setZoom(1)} disabled={zoom === 1}>
          {t('WorldDetail.discovery.fitImage')}
        </Button>
        <div className="flex items-center rounded-lg border border-[var(--nimi-border-subtle)] p-0.5">
          <IconButton tone="ghost" size="sm" icon={<ZoomOut size={18} />} aria-label={t('WorldDetail.discovery.zoomOut')}
            disabled={zoom === 1} onClick={() => setZoom(zoom - 0.5)} />
          <NimiText as="span" role="caption" className="w-12 text-center tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</NimiText>
          <IconButton tone="ghost" size="sm" icon={<ZoomIn size={18} />} aria-label={t('WorldDetail.discovery.zoomIn')}
            disabled={zoom === 4} onClick={() => setZoom(zoom + 0.5)} />
        </div>
        <IconButton tone="ghost" size="sm" className="ml-1" icon={<X size={18} />} aria-label={t('WorldDetail.discovery.closeImage')} onClick={closeViewer} />
      </div>
    </div>}
    footer={illustrations.length > 1 ? <div className="flex items-center justify-between gap-3">
      <IconButton tone="secondary" size="sm" icon={<ArrowLeft size={18} />} aria-label={t('WorldDetail.discovery.previousImage')}
        disabled={index === 0} onClick={() => selectIllustration(illustrations[index - 1]!.id)} />
      <NimiText as="span" role="caption" aria-live="polite">{index + 1} / {illustrations.length}</NimiText>
      <IconButton tone="secondary" size="sm" icon={<ArrowRight size={18} />} aria-label={t('WorldDetail.discovery.nextImage')}
        disabled={index === illustrations.length - 1} onClick={() => selectIllustration(illustrations[index + 1]!.id)} />
    </div> : undefined}>
    <IllustrationViewport key={selected.id} illustration={selected} alt={alt} zoom={zoom} onZoomChange={setZoom}
      onUnavailable={() => onUnavailable(selected.id)} />
  </OverlayShell>;
}
