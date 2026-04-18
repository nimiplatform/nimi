import { useRef, useState } from 'react';
import { i18n } from '@renderer/i18n';

export function CloudflareVideoPlayer({ src }: { src: string }) {
  const [activated, setActivated] = useState(false);

  const iframeSrc = activated
    ? `${src}?autoplay=true&controls=true`
    : `${src}?controls=false&preload=auto`;

  return (
    <div className="relative overflow-hidden rounded-lg [backface-visibility:hidden] [transform:translateZ(0)]">
      <iframe
        src={iframeSrc}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
        className="w-full aspect-[4/5] border-0"
        title={i18n.t('Home.postVideo', { defaultValue: 'Post video' })}
      />
      {!activated && (
        <button
          type="button"
          onClick={() => setActivated(true)}
          className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
        >
          <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#1A1A1A" className="ml-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </button>
      )}
    </div>
  );
}

export function NativeVideoPlayer({ src, poster }: { src: string; poster?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlayClick = async () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
        return;
      }

      try {
        await videoRef.current.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-lg bg-gray-900 [backface-visibility:hidden] [transform:translateZ(0)]">
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        className="w-full aspect-[4/5] cursor-pointer object-cover [backface-visibility:hidden] [transform:translateZ(0)] [&::-webkit-media-controls-start-playback-button]:hidden [&::-webkit-media-controls]:hidden"
        onClick={handlePlayClick}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      {!isPlaying && (
        <button
          type="button"
          onClick={handlePlayClick}
          className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#1A1A1A" className="ml-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </button>
      )}
    </div>
  );
}
