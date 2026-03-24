import { useCallback, useEffect, useState } from 'react';
import type { GenerationPanelAdapter } from '../types.js';

export type UseGenerationPanelOptions<TInput> = {
  adapter: GenerationPanelAdapter<TInput>;
  input: TInput;
  disabled?: boolean;
  submitting?: boolean;
  triggerEventName?: string;
  canTriggerShortcut?: boolean;
  onError?: (error: unknown) => void;
};

export type UseGenerationPanelResult = {
  canSubmit: boolean;
  isSubmitting: boolean;
  error: string | null;
  clearError: () => void;
  handleSubmit: () => Promise<void>;
};

export function useGenerationPanel<TInput>({
  adapter,
  input,
  disabled = false,
  submitting = false,
  triggerEventName,
  canTriggerShortcut = true,
  onError,
}: UseGenerationPanelOptions<TInput>): UseGenerationPanelResult {
  const [internalSubmitting, setInternalSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = submitting || internalSubmitting;
  const canSubmit = !disabled && !isSubmitting;

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      return;
    }
    setInternalSubmitting(true);
    setError(null);
    try {
      await adapter.submit(input);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      onError?.(nextError);
    } finally {
      setInternalSubmitting(false);
    }
  }, [adapter, canSubmit, input, onError]);

  useEffect(() => {
    if (!triggerEventName) {
      return;
    }

    const onTrigger = () => {
      if (!canTriggerShortcut) {
        return;
      }
      void handleSubmit();
    };

    window.addEventListener(triggerEventName, onTrigger);
    return () => {
      window.removeEventListener(triggerEventName, onTrigger);
    };
  }, [canTriggerShortcut, handleSubmit, triggerEventName]);

  return {
    canSubmit,
    isSubmitting,
    error,
    clearError,
    handleSubmit,
  };
}
