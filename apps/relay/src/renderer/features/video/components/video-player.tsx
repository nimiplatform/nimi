import { useTranslation } from 'react-i18next';

interface VideoPlayerProps {
  url?: string;
}

export function VideoPlayer({ url }: VideoPlayerProps) {
  const { t } = useTranslation();

  if (!url) {
    return (
      <div className="flex items-center justify-center h-48 bg-bg-elevated rounded-xl">
        <span className="text-[13px] text-text-secondary">{t('video.noVideo')}</span>
      </div>
    );
  }

  return (
    <video
      src={url}
      controls
      className="w-full rounded-xl"
    />
  );
}
