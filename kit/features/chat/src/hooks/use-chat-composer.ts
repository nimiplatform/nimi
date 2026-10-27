import {
  useCallback,
  useEffect,
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
  submitDisabled?: boolean;
  initialText?: string;
  text?: string;
  maxTextareaHeight?: number;
  onTextChange?: (text: string) => void;
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
  submitDisabled = false,
  initialText = '',
  text: controlledText,
  maxTextareaHeight = 200,
  onTextChange,
  onError,
}: UseChatComposerOptions<TAttachment>): UseChatComposerResult<TAttachment> {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [internalText, setInternalText] = useState(initialText);
  const [internalAttachments, setInternalAttachments] = useState<readonly TAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = controlledText ?? internalText;
  const attachments = controlledAttachments ?? internalAttachments;
  const draftRevision = useRef(0);
  const latestDraft = useRef({ text, attachments }); latestDraft.current = { text, attachments };

  const updateText = useCallback((nextText: string) => {
    draftRevision.current += 1;
    if (controlledText === undefined) {
      setInternalText(nextText);
    }
    onTextChange?.(nextText);
  }, [controlledText, onTextChange]);

  const updateAttachments = useCallback((nextAttachments: readonly TAttachment[]) => {
    draftRevision.current += 1;
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
    const nextText = event.target.value;
    updateText(nextText);
    if (error) {
      setError(null);
    }
  }, [error, updateText]);

  const removeAttachment = useCallback((index: number) => {
    updateAttachments(attachments.filter((_, currentIndex) => currentIndex !== index));
  }, [attachments, updateAttachments]);

  const openAttachmentPicker = useCallback(async () => {
    if (!attachmentAdapter) {
      return;
    }
    try {
      const incoming = await attachmentAdapter.openPicker();
      if (!mounted.current) return;
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
      if (!mounted.current) return;
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      onError?.(nextError);
    }
  }, [attachmentAdapter, attachments, error, onError, updateAttachments]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (disabled || submitDisabled || isSubmitting || (!trimmed && attachments.length === 0)) {
      return;
    }
    setIsSubmitting(true);
    const submittedRevision = draftRevision.current;
    setError(null);
    try {
      await adapter.submit({
        text: trimmed,
        attachments,
      });
      // A retired composer must not clear a new conversation's controlled draft.
      if (!mounted.current) return;
      if (draftRevision.current === submittedRevision && latestDraft.current.text === text && latestDraft.current.attachments === attachments) {
        updateText('');
        updateAttachments([]);
      }
    } catch (nextError) {
      if (!mounted.current) return;
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      onError?.(nextError);
    } finally {
      if (mounted.current) setIsSubmitting(false);
    }
  }, [adapter, attachments, disabled, submitDisabled, isSubmitting, onError, text, updateAttachments, updateText]);

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
    canSubmit: !disabled && !submitDisabled && !isSubmitting && (text.trim().length > 0 || attachments.length > 0),
    isSubmitting,
    error,
    setText: updateText,
    handleTextChange,
    handleKeyDown,
    handleSubmit,
    openAttachmentPicker,
    removeAttachment,
    clearError,
  };
}
