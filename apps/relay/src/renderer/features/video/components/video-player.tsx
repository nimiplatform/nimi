import { useTranslation } from 'react-i18next';

interface VideoPlayerProps {
  url?: string;
}

export function VideoPlayer({ url }: VideoPlayerProps) {
  const { t } = useTranslation();

  if (!url) {
    return (
      <div className="flex items-center justify-center h-48 bg-gray-800 rounded-lg">
        <span className="text-sm text-gray-500">{t('video.noVideo')}</span>
      </div>
    );
  }

  return (
    <video
      src={url}
      controls
      className="w-full rounded-lg"
    />
  );
}
