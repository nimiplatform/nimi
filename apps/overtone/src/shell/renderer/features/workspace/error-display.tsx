import React, { useState, useEffect, useCallback } from 'react';
import { isNimiError } from '@nimiplatform/sdk/runtime/errors.js';

type ErrorActionType =
  | 'retry'
  | 'setup_connector'
  | 'validation'
  | 'cooldown'
  | 'content_warning'
  | 'timeout_retry'
  | 'generic';

interface ClassifiedError {
  reasonCode: string;
  message: string;
  actionLabel: string;
  actionType: ErrorActionType;
  retryable: boolean;
  cooldownMs?: number;
}

export function classifyError(error: unknown): ClassifiedError {
  const nimiErr = isNimiError(error) ? error : null;
  const reasonCode = nimiErr?.reasonCode ?? '';

  switch (reasonCode) {
    case 'AI_PROVIDER_UNAVAILABLE':
      return {
        reasonCode,
        message: 'Provider temporarily unavailable. Try again or switch to a different model.',
        actionLabel: 'Retry',
        actionType: 'retry',
        retryable: true,
      };
    case 'AI_PROVIDER_AUTH_FAILED':
      return {
        reasonCode,
        message: 'Connector authentication failed. Check your API key in connector settings.',
        actionLabel: 'Check Connector',
        actionType: 'setup_connector',
        retryable: false,
      };
    case 'AI_MEDIA_SPEC_INVALID':
      return {
        reasonCode,
        message: 'Invalid generation parameters. Please adjust your settings.',
        actionLabel: 'Dismiss',
        actionType: 'validation',
        retryable: false,
      };
    case 'AI_MEDIA_OPTION_UNSUPPORTED':
      return {
        reasonCode,
        message: 'This option is not supported by the current model.',
        actionLabel: 'Dismiss',
        actionType: 'validation',
        retryable: false,
      };
    case 'AI_PROVIDER_RATE_LIMITED':
      return {
        reasonCode,
        message: 'Rate limited. Please wait before trying again.',
        actionLabel: 'Wait',
        actionType: 'cooldown',
        retryable: true,
        cooldownMs: 30_000,
      };
    case 'AI_CONTENT_FILTER_BLOCKED':
      return {
        reasonCode,
        message: 'Content was filtered by the provider. Try adjusting your prompt.',
        actionLabel: 'Dismiss',
        actionType: 'content_warning',
        retryable: false,
      };
    case 'AI_PROVIDER_TIMEOUT':
    case 'AI_JOB_TIMEOUT':
      return {
        reasonCode,
        message: 'Generation timed out. You can retry the request.',
        actionLabel: 'Retry',
        actionType: 'timeout_retry',
        retryable: true,
      };
    default: {
      const msg = error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'An unexpected error occurred.';
      return {
        reasonCode: reasonCode || 'UNKNOWN',
        message: msg,
        actionLabel: 'Dismiss',
        actionType: 'generic',
        retryable: false,
      };
    }
  }
}

export function ErrorDisplay({
  error,
  onRetry,
  onDismiss,
}: {
  error: unknown;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const classified = classifyError(error);
  const [cooldownLeft, setCooldownLeft] = useState(classified.cooldownMs ?? 0);

  useEffect(() => {
    if (classified.actionType !== 'cooldown' || !classified.cooldownMs) return;
    setCooldownLeft(classified.cooldownMs);
    const interval = setInterval(() => {
      setCooldownLeft((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(interval);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [classified.actionType, classified.cooldownMs]);

  const handleAction = useCallback(() => {
    if (classified.retryable && onRetry) {
      onRetry();
    } else if (onDismiss) {
      onDismiss();
    }
  }, [classified.retryable, onRetry, onDismiss]);

  const isWarning = classified.actionType === 'content_warning' || classified.actionType === 'cooldown';
  const borderColor = isWarning ? 'border-amber-500/20' : 'border-red-500/20';
  const bgColor = isWarning ? 'bg-amber-500/10' : 'bg-red-500/10';
  const textColor = isWarning ? 'text-amber-300' : 'text-red-300';
  const iconColor = isWarning ? 'text-amber-400' : 'text-red-400';

  return (
    <div className={`p-3 rounded-lg border ${borderColor} ${bgColor} space-y-2`}>
      <div className="flex items-start gap-2">
        <span className={`${iconColor} text-sm shrink-0 mt-0.5`}>
          {isWarning ? '\u26A0' : '\u2718'}
        </span>
        <p className={`text-xs ${textColor} flex-1`}>{classified.message}</p>
      </div>

      <div className="flex items-center gap-2">
        {classified.actionType === 'cooldown' && cooldownLeft > 0 ? (
          <span className="text-[10px] text-amber-400 tabular-nums">
            Retry in {Math.ceil(cooldownLeft / 1000)}s
          </span>
        ) : (
          <>
            {classified.retryable && onRetry && (
              <button
                className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                onClick={handleAction}
                type="button"
              >
                {classified.actionLabel}
              </button>
            )}
            {onDismiss && (
              <button
                className="text-[10px] px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                onClick={onDismiss}
                type="button"
              >
                Dismiss
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
