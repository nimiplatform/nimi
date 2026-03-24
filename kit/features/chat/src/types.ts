import type { ReactNode } from 'react';

export type ChatComposerSubmitInput<TAttachment = never> = {
  text: string;
  attachments: readonly TAttachment[];
};

export type ChatComposerState<TAttachment = never> = {
  text: string;
  attachments: readonly TAttachment[];
  canSubmit: boolean;
  isSubmitting: boolean;
  error: string | null;
};

export interface ChatComposerAdapter<TAttachment = never> {
  submit: (input: ChatComposerSubmitInput<TAttachment>) => Promise<void> | void;
}

export interface AttachmentAdapter<TAttachment = unknown> {
  openPicker: () => Promise<readonly TAttachment[] | null | undefined> | readonly TAttachment[] | null | undefined;
  mergeAttachments?: (
    current: readonly TAttachment[],
    incoming: readonly TAttachment[],
  ) => readonly TAttachment[];
  getKey?: (attachment: TAttachment, index: number) => string;
  getLabel?: (attachment: TAttachment, index: number) => string;
  getSecondaryLabel?: (attachment: TAttachment, index: number) => string | undefined;
  getPreviewUrl?: (attachment: TAttachment, index: number) => string | undefined;
  getKind?: (attachment: TAttachment, index: number) => 'image' | 'video' | 'file' | string | undefined;
}

export type ChatComposerAttachmentsSlotProps<TAttachment = never> = {
  attachments: readonly TAttachment[];
  removeAttachment: (index: number) => void;
  openAttachmentPicker: () => Promise<void>;
};

export type ChatComposerAttachmentsSlot<TAttachment = never> =
  | ReactNode
  | ((props: ChatComposerAttachmentsSlotProps<TAttachment>) => ReactNode);
