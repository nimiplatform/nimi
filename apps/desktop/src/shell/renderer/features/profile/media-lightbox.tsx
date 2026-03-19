import { useCallback, useEffect, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';

type PostDto = RealmModel<'PostDto'>;

type MediaLightboxProps = {
  post: PostDto;
  initialMediaIndex: number;
  onClose: () => void;
};

export function MediaLightbox({ post, initialMediaIndex, onClose }: MediaLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialMediaIndex);
  const media = post.media || [];
  const current = media[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < media.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev) setCurrentIndex((i) => i - 1);
  }, [hasPrev]);

  const handleNext = useCallback(() => {
    if (hasNext) setCurrentIndex((i) => i + 1);
  }, [hasNext]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, handlePrev, handleNext]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Prev */}
      {hasPrev ? (
        <button
          type="button"
          onClick={handlePrev}
          className="absolute left-4 z-10 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      ) : null}

      {/* Next */}
      {hasNext ? (
        <button
          type="button"
          onClick={handleNext}
          className="absolute right-4 z-10 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      ) : null}

      {/* Content */}
      <div className="max-h-[90vh] max-w-[90vw]">
        {current.type === PostMediaType.VIDEO && current.url ? (
          <video
            src={current.url}
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
          />
        ) : current.url ? (
          <img
            src={current.url}
            alt={post.caption || ''}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          />
        ) : null}
      </div>

      {/* Caption */}
      {post.caption ? (
        <div className="absolute bottom-6 left-1/2 max-w-lg -translate-x-1/2 rounded-lg bg-black/60 px-4 py-2 text-center text-sm text-white">
          {post.caption}
        </div>
      ) : null}

      {/* Counter */}
      {media.length > 1 ? (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
          {currentIndex + 1} / {media.length}
        </div>
      ) : null}
    </div>
  );
}
