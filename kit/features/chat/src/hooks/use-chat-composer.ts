import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type {
  AttachmentAdapter,
  ChatComposerAdapter,
  ChatComposerState,
} from '../types.js';

export type UseChatComposerOptions<TAttachment = never> = {
  adapter: ChatComposerAdapter<TAttachment>;
  attachmentAdapter?: AttachmentAdapter<TAttachment>;
  attachments?: readonly TAttachment[];
  onAttachmentsChange?: (attachments: readonly TAttachment[]) => void;
  disabled?: boolean;
  initialText?: string;
  maxTextareaHeight?: number;
  onError?: (error: unknown) => void;
};

export type UseChatComposerResult<TAttachment = never> = ChatComposerState<TAttachment> & {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setText: (value: string) => void;
  handleTextChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSubmit: () => Promise<void>;
  openAttachmentPicker: () => Promise<void>;
  removeAttachment: (index: number) => void;
  clearError: () => void;
};

export function useChatComposer<TAttachment = never>({
  adapter,
  attachmentAdapter,
  attachments: controlledAttachments,
  onAttachmentsChange,
  disabled = false,
  initialText = '',
  maxTextareaHeight = 200,
  onError,
}: UseChatComposerOptions<TAttachment>): UseChatComposerResult<TAttachment> {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [internalAttachments, setInternalAttachments] = useState<readonly TAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachments = controlledAttachments ?? internalAttachments;

  const updateAttachments = useCallback((nextAttachments: readonly TAttachment[]) => {
    if (controlledAttachments !== undefined) {
      onAttachmentsChange?.(nextAttachments);
      return;
    }
    setInternalAttachments(nextAttachments);
  }, [controlledAttachments, onAttachmentsChange]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleTextChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
    if (error) {
      setError(null);
    }
  }, [error]);

  const removeAttachment = useCallback((index: number) => {
    updateAttachments(attachments.filter((_, currentIndex) => currentIndex !== index));
  }, [attachments, updateAttachments]);

  const openAttachmentPicker = useCallback(async () => {
    if (!attachmentAdapter) {
      return;
    }
    try {
      const incoming = await attachmentAdapter.openPicker();
      if (!incoming || incoming.length === 0) {
        return;
      }
      const nextAttachments = attachmentAdapter.mergeAttachments
        ? attachmentAdapter.mergeAttachments(attachments, incoming)
        : [...attachments, ...incoming];
      updateAttachments(nextAttachments);
      if (error) {
        setError(null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      onError?.(nextError);
    }
  }, [attachmentAdapter, attachments, error, onError, updateAttachments]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (disabled || isSubmitting || (!trimmed && attachments.length === 0)) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await adapter.submit({
        text: trimmed,
        attachments,
      });
      setText('');
      updateAttachments([]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      onError?.(nextError);
    } finally {
      setIsSubmitting(false);
    }
  }, [adapter, attachments, disabled, isSubmitting, onError, text, updateAttachments]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }, [handleSubmit]);

  return {
    textareaRef,
    text,
    attachments,
    canSubmit: !disabled && !isSubmitting && (text.trim().length > 0 || attachments.length > 0),
    isSubmitting,
    error,
    setText,
    handleTextChange,
    handleKeyDown,
    handleSubmit,
    openAttachmentPicker,
    removeAttachment,
    clearError,
  };
}
