import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TextMessage, TextMessageContentPart } from '@nimiplatform/sdk/runtime';

export type MediaKind = 'image' | 'video';

export type MediaAttachment = {
  id: string;
  kind: MediaKind;
  name: string;
  dataUrl: string;
};

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const FILE_ACCEPT = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES].join(',');

function inferMediaKind(mimeType: string): MediaKind | null {
  if (ACCEPTED_IMAGE_TYPES.some((t) => mimeType.startsWith(t.split('/')[0] + '/'))) {
    return mimeType.startsWith('image/') ? 'image' : null;
  }
  if (mimeType.startsWith('video/')) return 'video';
  return null;
}

function readMediaFile(file: File, callback: (attachment: MediaAttachment) => void) {
  const kind = inferMediaKind(file.type);
  if (!kind) return;
  const reader = new FileReader();
  reader.onload = () => {
    callback({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      name: file.name || (kind === 'image' ? 'pasted-image.png' : 'pasted-video.mp4'),
      dataUrl: reader.result as string,
    });
  };
  reader.readAsDataURL(file);
}

export function useMediaAttachments() {
  const [attachments, setAttachments] = React.useState<MediaAttachment[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const addAttachment = React.useCallback((attachment: MediaAttachment) => {
    setAttachments((prev) => [...prev, attachment]);
  }, []);

  const addFiles = React.useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      readMediaFile(file, addAttachment);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [addAttachment]);

  const handlePaste = React.useCallback((event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/') && !item.type.startsWith('video/')) continue;
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        readMediaFile(file, addAttachment);
      }
    }
  }, [addAttachment]);

  React.useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = React.useCallback(() => {
    setAttachments([]);
  }, []);

  const openFilePicker = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return { attachments, fileInputRef, addFiles, removeAttachment, clearAttachments, openFilePicker };
}

/**
 * Build the SDK `input` field for text.generate / text.stream.
 * Returns a plain string when there are no media attachments, or a TextMessage[]
 * with image_url / video_url + text content parts when media is attached.
 */
export function buildMultimodalInput(prompt: string, media: MediaAttachment[]): string | TextMessage[] {
  if (media.length === 0) return prompt;
  const parts: TextMessageContentPart[] = [
    ...media.map((item): TextMessageContentPart => {
      if (item.kind === 'video') {
        return { type: 'video_url' as const, videoUrl: item.dataUrl };
      }
      return { type: 'image_url' as const, imageUrl: item.dataUrl };
    }),
    { type: 'text' as const, text: prompt },
  ];
  return [{ role: 'user' as const, content: parts }];
}

// Keep legacy export name for existing panel imports
export type ImageAttachment = MediaAttachment;
export const useImageAttachments = useMediaAttachments;

const ATTACH_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const CLOSE_ICON = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const VIDEO_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

export function ImageAttachmentStrip(props: {
  images: MediaAttachment[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAddFiles: (files: FileList | null) => void;
  onRemove: (id: string) => void;
  onOpenPicker: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { images: attachments, fileInputRef, onAddFiles, onRemove, onOpenPicker, disabled } = props;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => onAddFiles(e.target.files)}
      />
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-[var(--nimi-radius-sm)] border border-dashed border-[var(--nimi-border-subtle)] px-2.5 py-1.5 text-xs text-[var(--nimi-text-muted)] transition-colors hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-secondary)]"
        onClick={onOpenPicker}
        disabled={disabled}
      >
        {ATTACH_ICON}
        {t('Tester.multimodal.attachMedia', { defaultValue: 'Attach media' })}
      </button>

      {attachments.map((item) => (
        <div
          key={item.id}
          className="group relative flex items-center gap-1.5 rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-1.5 py-1"
        >
          {item.kind === 'image' ? (
            <img
              src={item.dataUrl}
              alt={item.name}
              className="h-8 w-8 rounded object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-muted)]">
              {VIDEO_ICON}
            </div>
          )}
          <span className="max-w-[100px] truncate text-[11px] text-[var(--nimi-text-secondary)]">
            {item.name}
          </span>
          <button
            type="button"
            className="ml-0.5 rounded-full p-0.5 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-canvas)] hover:text-[var(--nimi-text-primary)]"
            onClick={() => onRemove(item.id)}
          >
            {CLOSE_ICON}
          </button>
        </div>
      ))}
    </div>
  );
}
