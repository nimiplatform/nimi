import { useCallback, useEffect, useRef, useState } from 'react';
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
const MONO = '"JetBrains Mono", "SF Mono", ui-monospace, monospace';

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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (photos.length <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    setDragging(true);
    setDragDx(0);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
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
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={!enabled}
      aria-label={dir === 'left' ? '上一张' : '下一张'}
      style={{
        position: 'absolute',
        [dir]: 24,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 44,
        height: 44,
        borderRadius: 999,
        border: 0,
        background: 'rgba(255,255,255,0.12)',
        color: '#ffffff',
        display: 'grid',
        placeItems: 'center',
        cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 1 : 0.3,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        transition: 'background 160ms, opacity 160ms',
        zIndex: 2,
      } as React.CSSProperties}
      onMouseEnter={(e) => { if (enabled) e.currentTarget.style.background = 'rgba(255,255,255,0.22)'; }}
      onMouseLeave={(e) => { if (enabled) e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {dir === 'left' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(8,10,15,0.88)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'dentalLightboxFadeIn 160ms ease',
      }}
    >
      <style>{`@keyframes dentalLightboxFadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="关闭"
        style={{
          position: 'absolute',
          top: 20,
          right: 24,
          width: 40,
          height: 40,
          borderRadius: 999,
          border: 0,
          background: 'rgba(255,255,255,0.14)',
          color: '#ffffff',
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          transition: 'background 160ms',
          zIndex: 2,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.24)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M6 18L18 6" />
        </svg>
      </button>

      {photos.length > 1 && (
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,0.92)',
            fontSize: 12,
            background: 'rgba(255,255,255,0.12)',
            padding: '5px 12px',
            borderRadius: 999,
            fontFamily: MONO,
            letterSpacing: '0.05em',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 2,
          }}
        >
          {index + 1} / {photos.length}
        </div>
      )}

      {photos.length > 1 && navBtn('left', canPrev, goPrev)}
      {photos.length > 1 && navBtn('right', canNext, goNext)}

      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          maxWidth: '86vw',
          maxHeight: '82vh',
          transform: `translateX(${dragDx}px)`,
          transition: dragging ? 'none' : 'transform 200ms ease',
          cursor: photos.length > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
          userSelect: 'none',
          touchAction: 'pan-y',
          zIndex: 1,
        }}
      >
        <img
          key={photo.attachmentId}
          src={convertFileSrc(photo.filePath)}
          alt={photo.fileName}
          draggable={false}
          style={{
            display: 'block',
            maxWidth: '86vw',
            maxHeight: '82vh',
            objectFit: 'contain',
            borderRadius: 12,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {photo.fileName && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,0.75)',
            fontSize: 12,
            background: 'rgba(255,255,255,0.08)',
            padding: '5px 12px',
            borderRadius: 999,
            maxWidth: '70vw',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 2,
          }}
        >
          {photo.fileName}
        </div>
      )}
    </div>,
    document.body,
  );
}
