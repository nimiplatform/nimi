import React from 'react';
import {
  dataPart,
  textPart,
  type NimiMessage,
  type NimiMessagePart,
} from '@nimiplatform/sdk/contracts';

// App-owned multimodal input for runtime-backed text capabilities (vision /
// image→text). Recovered from the desktop tester. Attachments are read locally
// as data URLs and shaped into vNext Nimi message data parts;
// no app-local transport or fabricated content.

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
let attachmentSequence = 0;

function inferMediaKind(mimeType: string): MediaKind | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return null;
}

function readMediaFile(file: File, callback: (attachment: MediaAttachment) => void) {
  const kind = inferMediaKind(file.type);
  if (!kind) return;
  const reader = new FileReader();
  reader.onload = () => {
    callback({
      id: createTesterAttachmentId(),
      kind,
      name: file.name || (kind === 'image' ? 'pasted-image.png' : 'pasted-video.mp4'),
      dataUrl: reader.result as string,
    });
  };
  reader.readAsDataURL(file);
}

function createTesterAttachmentId(): string {
  attachmentSequence += 1;
  const randomUUID = globalThis.crypto?.randomUUID?.();
  return randomUUID
    ? `tester-attachment:${randomUUID}`
    : `tester-attachment:${Date.now().toString(36)}:${attachmentSequence}`;
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
 * Build a vNext message projection for text-capability attachments. Runtime
 * text Scenario execution currently fails closed before sending these parts;
 * the projection remains app-owned UI evidence for future multimodal support.
 */
export function buildMultimodalInput(prompt: string, media: MediaAttachment[]): string | NimiMessage[] {
  if (media.length === 0) return prompt;
  const parts: NimiMessagePart[] = [
    ...media.map((item): NimiMessagePart => dataPart({
      kind: item.kind,
      name: item.name,
      dataUrl: item.dataUrl,
    })),
    textPart(prompt),
  ];
  return [{ role: 'user' as const, content: parts }];
}

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
  attachments: MediaAttachment[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAddFiles: (files: FileList | null) => void;
  onRemove: (id: string) => void;
  onOpenPicker: () => void;
  disabled?: boolean;
  variant?: 'default' | 'icon';
}) {
  const { attachments, fileInputRef, onAddFiles, onRemove, onOpenPicker, disabled, variant = 'default' } = props;
  const iconVariant = variant === 'icon';
  return (
    <div className={iconVariant ? 'tester-attach-strip tester-attach-strip--icon' : 'tester-attach-strip'}>
      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        multiple
        hidden
        onChange={(event) => onAddFiles(event.target.files)}
      />
      <button
        type="button"
        className="tester-attach-strip__add"
        onClick={onOpenPicker}
        disabled={disabled}
        aria-label="Attach context"
        title="Attach context"
      >
        {ATTACH_ICON}
        {iconVariant ? null : <span>Attach context (optional)</span>}
      </button>
      {attachments.map((item) => (
        <span key={item.id} className="tester-attach-chip">
          {item.kind === 'image' ? (
            <img src={item.dataUrl} alt={item.name} />
          ) : (
            <span className="tester-attach-chip__video" aria-hidden="true">{VIDEO_ICON}</span>
          )}
          <span className="tester-attach-chip__name">{item.name}</span>
          <button
            type="button"
            className="tester-attach-chip__remove"
            aria-label={`Remove ${item.name}`}
            onClick={() => onRemove(item.id)}
          >
            {CLOSE_ICON}
          </button>
        </span>
      ))}
    </div>
  );
}
