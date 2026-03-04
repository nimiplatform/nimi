import { useRef, useState } from 'react';

export function CloudflareVideoPlayer({ src }: { src: string }) {
  const [activated, setActivated] = useState(false);

  const iframeSrc = activated
    ? `${src}?autoplay=true&controls=true`
    : `${src}?controls=false&preload=auto`;

  return (
    <div className="relative overflow-hidden rounded-lg">
      <iframe
        src={iframeSrc}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
        className="w-full aspect-[4/5] border-0"
        title="Post video"
      />
      {!activated && (
        <button
          type="button"
          onClick={() => setActivated(true)}
          className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
        >
          <div className="w-14 h-14 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
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

  const handlePlayClick = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="relative overflow-hidden bg-gray-900 rounded-lg group">
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        className="w-full aspect-[4/5] object-cover cursor-pointer [&::-webkit-media-controls-start-playback-button]:hidden [&::-webkit-media-controls]:hidden"
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
          <div className="w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#1A1A1A" className="ml-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </button>
      )}
    </div>
  );
}
