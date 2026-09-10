import { Button, IconButton } from '@nimiplatform/kit/ui';
import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import { ImagePlus, X } from 'lucide-react';
import { useAIStudioHost } from './host-context.js';

// @nimi-authority: rule.nimi.runtime.ai-provider.r126
export function VisionLocateImageInput({
  image,
  disabled,
  onChoose,
  onRemove,
}: {
  image?: BrowserDataUrlAttachment;
  disabled: boolean;
  onChoose: () => void;
  onRemove: () => void;
}) {
  const { translate: t } = useAIStudioHost();
  return (
    <div className="studio-locate-input">
      {image ? (
        <>
          <img className="studio-locate-input__preview" src={image.dataUrl} alt={t('VisionLocate.draftImage')} />
          <div className="studio-locate-input__file">
            <span title={image.name}>{image.name}</span>
            <Button type="button" tone="ghost" size="sm" disabled={disabled} onClick={onChoose}>
              {t('VisionLocate.replaceImage')}
            </Button>
            <IconButton
              type="button"
              tone="ghost"
              size="sm"
              disabled={disabled}
              aria-label={t('Studio.composer.removeAttachment', { name: image.name })}
              icon={<X size={16} aria-hidden="true" />}
              onClick={onRemove}
            />
          </div>
        </>
      ) : (
        <div className="studio-locate-input__empty">
          <Button
            type="button"
            tone="secondary"
            disabled={disabled}
            leadingIcon={<ImagePlus size={18} aria-hidden="true" />}
            onClick={onChoose}
          >
            {t('VisionLocate.chooseImage')}
          </Button>
          <p>{t('VisionLocate.imageHint')}</p>
        </div>
      )}
    </div>
  );
}
