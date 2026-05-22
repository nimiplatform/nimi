import { IconButton } from '@nimiplatform/nimi-kit/ui';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';

export interface DentalPhotoLightboxItem {
  attachmentId: string;
  filePath: string;
  fileName: string;
}

interface Props {
  photos: DentalPhotoLightboxItem[];
  index: number;
  onChange: (next: number) => void;
  onClose: () => void;
}

const SWIPE_THRESHOLD_PX = 72;

export function DentalPhotoLightbox({ photos, index, onChange, onClose }: Props) {
  const photo = photos[index];
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);

  const canPrev = index > 0;
  const canNext = index < photos.length - 1;

  const goPrev = useCallback(() => {
    if (canPrev) onChange(index - 1);
  }, [canPrev, index, onChange]);

  const goNext = useCallback(() => {
    if (canNext) onChange(index + 1);
  }, [canNext, index, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [goPrev, goNext, onClose]);

  if (!photo) return null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (photos.length <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    setDragging(true);
    setDragDx(0);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - dragStartX.current;
    const clamped = !canPrev && dx > 0 ? dx * 0.25 : !canNext && dx < 0 ? dx * 0.25 : dx;
    setDragDx(clamped);
  };

  const endDrag = () => {
    if (!dragging) return;
    if (dragDx <= -SWIPE_THRESHOLD_PX && canNext) goNext();
    else if (dragDx >= SWIPE_THRESHOLD_PX && canPrev) goPrev();
    setDragDx(0);
    setDragging(false);
  };

  const navBtn = (dir: 'left' | 'right', enabled: boolean, onClick: () => void) => (
    <IconButton
      tone="ghost"
      size="md"
      className="absolute z-[2] h-11 w-11 rounded-full border-0 bg-[var(--nimi-surface-overlay)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-floating)] backdrop-blur-[var(--nimi-backdrop-blur-thin)] hover:bg-[var(--nimi-action-ghost-hover)] disabled:opacity-[var(--nimi-opacity-disabled)] nimi-material-glass-thin"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={!enabled}
      aria-label={dir === 'left' ? '上一张' : '下一张'}
      style={{
        [dir]: 24,
        top: '50%',
        transform: 'translateY(-50%)',
        cursor: enabled ? 'pointer' : 'default',
      } as CSSProperties}
      icon={(
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {dir === 'left' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
        </svg>
      )}
    />
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex animate-[dentalLightboxFadeIn_160ms_ease] items-center justify-center bg-[var(--nimi-scrim-modal)]"
      onClick={onClose}
    >
      <style>{`@keyframes dentalLightboxFadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>

      <IconButton
        tone="ghost"
        size="md"
        className="absolute right-6 top-5 z-[2] h-10 w-10 rounded-full border-0 bg-[var(--nimi-surface-overlay)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-floating)] backdrop-blur-[var(--nimi-backdrop-blur-thin)] hover:bg-[var(--nimi-action-ghost-hover)] nimi-material-glass-thin"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="关闭"
        icon={(
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M6 18L18 6" />
          </svg>
        )}
      />

      {photos.length > 1 && (
        <div
          className="absolute left-1/2 top-6 z-[2] -translate-x-1/2 rounded-full bg-[var(--nimi-surface-overlay)] px-3 py-[5px] font-mono text-[12px] tracking-[0.05em] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-floating)] backdrop-blur-[var(--nimi-backdrop-blur-thin)] nimi-material-glass-thin"
        >
          {index + 1} / {photos.length}
        </div>
      )}

      {photos.length > 1 && navBtn('left', canPrev, goPrev)}
      {photos.length > 1 && navBtn('right', canNext, goNext)}

      <div
        className="relative z-[1] max-h-[82vh] max-w-[86vw] select-none touch-pan-y"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          transform: `translateX(${dragDx}px)`,
          transition: dragging ? 'none' : 'transform 200ms ease',
          cursor: photos.length > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
        }}
      >
        <img
          key={photo.attachmentId}
          src={convertFileSrc(photo.filePath)}
          alt={photo.fileName}
          draggable={false}
          className="block max-h-[82vh] max-w-[86vw] rounded-xl object-contain shadow-[var(--nimi-elevation-floating)] pointer-events-none"
        />
      </div>

      {photo.fileName && (
        <div
          className="absolute bottom-6 left-1/2 z-[2] max-w-[70vw] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-[var(--nimi-surface-overlay)] px-3 py-[5px] text-[12px] text-[var(--nimi-text-muted)] shadow-[var(--nimi-elevation-floating)] backdrop-blur-[var(--nimi-backdrop-blur-thin)] nimi-material-glass-thin"
          onClick={(e) => e.stopPropagation()}
        >
          {photo.fileName}
        </div>
      )}
    </div>,
    document.body,
  );
}
